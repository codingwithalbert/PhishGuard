const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE
} = require("../scripts/testDatabaseIsolation");
const { S5_COMMANDS, describeCommands, resolveCommand } = require("../scripts/s5CommandRunner");
const {
  ERROR_CATEGORIES
} = require("../scripts/probeTestDatabase");
const {
  FORBIDDEN_COLLECTION_NAMES,
  PROBE_COLLECTION_PREFIX,
  TRANSACTION_OPTIONS,
  VERIFY_FAILURE_REASONS,
  VERIFY_TIMEOUT_MS,
  buildProbeCollectionName,
  isSafeProbeCollectionName,
  runTransactionVerification
} = require("../scripts/verifyTransactionCapability");

// Gated transaction-capability verifier (A2).
//
// Every test here is offline. No socket is opened, no database is contacted, no
// record is read or written. The driver and session are hand-written fakes whose
// every call is recorded, so "aborted on this path" and "closed on that path"
// are observations rather than inferences.
//
// The properties that matter most:
//   - the gate is re-verified in-process, before anything connects;
//   - the transaction is opened with exactly snapshot + majority;
//   - one probe document is written to a synthetic a2_probe_* collection, never
//     to an application collection, and never after pre-creating it;
//   - the transaction is aborted on every path after it starts, and the client
//     is closed on every path a connection was attempted;
//   - the success report is only emitted once the rollback is confirmed;
//   - no URI, host, user, replica-set name, collection name, marker, or raw
//     driver error can reach the output.

const SYNTHETIC_USER = "phishguard_s5_runner";
const SYNTHETIC_PASSWORD = "not-a-real-secret-placeholder";
const SYNTHETIC_CLUSTER = "phishguard-s5-test";
const SYNTHETIC_HOST = "phishguard-s5-test.abcdef12.mongodb.net";
const SYNTHETIC_DATABASE = "phishguard_s5_disposable";
const SYNTHETIC_URI =
  `mongodb+srv://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`
  + `/${SYNTHETIC_DATABASE}?retryWrites=true`;

const UNSAFE_URI =
  "mongodb+srv://someone:leaked@prod-cluster.mongodb.net/production";

const FIXED_HEX = "0123456789abcdef";

function validEnvironment(overrides = {}) {
  return {
    PHISHGUARD_ALLOW_LIVE_TESTS: LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: SYNTHETIC_CLUSTER,
    PHISHGUARD_TEST_CLUSTER_HOST: SYNTHETIC_HOST,
    PHISHGUARD_TEST_DATABASE: SYNTHETIC_DATABASE,
    PHISHGUARD_TEST_DB_USER: SYNTHETIC_USER,
    PHISHGUARD_TEST_MONGODB_URI: SYNTHETIC_URI,
    // The launcher assigns this, so a valid run always carries it.
    MONGODB_URI: SYNTHETIC_URI,
    // ...and it records what the shell carried before substitution. Empty means
    // the shell was clean, which is the normal case.
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "",
    ...overrides
  };
}

function createRecorder() {
  const chunks = [];

  return {
    chunks,
    stream: { write: (chunk) => chunks.push(String(chunk)) },
    text: () => chunks.join("")
  };
}

/**
 * A driver + session fake. Every interaction is recorded and assertable.
 *
 * The fake deliberately mirrors the shape the verifier uses: mongoose-style
 * `connect`/`disconnect`/`set`/`startSession`, a `connection.db` with
 * `collection` and `listCollections`, and a session with
 * `startTransaction`/`abortTransaction`/`endSession`.
 */
function createFakeDriver({
  connectError = null,
  sessionError = null,
  startTransactionError = null,
  insertError = null,
  inSessionReadError = null,
  inSessionReadVisible = true,
  abortError = null,
  endSessionError = null,
  disconnectError = null,
  postAbortFindOne = null,
  listCollectionsResult = []
} = {}) {
  const calls = {
    set: [],
    connect: [],
    startSession: 0,
    collections: {},
    listCollections: [],
    disconnect: 0
  };

  const state = { readyState: 0 };
  const collections = new Map();

  function collectionFor(name) {
    if (!collections.has(name)) {
      const inserted = [];
      const record = {
        name,
        inserted,
        calls: { insertOne: [], findOne: [] },
        async insertOne(document, options) {
          record.calls.insertOne.push({ document, options });

          if (insertError) {
            throw insertError;
          }

          inserted.push(document);
        },
        async findOne(filter, options) {
          record.calls.findOne.push({ filter, options });

          const inSession = Boolean(options && options.session);

          if (inSession) {
            if (inSessionReadError) {
              throw inSessionReadError;
            }

            if (!inSessionReadVisible) {
              return null;
            }

            return inserted.find((document) => document.marker === filter.marker) || null;
          }

          return postAbortFindOne;
        }
      };

      collections.set(name, record);
      calls.collections[name] = record;
    }

    return collections.get(name);
  }

  const session = {
    calls: { startTransaction: [], abortTransaction: 0, endSession: 0 },
    startTransaction(options) {
      this.calls.startTransaction.push(options);

      if (startTransactionError) {
        throw startTransactionError;
      }
    },
    async abortTransaction() {
      this.calls.abortTransaction += 1;

      if (abortError) {
        throw abortError;
      }
    },
    async endSession() {
      this.calls.endSession += 1;

      if (endSessionError) {
        throw endSessionError;
      }
    }
  };

  const driver = {
    calls,
    session,
    set(key, value) {
      calls.set.push({ key, value });
    },
    async connect(uri, options) {
      calls.connect.push({ uri, options });

      if (connectError) {
        throw connectError;
      }

      state.readyState = 1;
    },
    async startSession() {
      calls.startSession += 1;

      if (sessionError) {
        throw sessionError;
      }

      return session;
    },
    connection: {
      get readyState() {
        return state.readyState;
      },
      db: {
        collection(name) {
          return collectionFor(name);
        },
        listCollections(filter, options) {
          calls.listCollections.push({ filter, options });

          return { toArray: async () => listCollectionsResult };
        }
      }
    },
    async disconnect() {
      calls.disconnect += 1;
      state.readyState = 0;

      if (disconnectError) {
        throw disconnectError;
      }
    }
  };

  return driver;
}

async function verify(env, driver, randomHex = () => FIXED_HEX) {
  const stdout = createRecorder();
  const stderr = createRecorder();

  const code = await runTransactionVerification({
    env,
    driver,
    stdout: stdout.stream,
    stderr: stderr.stream,
    randomHex
  });

  let parsed = null;

  try {
    parsed = JSON.parse(stdout.text());
  } catch {
    parsed = null;
  }

  return {
    code,
    report: parsed,
    stdout,
    stderr,
    output: `${stdout.text()}${stderr.text()}`
  };
}

// ---------------------------------------------------------------------------
// 1. The gate is re-verified in-process, before anything connects
// ---------------------------------------------------------------------------

test("an unauthorised verifier connects nothing", async () => {
  const driver = createFakeDriver();
  const result = await verify({ MONGODB_URI: SYNTHETIC_URI }, driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0, "no connection may be attempted");
  assert.equal(driver.calls.disconnect, 0, "there is nothing to close");
  assert.equal(result.report.stage, "isolation-gate");
  assert.equal(result.report.reason, "LIVE_TESTS_NOT_AUTHORIZED");
  assert.equal(result.report.connected, false);
});

test("a missing declaration connects nothing", async () => {
  const driver = createFakeDriver();
  const env = validEnvironment();

  delete env.PHISHGUARD_TEST_DB_USER;

  const result = await verify(env, driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0);
  assert.equal(result.report.reason, "TEST_DECLARATION_INCOMPLETE");
});

test("a mismatched child MONGODB_URI is refused before connecting", async () => {
  const driver = createFakeDriver();
  const result = await verify(validEnvironment({ MONGODB_URI: UNSAFE_URI }), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0, "a mismatch must connect nothing");
  assert.equal(result.report.reason, "TEST_URI_EQUALS_ACTIVE_MONGODB_URI");
});

test("a missing driver connects nothing", async () => {
  const result = await verify(validEnvironment(), null);

  assert.equal(result.code, 1);
  assert.equal(result.report.stage, "driver");
  assert.equal(result.report.reason, "DRIVER_UNAVAILABLE");
});

test("the verifier connects only after the gate, never before", async () => {
  const refused = await verify({}, createFakeDriver());

  assert.equal(refused.code, 1);

  const driver = createFakeDriver();
  const allowed = await verify(validEnvironment(), driver);

  assert.equal(allowed.code, 0);
  assert.equal(driver.calls.connect.length, 1);
});

test("the verifier connects using the verified test URI and nothing else", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  assert.equal(driver.calls.connect[0].uri, SYNTHETIC_URI);
  assert.equal(driver.calls.connect[0].uri.includes("prod-cluster"), false);
});

test("an inherited unsafe MONGODB_URI is never used as the target", async () => {
  const driver = createFakeDriver();
  const result = await verify(validEnvironment({ MONGODB_URI: UNSAFE_URI }), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0);
  assert.equal(driver.calls.connect.some((call) => call.uri === UNSAFE_URI), false);
});

// ---------------------------------------------------------------------------
// 2. Exact transaction options
// ---------------------------------------------------------------------------

test("the transaction is opened with exactly snapshot and majority", async () => {
  const driver = createFakeDriver();
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 0);
  assert.deepEqual(driver.session.calls.startTransaction, [
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }
  ]);
});

test("the required transaction options are frozen and explicit", () => {
  assert.deepEqual(TRANSACTION_OPTIONS, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" }
  });
  assert.equal(Object.isFrozen(TRANSACTION_OPTIONS), true);
});

test("the transaction options are not taken from any driver default", async () => {
  // The application connection sets no write concern; majority must be asked for
  // explicitly. Asserting the exact object proves it was not omitted.
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  const options = driver.session.calls.startTransaction[0];

  assert.equal(options.writeConcern.w, "majority");
  assert.equal(options.readConcern.level, "snapshot");
});

// ---------------------------------------------------------------------------
// 3. Probe collection naming and forbidden-name rejection
// ---------------------------------------------------------------------------

test("a generated probe collection name is synthetic and random-suffixed", () => {
  const name = buildProbeCollectionName(FIXED_HEX);

  assert.equal(name, "a2_probe_0123456789abcdef");
  assert.equal(name.startsWith(PROBE_COLLECTION_PREFIX), true);
  assert.equal(isSafeProbeCollectionName(name), true);
});

test("forbidden application collections are rejected", () => {
  for (const name of ["users", "auditLogs", "systemLocks"]) {
    assert.equal(isSafeProbeCollectionName(name), false, `${name} must be refused`);
  }

  for (const forbidden of FORBIDDEN_COLLECTION_NAMES) {
    assert.equal(isSafeProbeCollectionName(forbidden), false);
  }
});

test("a non-probe-shaped name is rejected", () => {
  for (const name of [
    "",
    "a2_probe_",
    "a2_probe_zzzzzzzzzzzzzzzz",
    "a2_probe_0123456789ABCDEF",
    "a2_probe_0123456789abcde",
    "users_2",
    "a2_probe_0123456789abcdef0"
  ]) {
    assert.equal(isSafeProbeCollectionName(name), false, `${name} must be refused`);
  }
});

test("buildProbeCollectionName refuses an invalid random source", () => {
  for (const source of ["", "not-hex", "0123", "0123456789ABCDEF", undefined, 42]) {
    assert.throws(() => buildProbeCollectionName(source));
  }
});

test("the verifier only ever resolves an a2_probe_ collection", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  const names = Object.keys(driver.calls.collections);

  assert.equal(names.length, 1, "exactly one collection may be opened");
  assert.equal(names[0], "a2_probe_0123456789abcdef");
  assert.equal(isSafeProbeCollectionName(names[0]), true);
  assert.equal(FORBIDDEN_COLLECTION_NAMES.includes(names[0].toLowerCase()), false);
});

test("the probe collection is never pre-created", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  const collection = driver.calls.collections["a2_probe_0123456789abcdef"];

  // One insert, one in-session read, one rollback read. No create, no index.
  assert.equal(collection.calls.insertOne.length, 1);
  assert.equal(collection.calls.findOne.length, 2);
  assert.equal(driver.calls.listCollections.length, 1);
  assert.equal(driver.calls.listCollections[0].filter.name, "a2_probe_0123456789abcdef");
});

test("the single write carries a unique synthetic marker", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  const collection = driver.calls.collections["a2_probe_0123456789abcdef"];
  const written = collection.calls.insertOne[0].document;

  assert.equal(written.marker, "a2_marker_0123456789abcdef");
  assert.equal(written.purpose, "a2-transaction-capability-probe");
  assert.ok(written.createdAt instanceof Date);
  assert.equal(collection.calls.insertOne[0].options.session, driver.session);
});

// ---------------------------------------------------------------------------
// 4. The successful path and the rollback evidence
// ---------------------------------------------------------------------------

test("a valid configuration reports a successful, durable-write-free check", async () => {
  const driver = createFakeDriver();
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 0);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.verifier, "transaction-capability");
  assert.equal(result.report.stage, "complete");
  assert.equal(result.report.connected, true);
  assert.equal(result.report.sessionCreated, true);
  assert.equal(result.report.transactionStarted, true);
  assert.equal(result.report.aborted, true);
  assert.equal(result.report.sessionEnded, true);
  assert.equal(result.report.connectionClosed, true);
  assert.equal(result.report.durableProbeRecordsLeft, 0);
});

test("the success path confirms the marker and collection are gone", async () => {
  const driver = createFakeDriver();
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.report.rollbackMarkerAbsent, true);
  assert.equal(result.report.rollbackCollectionAbsent, true);
  assert.equal(result.report.inSessionReadVisible, true);
});

test("the success report states the options it verified", async () => {
  const result = await verify(validEnvironment(), createFakeDriver());

  assert.deepEqual(result.report.transactionOptions, {
    readConcern: "snapshot",
    writeConcern: "majority"
  });
});

test("the rollback read is issued without a session", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  const reads = driver.calls.collections["a2_probe_0123456789abcdef"].calls.findOne;

  assert.equal(Boolean(reads[0].options.session), true, "the first read is in-session");
  assert.equal(
    Boolean(reads[1].options && reads[1].options.session),
    false,
    "the rollback read has no session"
  );
});

// ---------------------------------------------------------------------------
// 5. Abort and close on every path
// ---------------------------------------------------------------------------

test("the transaction is aborted on the success path", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.session.calls.endSession, 1);
});

test("the transaction is aborted when the insert fails", async () => {
  const driver = createFakeDriver({
    insertError: Object.assign(new Error("boom"), { name: "MongoServerError" })
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("the transaction is aborted when the in-session read fails", async () => {
  const driver = createFakeDriver({
    inSessionReadError: Object.assign(new Error("boom"), { name: "MongoNetworkError" })
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.inSessionReadFailed);
  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("the transaction is aborted when the rollback check fails", async () => {
  const driver = createFakeDriver({
    postAbortFindOne: { marker: "a2_marker_0123456789abcdef" }
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.rollbackMarkerPresent);
  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("abort failure is reported and the client is still closed", async () => {
  const driver = createFakeDriver({
    abortError: Object.assign(new Error("boom"), { name: "MongoServerError" })
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.abortFailed);
  assert.equal(result.report.aborted, false);
  assert.equal(driver.calls.disconnect, 1, "close must still run");
});

test("no abort is attempted when the transaction never started", async () => {
  // Aborting a session with no open transaction is meaningless, so the verifier
  // only aborts once the transaction has begun.
  const sessionDriver = createFakeDriver({ sessionError: new Error("boom") });
  const sessionFailure = await verify(validEnvironment(), sessionDriver);

  assert.equal(sessionFailure.code, 1);
  assert.equal(sessionFailure.report.reason, VERIFY_FAILURE_REASONS.sessionStartFailed);
  assert.equal(sessionDriver.session.calls.abortTransaction, 0);

  const startDriver = createFakeDriver({
    startTransactionError: Object.assign(new Error("boom"), { name: "MongoServerError" })
  });
  const startFailure = await verify(validEnvironment(), startDriver);

  assert.equal(startFailure.code, 1);
  assert.equal(startFailure.report.reason, VERIFY_FAILURE_REASONS.transactionStartFailed);
  assert.equal(startDriver.session.calls.abortTransaction, 0);
});

test("the client is closed on every connect-attempted path", async () => {
  const cases = [
    { driver: createFakeDriver({ connectError: Object.assign(new Error("boom"), { name: "MongoServerSelectionError" }) }), closed: true },
    { driver: createFakeDriver({ sessionError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ startTransactionError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ insertError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ inSessionReadError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ abortError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ endSessionError: new Error("boom") }), closed: true },
    { driver: createFakeDriver({ disconnectError: new Error("boom") }), closed: false },
    { driver: createFakeDriver(), closed: true }
  ];

  for (const { driver, closed } of cases) {
    const result = await verify(validEnvironment(), driver);

    assert.equal(driver.calls.disconnect, 1, "the client must be closed exactly once");
    assert.equal(result.report.connectionClosed, closed);
  }
});

test("a failed connection is still closed", async () => {
  const driver = createFakeDriver({
    connectError: Object.assign(new Error("boom"), { name: "MongoServerSelectionError" })
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.stage, "connect");
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.connectFailed);
  assert.equal(driver.calls.disconnect, 1);
});

test("a failed session is still closed", async () => {
  const driver = createFakeDriver({ sessionError: new Error("boom") });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.sessionStartFailed);
  assert.equal(driver.calls.disconnect, 1);
});

test("a failed disconnect is itself a sanitized failure", async () => {
  const driver = createFakeDriver({
    disconnectError: new Error(`socket already closed at ${SYNTHETIC_URI}`)
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.stage, "disconnect");
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.disconnectFailed);
  assert.equal(result.report.connectionClosed, false);
  assert.equal(driver.calls.disconnect, 1);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
});

test("a failed session end is reported and the client is still closed", async () => {
  const driver = createFakeDriver({ endSessionError: new Error("boom") });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.sessionEndFailed);
  assert.equal(result.report.sessionEnded, false);
  assert.equal(driver.calls.disconnect, 1);
});

test("a refused verifier never opens a connection to close", async () => {
  const driver = createFakeDriver();
  await verify({}, driver);

  assert.equal(driver.calls.disconnect, 0);
});

// ---------------------------------------------------------------------------
// 6. Rollback verification outcomes
// ---------------------------------------------------------------------------

test("a leftover marker fails the rollback check", async () => {
  const driver = createFakeDriver({
    postAbortFindOne: { marker: "a2_marker_0123456789abcdef" }
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.stage, "rollback-check");
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.rollbackMarkerPresent);
});

test("a leftover collection fails the rollback check", async () => {
  const driver = createFakeDriver({
    listCollectionsResult: [{ name: "a2_probe_0123456789abcdef", type: "collection" }]
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.rollbackCollectionPresent);
});

test("a document that is invisible inside the transaction fails", async () => {
  const driver = createFakeDriver({ inSessionReadVisible: false });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.inSessionReadMissing);
  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("rollback collection absence is confirmed with a name filter", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  assert.deepEqual(driver.calls.listCollections[0].filter, {
    name: "a2_probe_0123456789abcdef"
  });
  assert.equal(driver.calls.listCollections[0].options.nameOnly, true);
});

// ---------------------------------------------------------------------------
// 7. Implicit collection creation inside a transaction
// ---------------------------------------------------------------------------

test("an implicitly created collection rejected by the server is a fixed code", async () => {
  const driver = createFakeDriver({
    insertError: Object.assign(
      new Error("Cannot create namespace phishguard_s5_disposable.a2_probe_x in multi-document transaction"),
      { name: "MongoServerError", code: 263 }
    )
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(
    result.report.reason,
    VERIFY_FAILURE_REASONS.probeCollectionCreationRejected
  );
  assert.equal(result.report.stage, "insert");
  assert.equal(driver.session.calls.abortTransaction, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("the collection-creation-rejected output leaks no server message", async () => {
  const driver = createFakeDriver({
    insertError: Object.assign(
      new Error(`Cannot create namespace at ${SYNTHETIC_URI}`),
      { name: "MongoServerError", code: 263 }
    )
  });
  const result = await verify(validEnvironment(), driver);

  assert.equal(result.output.includes("Cannot create"), false);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
});

// ---------------------------------------------------------------------------
// 8. Output sanitization
// ---------------------------------------------------------------------------

test("the success path prints no credential, host, collection, or marker", async () => {
  const result = await verify(validEnvironment(), createFakeDriver());

  for (const secret of [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER,
    SYNTHETIC_URI,
    SYNTHETIC_HOST,
    SYNTHETIC_CLUSTER,
    "mongodb+srv://",
    "a2_probe_",
    "a2_marker_"
  ]) {
    assert.equal(result.output.includes(secret), false, `must not contain ${secret}`);
  }

  assert.match(result.stdout.text(), /"credentialsPrinted": false/);
  assert.match(result.stdout.text(), /"connectionStringPrinted": false/);
  assert.match(result.stdout.text(), /"realHostnamePrinted": false/);
});

test("a hostile driver error carrying a connection string leaks nothing", async () => {
  const hostile = Object.assign(
    new Error(`Authentication failed for ${SYNTHETIC_URI}`),
    {
      name: "MongoServerError",
      code: 18,
      stack: `Error: secret\n    at ${SYNTHETIC_URI}`,
      client: { url: SYNTHETIC_URI },
      connectionString: SYNTHETIC_URI
    }
  );

  const result = await verify(validEnvironment(), createFakeDriver({ insertError: hostile }));

  for (const secret of [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER,
    SYNTHETIC_URI,
    UNSAFE_URI,
    SYNTHETIC_HOST,
    "mongodb+srv://",
    "Authentication failed",
    "leaked",
    "prod-cluster"
  ]) {
    assert.equal(
      result.output.includes(secret),
      false,
      `verifier output must not contain ${secret}`
    );
  }

  assert.equal(result.report.category, ERROR_CATEGORIES.authenticationRejected);
});

test("a hostile error name is reduced to a fixed category", async () => {
  const result = await verify(
    validEnvironment(),
    createFakeDriver({
      insertError: { name: "PrivateHostAndCredentialMarker", message: SYNTHETIC_URI }
    })
  );

  assert.equal(result.report.category, ERROR_CATEGORIES.unclassified);
  assert.equal(result.output.includes("PrivateHostAndCredentialMarker"), false);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
});

test("the failure report carries only fixed reason and category fields", async () => {
  const result = await verify(
    validEnvironment(),
    createFakeDriver({ connectError: Object.assign(new Error("boom"), { name: "MongoServerSelectionError" }) })
  );

  assert.equal(result.report.category, ERROR_CATEGORIES.unreachable);
  assert.equal(result.report.reason, VERIFY_FAILURE_REASONS.connectFailed);
  assert.equal(Object.hasOwn(result.report, "errorName"), false);
  assert.equal(Object.hasOwn(result.report, "message"), false);
  assert.equal(Object.hasOwn(result.report, "collectionName"), false);
  assert.equal(Object.hasOwn(result.report, "marker"), false);
});

// ---------------------------------------------------------------------------
// 9. Bounded timeouts and creation disabled
// ---------------------------------------------------------------------------

test("the connection uses bounded timeouts", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);
  const options = driver.calls.connect[0].options;

  assert.equal(options.serverSelectionTimeoutMS, VERIFY_TIMEOUT_MS);
  assert.equal(options.connectTimeoutMS, VERIFY_TIMEOUT_MS);
  assert.equal(options.socketTimeoutMS, VERIFY_TIMEOUT_MS);
  assert.equal(options.maxPoolSize, 1);
  assert.equal(options.minPoolSize, 0);
});

test("the verifier timeout is bounded below the driver default", () => {
  assert.equal(VERIFY_TIMEOUT_MS, 10000);
  assert.ok(VERIFY_TIMEOUT_MS < 30000);
});

test("automatic index and collection creation are disabled twice over", async () => {
  const driver = createFakeDriver();
  await verify(validEnvironment(), driver);

  assert.deepEqual(driver.calls.set, [
    { key: "autoIndex", value: false },
    { key: "autoCreate", value: false }
  ]);

  const options = driver.calls.connect[0].options;

  assert.equal(options.autoIndex, false);
  assert.equal(options.autoCreate, false);
});

test("no model or service is loaded by the verifier", () => {
  const fs = require("node:fs");
  const source = fs
    .readFileSync(
      path.resolve(__dirname, "..", "scripts", "verifyTransactionCapability.js"),
      "utf8"
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/src\/models/.test(source), false, "no model may be required");
  assert.equal(/src\/services/.test(source), false, "no service may be required");
  assert.equal(/seedTestFixtures/.test(source), false);
});

// ---------------------------------------------------------------------------
// 10. Importing the module connects nothing
// ---------------------------------------------------------------------------

test("requiring the verifier connects nothing and prints nothing", () => {
  const before = process.exitCode;
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  let wrote = 0;

  process.stdout.write = () => {
    wrote += 1;

    return true;
  };
  process.stderr.write = () => {
    wrote += 1;

    return true;
  };

  try {
    delete require.cache[require.resolve("../scripts/verifyTransactionCapability.js")];

    const required = require("../scripts/verifyTransactionCapability.js");

    assert.equal(typeof required.runTransactionVerification, "function");
    assert.equal(wrote, 0, "importing must print nothing");
    assert.equal(process.exitCode, before, "importing must not set an exit code");

    const driverLoaded = Object.keys(require.cache).some(
      (key) => /[\\/]mongoose[\\/]index\.js$/.test(key)
    );

    assert.equal(driverLoaded, false, "requiring the verifier must not load the driver");
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
});

test("the real entry point refuses an unauthorised run without connecting", () => {
  const apiDir = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(apiDir, "scripts", "verifyTransactionCapability.js")],
    {
      cwd: apiDir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        MONGODB_URI: UNSAFE_URI
      }
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /LIVE_TESTS_NOT_AUTHORIZED/);
  assert.match(result.stdout, /"connected": false/);
  assert.match(result.stderr, /No connection was attempted/);
  assert.equal(`${result.stdout}${result.stderr}`.includes("leaked"), false);
});

test("the real entry point refuses a target mismatch without connecting", () => {
  const apiDir = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(apiDir, "scripts", "verifyTransactionCapability.js")],
    {
      cwd: apiDir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...validEnvironment({ MONGODB_URI: UNSAFE_URI })
      }
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /TEST_URI_EQUALS_ACTIVE_MONGODB_URI/);
  assert.match(result.stdout, /"connected": false/);
  assert.equal(`${result.stdout}${result.stderr}`.includes("prod-cluster"), false);
});

// ---------------------------------------------------------------------------
// 11. Launcher allowlisting
// ---------------------------------------------------------------------------

test("verify:transactions is registered in the closed allowlist", () => {
  assert.equal(typeof S5_COMMANDS["verify:transactions"], "object");
  assert.equal(S5_COMMANDS["verify:transactions"].executable, process.execPath);
  assert.deepEqual(S5_COMMANDS["verify:transactions"].args, [
    "scripts/verifyTransactionCapability.js"
  ]);
});

test("verify:transactions resolves through the launcher", () => {
  const resolution = resolveCommand(["verify:transactions"]);

  assert.equal(resolution.ok, true);
  assert.equal(resolution.name, "verify:transactions");
});

test("verify:transactions carries no opt-in flag", () => {
  assert.equal(S5_COMMANDS["verify:transactions"].extraEnv, undefined);
});

test("verify:transactions appears in the launcher help text", () => {
  assert.match(describeCommands(), /verify:transactions\s+Gated transaction-capability/);
});
