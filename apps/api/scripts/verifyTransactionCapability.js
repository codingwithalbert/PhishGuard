#!/usr/bin/env node
"use strict";

/**
 * Gated, disposable-only MongoDB transaction-capability verifier (A2).
 *
 * WHAT THIS PROVES
 *
 * That the verified disposable target supports the exact transaction behavior
 * the approved User Role Management V1 specification depends on (Section 9.3):
 *
 *   1. a session can be created;
 *   2. a transaction can be started with read concern `snapshot` and write
 *      concern `{ w: "majority" }` - the options the specification requires;
 *   3. a document written inside the transaction is visible to a read that uses
 *      the same session;
 *   4. aborting the transaction removes that write;
 *   5. the probe collection does not survive the abort (it was never
 *      pre-created);
 *   6. the client is closed.
 *
 * The specification records the same expectations in Sections 11.2 and 15.4.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not create the probe collection ahead of time. It writes exactly one
 * synthetic document, only inside the transaction, and then aborts so the write
 * is rolled back. It never touches application collections (`users`,
 * `auditLogs`, `systemLocks`), never promotes or demotes a user, never
 * initializes the role-change guard, and never implements any part of role
 * management. It leaves no durable records behind: the success report is only
 * emitted once the non-session read has confirmed both the probe document and
 * the probe collection are gone.
 *
 * THE SAFETY WRAPPER IS REUSED, NOT REINVENTED
 *
 * The gate (`testDatabaseIsolation.js`), the child-URI equality check, the
 * bounded connection options, the fixed error categorisation, and the quiet
 * close helper all come from the existing S5 machinery. The target URI is read
 * from `PHISHGUARD_TEST_MONGODB_URI` and from nowhere else; `MONGODB_URI` must
 * equal it because the launcher assigns it. `dotenv` is never loaded here, so
 * `apps/api/.env` can never supply the target.
 *
 * OUTPUT DISCIPLINE
 *
 * Only fixed field names, fixed booleans, and fixed reason codes are emitted.
 * The probe collection name and the probe marker are never printed. Driver
 * errors are reduced to a fixed category word by the existing `classifyError`,
 * and `message`, `stack`, `client`, and any URL-bearing property are never read.
 * No URI, host, username, replica-set name, or raw MongoDB error can reach the
 * output.
 *
 * This module imports nothing that connects at load time. `mongoose` is
 * required lazily inside the CLI block, so requiring this file cannot open a
 * connection.
 */

const { evaluateTestDatabaseEnvironment } = require("./testDatabaseIsolation");
const {
  classifyError,
  closeQuietly,
  resolveProbeTarget
} = require("./probeTestDatabase");

/**
 * Every knob is bounded. The driver's documented default server-selection
 * timeout is 30 seconds, which makes a blocked network look like a hang.
 */
const VERIFY_TIMEOUT_MS = 10000;

/**
 * The exact transaction options required by the approved specification
 * (Section 9.3). The application connection sets no write concern, so majority
 * must be requested explicitly here to reflect what the feature will do.
 */
const TRANSACTION_OPTIONS = Object.freeze({
  readConcern: Object.freeze({ level: "snapshot" }),
  writeConcern: Object.freeze({ w: "majority" })
});

// The probe collection is always `<prefix><16 lowercase hex characters>`. The
// prefix makes the collection unmistakably synthetic; the random suffix makes a
// collision with a real collection impossible in practice.
const PROBE_COLLECTION_PREFIX = "a2_probe_";
const PROBE_COLLECTION_PATTERN = /^a2_probe_[0-9a-f]{16}$/;
const PROBE_MARKER_BYTES = 8;

// Defense in depth. A generated probe name can never be one of these because of
// its prefix, but the validator refuses them explicitly so a future edit cannot
// point the probe at application data.
const FORBIDDEN_COLLECTION_NAMES = Object.freeze(
  ["users", "auditLogs", "systemLocks"].map((name) => name.toLowerCase())
);

/**
 * Fixed reason codes. Every failure path resolves to exactly one of these, so a
 * report can be logged or asserted on without ever carrying a credential, a
 * hostname, a collection name, or a driver message.
 */
const VERIFY_FAILURE_REASONS = Object.freeze({
  connectFailed: "A2_CONNECT_FAILED",
  sessionStartFailed: "A2_SESSION_START_FAILED",
  transactionStartFailed: "A2_TRANSACTION_START_FAILED",
  probeCollectionCreationRejected:
    "A2_COLLECTION_CREATION_REJECTED_IN_TRANSACTION",
  insertFailed: "A2_INSERT_FAILED",
  inSessionReadFailed: "A2_IN_SESSION_READ_FAILED",
  inSessionReadMissing: "A2_IN_SESSION_READ_MISSING",
  abortFailed: "A2_ABORT_FAILED",
  sessionEndFailed: "A2_SESSION_END_FAILED",
  rollbackCheckFailed: "A2_ROLLBACK_CHECK_FAILED",
  rollbackMarkerPresent: "A2_ROLLBACK_MARKER_PRESENT",
  rollbackCollectionPresent: "A2_ROLLBACK_COLLECTION_PRESENT",
  disconnectFailed: "A2_DISCONNECT_FAILED"
});

// The fixed reason a failed step maps to, keyed by the step that threw.
const STAGE_REASONS = Object.freeze({
  connect: VERIFY_FAILURE_REASONS.connectFailed,
  session: VERIFY_FAILURE_REASONS.sessionStartFailed,
  "transaction-start": VERIFY_FAILURE_REASONS.transactionStartFailed,
  insert: VERIFY_FAILURE_REASONS.insertFailed,
  "in-session-read": VERIFY_FAILURE_REASONS.inSessionReadFailed,
  abort: VERIFY_FAILURE_REASONS.abortFailed,
  "session-end": VERIFY_FAILURE_REASONS.sessionEndFailed,
  "rollback-check": VERIFY_FAILURE_REASONS.rollbackCheckFailed
});

// MongoDB server error code returned when a multi-document transaction is asked
// to create a collection implicitly. Only the numeric code is read; the server
// message is never emitted.
const NAMESPACE_CREATION_IN_TRANSACTION_CODE = 263;

/**
 * An internal control-flow failure carrying a fixed reason code.
 *
 * This object is never printed. Only `reason`, `stage`, and `category` - all
 * fixed - are copied into the report.
 */
class VerificationFailure extends Error {
  constructor(reason, { stage, category = null } = {}) {
    super(reason);

    this.name = "VerificationFailure";
    this.reason = reason;
    this.stage = stage;
    this.category = category;
  }
}

/**
 * Validates a candidate probe collection name.
 *
 * Returns false for anything that is not an `a2_probe_` synthetic name, and for
 * the explicitly forbidden application collections.
 */
function isSafeProbeCollectionName(name) {
  if (typeof name !== "string") {
    return false;
  }

  if (FORBIDDEN_COLLECTION_NAMES.includes(name.toLowerCase())) {
    return false;
  }

  return PROBE_COLLECTION_PATTERN.test(name);
}

/**
 * Builds the throwaway probe collection name from random hex.
 *
 * Throws (with an internal, never-printed message) if the source is not exactly
 * 16 lowercase hex characters, or if the result is not a safe probe name.
 */
function buildProbeCollectionName(randomHex) {
  if (typeof randomHex !== "string" || !/^[0-9a-f]{16}$/.test(randomHex)) {
    throw new Error("invalid probe collection random source");
  }

  const name = `${PROBE_COLLECTION_PREFIX}${randomHex}`;

  if (!isSafeProbeCollectionName(name)) {
    throw new Error("unsafe probe collection name");
  }

  return name;
}

function defaultRandomHex() {
  return require("node:crypto").randomBytes(PROBE_MARKER_BYTES).toString("hex");
}

/**
 * Reduces a thrown value to a fixed reason/stage/category. Nothing from the
 * thrown value except a numeric error code and a whitelisted error name is ever
 * read.
 */
function toFailure(error, stage) {
  if (error instanceof VerificationFailure) {
    return {
      stage: error.stage || stage,
      reason: error.reason,
      category: error.category || null
    };
  }

  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "number" &&
    error.code === NAMESPACE_CREATION_IN_TRANSACTION_CODE
  ) {
    return {
      stage: "insert",
      reason: VERIFY_FAILURE_REASONS.probeCollectionCreationRejected,
      category: null
    };
  }

  return {
    stage,
    reason: STAGE_REASONS[stage] || VERIFY_FAILURE_REASONS.rollbackCheckFailed,
    category: classifyError(error).category
  };
}

/**
 * The verification.
 *
 * Every collaborator is injected - environment, driver, streams, and the random
 * source - so every path (including "the probe write did not roll back") can be
 * exercised offline without a socket, a database, or a process. Defaults are
 * the production collaborators.
 *
 * Returns an exit code. It never throws.
 */
async function runTransactionVerification({
  env = process.env,
  driver,
  stdout = process.stdout,
  stderr = process.stderr,
  randomHex = defaultRandomHex
} = {}) {
  const report = (payload) => {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  };

  const base = {
    verifier: "transaction-capability",
    credentialsPrinted: false,
    connectionStringPrinted: false,
    realHostnamePrinted: false
  };

  // 1. The launcher already ran the gate, and this child re-verifies it. This
  //    function holds a connection string, so it must not trust its caller.
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });

  if (!gate.ok) {
    report({
      ok: false,
      ...base,
      stage: "isolation-gate",
      reason: gate.reason,
      connected: false
    });
    stderr.write(
      "The isolation gate refused the transaction verifier. No connection was "
        + "attempted.\n"
    );

    return 1;
  }

  // 2. Both anti-fallback rules: the URI comes from PHISHGUARD_TEST_MONGODB_URI
  //    and the child MONGODB_URI must equal it.
  const target = resolveProbeTarget(env);

  if (!target.ok) {
    report({
      ok: false,
      ...base,
      stage: "target-resolution",
      reason: target.reason,
      connected: false
    });
    stderr.write(`Refused: ${target.reason}. No connection was attempted.\n`);

    return 1;
  }

  if (!driver) {
    report({
      ok: false,
      ...base,
      stage: "driver",
      reason: "DRIVER_UNAVAILABLE",
      connected: false
    });
    stderr.write("No database driver was supplied. No connection was attempted.\n");

    return 1;
  }

  // 3. Defensive and process-wide. The options below repeat both, so a model
  //    imported later still cannot build anything.
  driver.set("autoIndex", false);
  driver.set("autoCreate", false);

  const state = {
    connected: false,
    connectAttempted: false,
    sessionCreated: false,
    transactionStarted: false,
    aborted: false,
    sessionEnded: false,
    closed: false,
    collectionName: null,
    marker: null
  };

  let failure = null;
  let stage = "connect";
  let session = null;
  let collection = null;

  try {
    stage = "connect";
    state.connectAttempted = true;
    await driver.connect(target.testUri, {
      serverSelectionTimeoutMS: VERIFY_TIMEOUT_MS,
      connectTimeoutMS: VERIFY_TIMEOUT_MS,
      socketTimeoutMS: VERIFY_TIMEOUT_MS,
      maxPoolSize: 1,
      minPoolSize: 0,
      autoIndex: false,
      autoCreate: false
    });
    state.connected = true;

    // Built after a successful connect, so an unverified target never even
    // derives a probe name. Validated again by the builder.
    if (typeof randomHex !== "function") {
      throw new VerificationFailure(VERIFY_FAILURE_REASONS.insertFailed, {
        stage: "insert"
      });
    }

    const hex = String(randomHex());
    state.collectionName = buildProbeCollectionName(hex);
    state.marker = `a2_marker_${hex}`;

    const db = driver.connection.db;

    stage = "session";
    session = await driver.startSession();
    state.sessionCreated = true;

    stage = "transaction-start";
    session.startTransaction(TRANSACTION_OPTIONS);
    state.transactionStarted = true;

    // The collection is never created ahead of time. This insert is the sole
    // write, it is inside the transaction, and it is aborted below.
    stage = "insert";
    collection = db.collection(state.collectionName);
    await collection.insertOne(
      {
        marker: state.marker,
        purpose: "a2-transaction-capability-probe",
        createdAt: new Date()
      },
      { session }
    );

    stage = "in-session-read";
    const visible = await collection.findOne({ marker: state.marker }, { session });

    if (!visible) {
      throw new VerificationFailure(VERIFY_FAILURE_REASONS.inSessionReadMissing, {
        stage
      });
    }

    stage = "abort";
    await session.abortTransaction();
    state.aborted = true;

    stage = "session-end";
    await session.endSession();
    state.sessionEnded = true;

    // Only reached once the abort succeeded: confirm the write is gone.
    stage = "rollback-check";
    const leftoverMarker = await collection.findOne({ marker: state.marker });

    if (leftoverMarker) {
      throw new VerificationFailure(VERIFY_FAILURE_REASONS.rollbackMarkerPresent, {
        stage
      });
    }

    const leftoverCollections = await db
      .listCollections({ name: state.collectionName }, { nameOnly: true })
      .toArray();

    if (Array.isArray(leftoverCollections) && leftoverCollections.length > 0) {
      throw new VerificationFailure(
        VERIFY_FAILURE_REASONS.rollbackCollectionPresent,
        { stage }
      );
    }
  } catch (error) {
    failure = toFailure(error, stage);
  } finally {
    // Abort whenever a transaction was started and is not already closed. This
    // runs on every failure path after the transaction began.
    if (session && state.transactionStarted && !state.aborted) {
      try {
        await session.abortTransaction();
        state.aborted = true;
      } catch (error) {
        if (!failure) {
          failure = toFailure(error, "abort");
        }
      }
    }

    // Always end the session, including on failure.
    if (session && !state.sessionEnded) {
      try {
        await session.endSession();
        state.sessionEnded = true;
      } catch (error) {
        if (!failure) {
          failure = toFailure(error, "session-end");
        }
      }
    }

    // Close the client on every path a connection was attempted.
    if (state.connectAttempted) {
      const closed = await closeQuietly(driver, { force: true });

      state.closed = closed;

      if (!closed && !failure) {
        failure = {
          stage: "disconnect",
          reason: VERIFY_FAILURE_REASONS.disconnectFailed,
          category: null
        };
      }
    }
  }

  const ok = failure === null && state.closed === true;

  if (!ok) {
    const resolved = failure || {
      stage: "disconnect",
      reason: VERIFY_FAILURE_REASONS.disconnectFailed,
      category: null
    };

    report({
      ok: false,
      ...base,
      stage: resolved.stage,
      reason: resolved.reason,
      ...(resolved.category ? { category: resolved.category } : {}),
      connected: state.connected,
      sessionCreated: state.sessionCreated,
      transactionStarted: state.transactionStarted,
      aborted: state.aborted,
      sessionEnded: state.sessionEnded,
      connectionClosed: state.closed === true
    });
    stderr.write(
      "The transaction-capability verification did not pass. Driver detail is "
        + "suppressed so no credential can be logged.\n"
    );

    return 1;
  }

  report({
    ok: true,
    ...base,
    stage: "complete",
    connected: true,
    sessionCreated: true,
    transactionStarted: true,
    transactionOptions: {
      readConcern: TRANSACTION_OPTIONS.readConcern.level,
      writeConcern: TRANSACTION_OPTIONS.writeConcern.w
    },
    inSessionReadVisible: true,
    aborted: true,
    rollbackMarkerAbsent: true,
    rollbackCollectionAbsent: true,
    sessionEnded: true,
    connectionClosed: true,
    durableProbeRecordsLeft: 0,
    probeIdentifiersPrinted: false
  });

  return 0;
}

module.exports = {
  FORBIDDEN_COLLECTION_NAMES,
  NAMESPACE_CREATION_IN_TRANSACTION_CODE,
  PROBE_COLLECTION_PREFIX,
  TRANSACTION_OPTIONS,
  VERIFY_FAILURE_REASONS,
  VERIFY_TIMEOUT_MS,
  buildProbeCollectionName,
  isSafeProbeCollectionName,
  runTransactionVerification
};

if (require.main === module) {
  // Required here, not at module load, so requiring this file cannot connect.
  runTransactionVerification({ driver: require("mongoose") })
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Sanitized by construction: no error value is printed.
      process.stderr.write(
        "The transaction-capability verifier failed unexpectedly. Details are "
          + "suppressed so no credential can be logged.\n"
      );
      process.exitCode = 1;
    });
}
