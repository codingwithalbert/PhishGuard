"use strict";

const fs = require("node:fs");
const { ObjectId } = require("mongodb");

const {
  evaluateTestDatabaseEnvironment
} = require("./testDatabaseIsolation");

const {
  resolveProbeTarget,
  classifyError,
  closeQuietly,
  PROBE_TIMEOUT_MS
} = require("./probeTestDatabase");

const {
  verifyFixtureRecovery,
  resolveManifestPath
} = require("./verifyTestFixtureManifest");

const {
  readManifest,
  lockPath
} = require("./testFixtureManifest");

const {
  ROLE_ACCOUNTS
} = require("./testFixturePlan");

const VERIFY_CODES = Object.freeze({
  gateRefused: "ISOLATION_GATE_REFUSED",
  targetRefused: "TARGET_REFUSED",
  manifestReadRefused: "MANIFEST_READ_REFUSED",
  manifestChanged: "MANIFEST_CHANGED",
  lockPresent: "FIXTURE_LOCK_PRESENT",
  driverUnavailable: "DRIVER_UNAVAILABLE",
  connectFailed: "CONNECT_FAILED",
  readFailed: "READ_FAILED",
  recordsMismatch: "FIXTURE_RECORDS_MISMATCH",
  disconnectFailed: "DISCONNECT_FAILED",
  verified: "LIVE_FIXTURE_RECOVERY_VERIFIED"
});

function verifyDocuments(documents, entries) {
  if (
    !Array.isArray(documents) ||
    !Array.isArray(entries) ||
    documents.length !== entries.length ||
    entries.length !== ROLE_ACCOUNTS.length
  ) {
    return false;
  }

  const expected = new Map(
    entries.map((entry) => [
      entry.id.toLowerCase(),
      entry.identity
    ])
  );

  const seen = new Set();

  for (const document of documents) {
    const id = document?._id?.toHexString?.()?.toLowerCase();

    if (!id || seen.has(id) || !expected.has(id)) {
      return false;
    }

    const identity = expected.get(id);

    if (
      document.email !== identity.email ||
      document.role !== identity.role ||
      document.isActive !== true
    ) {
      return false;
    }

    seen.add(id);
  }

  return seen.size === ROLE_ACCOUNTS.length;
}

async function runLiveFixtureVerification({
  env = process.env,
  driver,
  fileSystem = fs,
  stdout = process.stdout
} = {}) {
  const report = (data) => {
    stdout.write(
      JSON.stringify(
        {
          verifier: "live-fixture-recovery",
          credentialsPrinted: false,
          connectionStringPrinted: false,
          ...data
        },
        null,
        2
      ) + "\n"
    );
  };

  // 1. Recheck the disposable database isolation gate.
  const gate = evaluateTestDatabaseEnvironment(env, {
    substitutedChild: true
  });

  if (!gate.ok) {
    report({
      ok: false,
      code: VERIFY_CODES.gateRefused,
      connected: false
    });

    return 1;
  }

  // 2. Refuse a missing or mismatched child MongoDB URI.
  const target = resolveProbeTarget(env);

  if (!target.ok) {
    report({
      ok: false,
      code: VERIFY_CODES.targetRefused,
      connected: false
    });

    return 1;
  }

  // 3. Authenticate the existing fixture recovery records.
  const recovery = verifyFixtureRecovery({
    env,
    fileSystem
  });

  if (!recovery.ok) {
    report({
      ok: false,
      code: recovery.code,
      connected: false
    });

    return 1;
  }

  const manifestPath = resolveManifestPath(env);

  let manifest;

  try {
    manifest = readManifest(
      manifestPath,
      gate.target,
      env.PHISHGUARD_TEST_MANIFEST_SECRET,
      fileSystem
    );
  } catch {
    report({
      ok: false,
      code: VERIFY_CODES.manifestReadRefused,
      connected: false
    });

    return 1;
  }

  // 4. Reject concurrent fixture activity.
  if (fileSystem.existsSync(lockPath(manifestPath))) {
    report({
      ok: false,
      code: VERIFY_CODES.lockPresent,
      connected: false
    });

    return 1;
  }

  // Reauthenticate the manifest and reject changes before connecting.
  try {
    const confirmedManifest = readManifest(
      manifestPath,
      gate.target,
      env.PHISHGUARD_TEST_MANIFEST_SECRET,
      fileSystem
    );

    if (
      manifest.authentication !== confirmedManifest.authentication ||
      manifest.runId !== confirmedManifest.runId ||
      manifest.entries.length !== ROLE_ACCOUNTS.length ||
      fileSystem.existsSync(lockPath(manifestPath))
    ) {
      report({
        ok: false,
        code: VERIFY_CODES.manifestChanged,
        connected: false
      });

      return 1;
    }
  } catch {
    report({
      ok: false,
      code: VERIFY_CODES.manifestReadRefused,
      connected: false
    });

    return 1;
  }

  if (!driver) {
    report({
      ok: false,
      code: VERIFY_CODES.driverUnavailable,
      connected: false
    });

    return 1;
  }

  // 5. Disable automatic database creation behavior.

  let connectionAttempted = false;
  let connected = false;
  let verified = false;
  let failureCode = null;
  let category = null;
  let connectionClosed = false;

  try {
    // Disable automatic index and collection creation.
    driver.set("autoIndex", false);
    driver.set("autoCreate", false);

    // Mark the attempt before calling connect().
    connectionAttempted = true;

    await driver.connect(target.testUri, {
      serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
      connectTimeoutMS: PROBE_TIMEOUT_MS,
      socketTimeoutMS: PROBE_TIMEOUT_MS,
      maxPoolSize: 1,
      minPoolSize: 0,
      autoIndex: false,
      autoCreate: false
    });

    connected = true;

    // 6. Query only the original fixture document IDs.
    const ids = manifest.entries.map(
      (entry) => new ObjectId(entry.id)
    );

    const documents = await driver.connection.db
      .collection("users")
      .find(
        {
          _id: {
            $in: ids
          }
        },
        {
          projection: {
            _id: 1,
            email: 1,
            role: 1,
            isActive: 1
          }
        }
      )
      .limit(ROLE_ACCOUNTS.length + 1)
      .toArray();

    // 7. Verify IDs, emails, roles, and active status.
    verified = verifyDocuments(
      documents,
      manifest.entries
    );

    if (!verified) {
      failureCode = VERIFY_CODES.recordsMismatch;
    }
  } catch (error) {
    failureCode = connected
      ? VERIFY_CODES.readFailed
      : VERIFY_CODES.connectFailed;

    category = classifyError(error).category;
  } finally {
    // 8. Always attempt cleanup after connect() was called,
    // even when connect() rejected.
    if (connectionAttempted) {
      connectionClosed = await closeQuietly(driver, {
        force: true
      });
    }
  }

  // 9. A failed disconnect must never report success.
  if (connectionAttempted && !connectionClosed) {
    report({
      ok: false,
      code: VERIFY_CODES.disconnectFailed,
      connected,
      connectionClosed: false
    });

    return 1;
  }

  if (failureCode) {
    report({
      ok: false,
      code: failureCode,
      ...(category ? { category } : {}),
      connected,
      connectionClosed
    });

    return 1;
  }

  report({
    ok: true,
    code: VERIFY_CODES.verified,
    connected: true,
    recordsVerified: ROLE_ACCOUNTS.length,
    readOnly: true,
    recordsWritten: 0,
    connectionClosed: true
  });

  return 0;
}

module.exports = {
  VERIFY_CODES,
  verifyDocuments,
  runLiveFixtureVerification
};

if (require.main === module) {
  // Load Mongoose only when this file is executed directly.
  // Importing this module for offline tests opens no connection.
  runLiveFixtureVerification({
    driver: require("mongoose")
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write(
        "Live fixture verification failed safely.\n"
      );

      process.exitCode = 1;
    });
}
