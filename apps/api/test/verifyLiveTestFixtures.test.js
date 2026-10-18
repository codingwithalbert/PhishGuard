"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");

const {
  verifyDocuments
} = require("../scripts/verifyLiveTestFixtures");

const { ROLE_ACCOUNTS } = require("../scripts/testFixturePlan");

const IDS = [
  "507f1f77bcf86cd799439011",
  "507f1f77bcf86cd799439012",
  "507f1f77bcf86cd799439013"
];

function createFixtures() {
  const entries = ROLE_ACCOUNTS.map((account, index) => ({
    collection: "users",
    stage: "roles",
    id: IDS[index],
    identity: {
      email: account.email,
      role: account.role
    }
  }));

  const documents = entries.map((entry) => ({
    _id: new ObjectId(entry.id),
    email: entry.identity.email,
    role: entry.identity.role,
    isActive: true
  }));

  return { entries, documents };
}

test("accepts the three original fixture records", () => {
  const { entries, documents } = createFixtures();

  assert.equal(verifyDocuments(documents, entries), true);
});

test("rejects a missing fixture record", () => {
  const { entries, documents } = createFixtures();

  documents.pop();

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects an unexpected document ID", () => {
  const { entries, documents } = createFixtures();

  documents[0]._id = new ObjectId(
    "507f1f77bcf86cd799439099"
  );

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects a duplicate document ID", () => {
  const { entries, documents } = createFixtures();

  documents[1]._id = documents[0]._id;

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects an incorrect email", () => {
  const { entries, documents } = createFixtures();

  documents[0].email = "unexpected@example.test";

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects an incorrect role", () => {
  const { entries, documents } = createFixtures();

  documents[1].role = "user";

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects an inactive fixture account", () => {
  const { entries, documents } = createFixtures();

  documents[2].isActive = false;

  assert.equal(verifyDocuments(documents, entries), false);
});

test("rejects a document without an ID", () => {
  const { entries, documents } = createFixtures();

  delete documents[0]._id;

  assert.equal(verifyDocuments(documents, entries), false);
});

test("accepts fixture records regardless of query result order", () => {
  const { entries, documents } = createFixtures();

  documents.reverse();

  assert.equal(verifyDocuments(documents, entries), true);
});

test("rejects additional unexpected records", () => {
  const { entries, documents } = createFixtures();

  documents.push({
    _id: new ObjectId("507f1f77bcf86cd799439099"),
    email: "extra@example.test",
    role: "user",
    isActive: true
  });

  assert.equal(verifyDocuments(documents, entries), false);
});


test("refuses an unauthorized environment without connecting", async () => {
  const { runLiveFixtureVerification } =
    require("../scripts/verifyLiveTestFixtures");

  let connectionAttempts = 0;
  let output = "";

  const fakeDriver = {
    async connect() {
      connectionAttempts += 1;
      throw new Error("Connection must never be attempted");
    }
  };

  const exitCode = await runLiveFixtureVerification({
    env: {},
    driver: fakeDriver,
    stdout: {
      write(chunk) {
        output += String(chunk);
      }
    }
  });

  const report = JSON.parse(output);

  assert.equal(exitCode, 1);
  assert.equal(connectionAttempts, 0);
  assert.equal(report.ok, false);
  assert.equal(report.code, "ISOLATION_GATE_REFUSED");
  assert.equal(report.connected, false);
});


const { closeQuietly } = require("../scripts/probeTestDatabase");

test("force cleanup disconnects an established connection", async () => {
  let disconnectCalls = 0;

  const driver = {
    connection: { readyState: 1 },
    async disconnect() {
      disconnectCalls += 1;
      this.connection.readyState = 0;
    }
  };

  const closed = await closeQuietly(driver, { force: true });

  assert.equal(closed, true);
  assert.equal(disconnectCalls, 1);
  assert.equal(driver.connection.readyState, 0);
});

test("force cleanup attempts disconnect after a failed connection", async () => {
  let disconnectCalls = 0;

  const driver = {
    connection: { readyState: 0 },
    async disconnect() {
      disconnectCalls += 1;
    }
  };

  const closed = await closeQuietly(driver, { force: true });

  assert.equal(closed, true);
  assert.equal(disconnectCalls, 1);
});

test("cleanup safely handles disconnect errors", async () => {
  const secret = "synthetic-secret-do-not-print";

  const driver = {
    connection: { readyState: 1 },
    async disconnect() {
      throw new Error(secret);
    }
  };

  const closed = await closeQuietly(driver, { force: true });

  assert.equal(closed, false);
});


const integrationFs = require("node:fs");
const integrationOs = require("node:os");
const integrationPath = require("node:path");

const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE
} = require("../scripts/testDatabaseIsolation");

const {
  createManifest,
  atomicWriteRecord,
  writeLifecycle,
  lockPath
} = require("../scripts/testFixtureManifest");

const {
  runLiveFixtureVerification,
  VERIFY_CODES
} = require("../scripts/verifyLiveTestFixtures");

const INTEGRATION_SECRET = "synthetic-test-secret-".repeat(3);
const INTEGRATION_CLUSTER = "phishguard-s5-test";
const INTEGRATION_HOST =
  "phishguard-s5-test.abcdef12.mongodb.net";
const INTEGRATION_DATABASE = "phishguard_s5_disposable";
const INTEGRATION_USER = "phishguard_s5_runner";
const INTEGRATION_PASSWORD = "not-a-real-secret-placeholder";

const INTEGRATION_URI =
  `mongodb+srv://${INTEGRATION_USER}:${INTEGRATION_PASSWORD}` +
  `@${INTEGRATION_HOST}/${INTEGRATION_DATABASE}?retryWrites=true`;

function createIntegrationFixture(t) {
  const directory = integrationFs.mkdtempSync(
    integrationPath.join(
      integrationOs.tmpdir(),
      "phishguard-s5g-c-offline-"
    )
  );

  t.after(() => {
    integrationFs.rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  const manifestPath = integrationPath.join(
    directory,
    "fixture-manifest.json"
  );

  const target = {
    cluster: INTEGRATION_CLUSTER,
    database: INTEGRATION_DATABASE
  };

  const runId = "synthetic-s5g-c-run";

  const entries = ROLE_ACCOUNTS.map((account, index) => ({
    collection: "users",
    stage: "roles",
    id: IDS[index],
    identity: {
      email: account.email,
      role: account.role
    }
  }));

  const initialManifest = createManifest(
    { runId, target },
    INTEGRATION_SECRET
  );

  atomicWriteRecord(
    manifestPath,
    {
      ...initialManifest,
      completedStages: ["roles"],
      activeStage: null,
      entries
    },
    INTEGRATION_SECRET
  );

  writeLifecycle(
    manifestPath,
    {
      runId,
      target,
      status: "started"
    },
    INTEGRATION_SECRET
  );

  const env = {
    PHISHGUARD_ALLOW_LIVE_TESTS:
      LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED:
      ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED:
      DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: INTEGRATION_CLUSTER,
    PHISHGUARD_TEST_CLUSTER_HOST: INTEGRATION_HOST,
    PHISHGUARD_TEST_DATABASE: INTEGRATION_DATABASE,
    PHISHGUARD_TEST_DB_USER: INTEGRATION_USER,
    PHISHGUARD_TEST_MONGODB_URI: INTEGRATION_URI,
    MONGODB_URI: INTEGRATION_URI,
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "",
    PHISHGUARD_TEST_MANIFEST_SECRET: INTEGRATION_SECRET,
    PHISHGUARD_TEST_MANIFEST: manifestPath
  };

  const documents = entries.map((entry) => ({
    _id: new ObjectId(entry.id),
    email: entry.identity.email,
    role: entry.identity.role,
    isActive: true
  }));

  return {
    env,
    entries,
    documents,
    manifestPath
  };
}

function createIntegrationDriver({
  documents = [],
  connectError = null,
  readError = null,
  disconnectError = null,
  configurationError = null
} = {}) {
  const calls = {
    set: [],
    connect: [],
    collection: [],
    find: [],
    limit: [],
    toArray: 0,
    disconnect: 0
  };

  let readyState = 0;

  const driver = {
    set(key, value) {
      calls.set.push([key, value]);

      if (configurationError) {
        throw configurationError;
      }
    },

    async connect(uri, options) {
      calls.connect.push({ uri, options });

      if (connectError) {
        throw connectError;
      }

      readyState = 1;
    },

    connection: {
      get readyState() {
        return readyState;
      },

      db: {
        collection(name) {
          calls.collection.push(name);

          return {
            find(filter, options) {
              calls.find.push({ filter, options });

              return {
                limit(number) {
                  calls.limit.push(number);

                  return {
                    async toArray() {
                      calls.toArray += 1;

                      if (readError) {
                        throw readError;
                      }

                      return documents;
                    }
                  };
                }
              };
            }
          };
        }
      }
    },

    async disconnect() {
      calls.disconnect += 1;

      if (disconnectError) {
        throw disconnectError;
      }

      readyState = 0;
    }
  };

  return { driver, calls };
}

async function executeIntegrationVerifier(env, driver) {
  const chunks = [];

  const exitCode = await runLiveFixtureVerification({
    env,
    driver,
    stdout: {
      write(chunk) {
        chunks.push(String(chunk));
      }
    }
  });

  const output = chunks.join("");

  return {
    exitCode,
    output,
    report: JSON.parse(output)
  };
}

test("verifies fixtures with exactly one restricted read", async (t) => {
  const fixture = createIntegrationFixture(t);

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.code, VERIFY_CODES.verified);
  assert.equal(result.report.recordsVerified, 3);
  assert.equal(result.report.readOnly, true);
  assert.equal(result.report.recordsWritten, 0);
  assert.equal(result.report.connectionClosed, true);

  assert.equal(calls.connect.length, 1);
  assert.equal(calls.connect[0].uri, INTEGRATION_URI);

  assert.deepEqual(calls.set, [
    ["autoIndex", false],
    ["autoCreate", false]
  ]);

  assert.equal(calls.connect[0].options.autoIndex, false);
  assert.equal(calls.connect[0].options.autoCreate, false);

  assert.deepEqual(calls.collection, ["users"]);
  assert.equal(calls.find.length, 1);
  assert.deepEqual(calls.limit, [4]);
  assert.equal(calls.toArray, 1);
  assert.equal(calls.disconnect, 1);

  const query = calls.find[0];

  assert.deepEqual(
    Object.keys(query.filter),
    ["_id"]
  );

  assert.deepEqual(
    Object.keys(query.filter._id),
    ["$in"]
  );

  assert.deepEqual(
    query.filter._id.$in.map((id) => id.toHexString()),
    fixture.entries.map((entry) => entry.id)
  );

  assert.deepEqual(query.options.projection, {
    _id: 1,
    email: 1,
    role: 1,
    isActive: 1
  });

  assert.equal(
    result.output.includes(INTEGRATION_PASSWORD),
    false
  );

  assert.equal(
    result.output.includes(INTEGRATION_URI),
    false
  );
});

test("rejects incorrect fixture data and disconnects", async (t) => {
  const fixture = createIntegrationFixture(t);

  fixture.documents[0].isActive = false;

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(
    result.report.code,
    VERIFY_CODES.recordsMismatch
  );
  assert.equal(calls.disconnect, 1);
});

test("handles connection failure and attempts cleanup", async (t) => {
  const fixture = createIntegrationFixture(t);

  const { driver, calls } = createIntegrationDriver({
    connectError: new Error(
      "synthetic connection error: " + INTEGRATION_PASSWORD
    )
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(
    result.report.code,
    VERIFY_CODES.connectFailed
  );
  assert.equal(calls.connect.length, 1);
  assert.equal(calls.find.length, 0);
  assert.equal(calls.disconnect, 1);
  assert.equal(result.report.connectionClosed, true);
  assert.equal(
    result.output.includes(INTEGRATION_PASSWORD),
    false
  );
});

test("handles read failure and disconnects", async (t) => {
  const fixture = createIntegrationFixture(t);

  const { driver, calls } = createIntegrationDriver({
    readError: new Error(
      "synthetic read error: " + INTEGRATION_PASSWORD
    )
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.code, VERIFY_CODES.readFailed);
  assert.equal(calls.find.length, 1);
  assert.equal(calls.disconnect, 1);
  assert.equal(
    result.output.includes(INTEGRATION_PASSWORD),
    false
  );
});

test("never reports success when disconnect fails", async (t) => {
  const fixture = createIntegrationFixture(t);

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents,
    disconnectError: new Error("synthetic disconnect error")
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(
    result.report.code,
    VERIFY_CODES.disconnectFailed
  );
  assert.equal(result.report.connectionClosed, false);
  assert.equal(calls.disconnect, 1);
});

test("refuses an altered manifest before connecting", async (t) => {
  const fixture = createIntegrationFixture(t);

  const manifest = JSON.parse(
    integrationFs.readFileSync(
      fixture.manifestPath,
      "utf8"
    )
  );

  manifest.entries[0].identity.role = "unexpected-role";

  integrationFs.writeFileSync(
    fixture.manifestPath,
    JSON.stringify(manifest),
    "utf8"
  );

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(calls.connect.length, 0);
  assert.equal(calls.find.length, 0);
});

test("refuses a fixture lifecycle lock before connecting", async (t) => {
  const fixture = createIntegrationFixture(t);

  integrationFs.writeFileSync(
    lockPath(fixture.manifestPath),
    "synthetic-lock",
    "utf8"
  );

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(calls.connect.length, 0);
});

test("refuses a mismatched database URI before connecting", async (t) => {
  const fixture = createIntegrationFixture(t);

  fixture.env.MONGODB_URI =
    "mongodb+srv://someone:fake@production.mongodb.net/production";

  const { driver, calls } = createIntegrationDriver({
    documents: fixture.documents
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(calls.connect.length, 0);
});

test("handles driver configuration errors without connecting", async (t) => {
  const fixture = createIntegrationFixture(t);

  const { driver, calls } = createIntegrationDriver({
    configurationError: new Error(
      "synthetic configuration error: " + INTEGRATION_PASSWORD
    )
  });

  const result = await executeIntegrationVerifier(
    fixture.env,
    driver
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(calls.connect.length, 0);
  assert.equal(
    result.output.includes(INTEGRATION_PASSWORD),
    false
  );
});
