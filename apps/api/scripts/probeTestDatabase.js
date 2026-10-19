#!/usr/bin/env node
"use strict";

/**
 * Gated, read-only Atlas connectivity probe for the disposable S5 environment.
 *
 * WHAT THIS PROVES
 *
 * A successful `mongoose.connect()` already proves, in one step, that the DNS
 * SRV lookup resolved, the client IP is admitted by the Atlas network access
 * list, TLS negotiated, and the SCRAM credentials were accepted - because the
 * driver authenticates during the handshake, not on first command. The gate
 * refuses `TEST_URI_PASSWORD_MISSING`, so authentication is guaranteed to have
 * been attempted rather than skipped.
 *
 * A following `ping` confirms the server is responsive after authentication.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not enumerate databases, collections, users, or records. Enumerating
 * would require a privilege a correctly-scoped user should not hold, and it
 * would print other environments' database names into a log - which is exactly
 * how a mis-pointed connection becomes a disclosure. Confirming that the cluster
 * is genuinely empty is a manual Atlas step, not this probe's job.
 *
 * It creates nothing. No model is ever required, so `Model.init()` and
 * therefore `ensureIndexes()` never run, and both `autoIndex` and `autoCreate`
 * are additionally disabled. MongoDB creates a database lazily on first write,
 * so a connection alone creates no application database.
 *
 * THE TWO ANTI-FALLBACK CHECKS
 *
 * The target URI is read from `PHISHGUARD_TEST_MONGODB_URI` and from nowhere
 * else. `MONGODB_URI` is then required to EQUAL it. The launcher assigns
 * `MONGODB_URI` from the verified test URI, so this holds on the supported path;
 * the check exists so that a future regression, or a hand-run invocation with an
 * inherited `MONGODB_URI` pointing at development or production, fails loudly
 * instead of quietly connecting to the wrong cluster.
 *
 * OUTPUT DISCIPLINE
 *
 * Only fixed field names and fixed category strings are emitted. Driver errors
 * are reduced to a fixed category word. `message`,
 * `stack`, `client`, and any URL-bearing property are never read. Whether or
 * not a given driver error can actually reach the connection string has not been
 * established, so the rule is unconditional rather than conditional.
 *
 * This module imports nothing at load time. `mongoose` is required lazily inside
 * the CLI block, so requiring this file cannot open a connection.
 */

const { evaluateTestDatabaseEnvironment } = require("./testDatabaseIsolation");

/**
 * Every knob is bounded. The driver's documented default server-selection
 * timeout is 30 seconds, which means a blocked network looks like a hang rather
 * than a failure.
 */
const PROBE_TIMEOUT_MS = 10000;

const PROBE_TARGET_REASONS = Object.freeze({
  testUriMissing: "TEST_URI_MISSING",
  childUriMismatch: "CHILD_MONGODB_URI_MISMATCH",
  childUriMissing: "CHILD_MONGODB_URI_MISSING"
});

const PROBE_FAILURE_REASONS = Object.freeze({
  connectFailed: "CONNECT_FAILED",
  pingFailed: "PING_FAILED",
  disconnectFailed: "DISCONNECT_FAILED"
});

/**
 * Fixed error categories. Driver class names are mapped to these so no
 * driver-supplied text is ever emitted.
 */
const ERROR_CATEGORIES = Object.freeze({
  malformedUri: "malformed_uri",
  unreachable: "unreachable",
  networkBlocked: "network_blocked",
  timeout: "timeout",
  authenticationRejected: "authentication_rejected",
  serverRejected: "server_rejected",
  clientError: "client_error",
  unclassified: "unclassified"
});

const ERROR_NAME_CATEGORIES = Object.freeze({
  MongoParseError: ERROR_CATEGORIES.malformedUri,
  MongoInvalidArgumentError: ERROR_CATEGORIES.malformedUri,
  MongoServerSelectionError: ERROR_CATEGORIES.unreachable,
  MongooseServerSelectionError: ERROR_CATEGORIES.unreachable,
  MongoTopologyClosedError: ERROR_CATEGORIES.unreachable,
  MongoNotConnectedError: ERROR_CATEGORIES.unreachable,
  MongoNetworkError: ERROR_CATEGORIES.networkBlocked,
  MongoNetworkTimeoutError: ERROR_CATEGORIES.networkBlocked,
  MongoTimeoutError: ERROR_CATEGORIES.timeout,
  MongooseError: ERROR_CATEGORIES.clientError
});

// MongoDB server error code for authentication failure. Only ever used to derive
// a boolean category; the code itself is never printed.
const AUTHENTICATION_FAILURE_CODE = 18;

/**
 * Reduces a driver error to a fixed category word.
 *
 * Only `error.name` and a numeric `error.code` are read. `message`, `stack`, and
 * every other property are deliberately untouched.
 */
function classifyError(error) {
  if (!error || typeof error !== "object") {
    return { category: ERROR_CATEGORIES.unclassified };
  }

  const rawName = typeof error.name === "string" ? error.name : "";

  if (rawName === "MongoServerError") {
    return {
      category:
        error.code === AUTHENTICATION_FAILURE_CODE
          ? ERROR_CATEGORIES.authenticationRejected
          : ERROR_CATEGORIES.serverRejected
    };
  }

  return {
    category: Object.hasOwn(ERROR_NAME_CATEGORIES, rawName)
      ? ERROR_NAME_CATEGORIES[rawName]
      : ERROR_CATEGORIES.unclassified
  };
}

/**
 * Resolves the target and enforces both anti-fallback rules.
 *
 * Returns a reason code on refusal. Never returns the URI in the refusal.
 */
function resolveProbeTarget(env = {}) {
  const testUri = env.PHISHGUARD_TEST_MONGODB_URI;

  if (typeof testUri !== "string" || testUri.length === 0) {
    return { ok: false, reason: PROBE_TARGET_REASONS.testUriMissing };
  }

  const childUri = env.MONGODB_URI;

  if (typeof childUri !== "string" || childUri.length === 0) {
    return { ok: false, reason: PROBE_TARGET_REASONS.childUriMissing };
  }

  if (childUri !== testUri) {
    return { ok: false, reason: PROBE_TARGET_REASONS.childUriMismatch };
  }

  return { ok: true, testUri };
}

/**
 * The probe.
 *
 * Every collaborator is injected - environment, driver, and both streams - so the
 * success path, the failure paths, and the cleanup guarantees can all be
 * exercised offline without a socket, a database, or a process. Defaults are the
 * production collaborators.
 *
 * Returns an exit code. It never throws.
 */
async function runProbe({
  env = process.env,
  driver,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const report = (payload) => {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  };

  // 1. The launcher already ran the gate. Re-verify here anyway: this function
  //    holds a connection string, so it must not trust its caller.
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });

  if (!gate.ok) {
    report({
      ok: false,
      probe: "atlas-connectivity",
      stage: "isolation-gate",
      reason: gate.reason,
      connected: false,
      childProcessStarted: true,
      credentialsPrinted: false,
      connectionStringPrinted: false,
      realHostnamePrinted: false
    });
    stderr.write(
      "The isolation gate refused the probe. No connection was attempted.\n"
    );

    return 1;
  }

  // 2. Both anti-fallback rules.
  const target = resolveProbeTarget(env);

  if (!target.ok) {
    report({
      ok: false,
      probe: "atlas-connectivity",
      stage: "target-resolution",
      reason: target.reason,
      connected: false,
      childProcessStarted: true,
      credentialsPrinted: false,
      connectionStringPrinted: false,
      realHostnamePrinted: false
    });
    stderr.write(
      `Refused: ${target.reason}. No connection was attempted.\n`
    );

    return 1;
  }

  if (!driver) {
    report({
      ok: false,
      probe: "atlas-connectivity",
      stage: "driver",
      reason: "DRIVER_UNAVAILABLE",
      connected: false,
      childProcessStarted: true,
      credentialsPrinted: false,
      connectionStringPrinted: false,
      realHostnamePrinted: false
    });
    stderr.write("No database driver was supplied. No connection was attempted.\n");

    return 1;
  }

  // 3. Defensive, process-wide. Connection options below repeat both, so a model
  //    imported later in this one-shot process still cannot build anything.
  driver.set("autoIndex", false);
  driver.set("autoCreate", false);

  const commandsIssued = [];
  let connected = false;

  try {
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

    // 4. The one and only command. No enumeration of any kind.
    commandsIssued.push("ping");
    await driver.connection.db.command({ ping: 1 });
  } catch (error) {
    const classified = classifyError(error);

    report({
      ok: false,
      probe: "atlas-connectivity",
      stage: connected ? "ping" : "connect",
      reason: connected ? PROBE_FAILURE_REASONS.pingFailed : PROBE_FAILURE_REASONS.connectFailed,
      category: classified.category,
      connected,
      commandsIssued,
      credentialsPrinted: false,
      connectionStringPrinted: false,
      realHostnamePrinted: false
    });
    stderr.write(
      `The connectivity probe failed (${classified.category}). `
      + "Driver detail is suppressed so no credential can be logged.\n"
    );

    // Forced: a rejected connect can still leave a partially-initialised
    // connection behind, and the probe closes on every path it attempted one.
    await closeQuietly(driver, { force: true });

    return 1;
  }

  // 5. Always closed, on the success path too.
  const closed = await closeQuietly(driver);

  if (!closed) {
    report({
      ok: false,
      probe: "atlas-connectivity",
      stage: "disconnect",
      reason: PROBE_FAILURE_REASONS.disconnectFailed,
      connectionClosed: false
    });
    stderr.write("The connectivity probe could not confirm connection cleanup.\n");

    return 1;
  }

  report({
    ok: true,
    probe: "atlas-connectivity",
    stage: "complete",
    connected: true,
    pingSucceeded: true,
    commandsIssued,
    connectionClosed: closed,
    enumerated: false,
    recordsWritten: 0,
    credentialsPrinted: false,
    connectionStringPrinted: false,
    realHostnamePrinted: false
  });

  return 0;
}

/**
 * Closes the connection if one is open. Never throws and never prints, so a
 * disconnect failure can neither mask the probe's own outcome nor leak detail.
 *
 * `force` is used after a REJECTED connect. A driver may still be holding a
 * partially-initialised connection when `connect()` rejects, so the close is
 * attempted regardless of `readyState`. It is never forced on a path where no
 * connect was attempted, because there is nothing to close.
 *
 * Returns whether a close was actually performed.
 */
async function closeQuietly(driver, { force = false } = {}) {
  if (!driver || !driver.connection) {
    return false;
  }

  if (driver.connection.readyState === 0 && !force) {
    return false;
  }

  try {
    await driver.disconnect();

    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ERROR_CATEGORIES,
  PROBE_FAILURE_REASONS,
  PROBE_TARGET_REASONS,
  PROBE_TIMEOUT_MS,
  classifyError,
  closeQuietly,
  resolveProbeTarget,
  runProbe
};

if (require.main === module) {
  // Required here, not at module load, so requiring this file cannot connect.
  runProbe({ driver: require("mongoose") })
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Sanitized by construction: no error value is printed.
      process.stderr.write(
        "The connectivity probe failed unexpectedly. Details are suppressed so "
          + "no credential can be logged.\n"
      );
      process.exitCode = 1;
    });
}
