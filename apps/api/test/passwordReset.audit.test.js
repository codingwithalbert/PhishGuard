const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createPasswordResetController,
  GENERIC_FORGOT_PASSWORD_MESSAGE,
  RESET_PASSWORD_SUCCESS_MESSAGE
} = require("../src/controllers/passwordReset.controller");
const {
  PASSWORD_RESET_ERROR_CODES,
  PasswordResetServiceError
} = require("../src/services/passwordReset.service");

// Offline tests for persistent password-reset audit integration.
//
// The password-reset controller is built through `createPasswordResetController`
// with a fake service, a fake workflow, and a fake recorder, so nothing here
// connects to MongoDB or any external service, loads an environment file, or
// writes a real document. Every handled terminal outcome must produce exactly one
// durable event, and only the token-verified completion may carry an identity.

const EXISTING_EMAIL = "reset.audit.existing@example.invalid";
const MISSING_EMAIL = "reset.audit.missing@example.invalid";
const RESET_TOKEN = "c".repeat(64);
const RESET_TOKEN_HASH = "d".repeat(64);
const NEW_PASSWORD = "reset-Audit-1";
const RESET_USER_ID = new mongoose.Types.ObjectId();

const RESET_COMPLETED_FIELD_KEYS = [
  "action",
  "actor",
  "category",
  "outcome",
  "resourceId",
  "resourceType",
  "targetUser"
];
const IDENTITY_FREE_FIELD_KEYS = ["action", "category", "outcome"];

const FORBIDDEN_VALUES = [
  EXISTING_EMAIL,
  MISSING_EMAIL,
  RESET_TOKEN,
  RESET_TOKEN_HASH,
  NEW_PASSWORD,
  "$2b$"
];

const AUDIT_PERSISTENCE_DIAGNOSTIC =
  '[AUDIT_PERSISTENCE] {"event":"AUDIT_PERSISTENCE_FAILED",'
  + '"code":"AUDIT_PERSISTENCE_FAILED"}';

function createRecorder() {
  const events = [];

  async function record(event) {
    events.push(event);
    return { _id: "audit-record-1", ...event };
  }

  return { record, events };
}

// A recorder whose single write stays pending until the test settles it,
// modelling a stalled database write and a write that only settles after the
// wait limit.
function createDeferredRecorder() {
  const events = [];
  let settleResolve;
  let settleReject;

  const write = new Promise((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });

  async function record(event) {
    events.push(event);
    return write;
  }

  return {
    record,
    events,
    resolveWrite: (value) => settleResolve(value),
    rejectWrite: (error) => settleReject(error)
  };
}

function createFakeService({ result = { userId: RESET_USER_ID }, error = null } = {}) {
  const state = { calls: [] };

  return {
    state,
    async completePasswordReset(input) {
      state.calls.push(input);

      if (error) {
        throw error;
      }

      return result;
    }
  };
}

function createFakeReq(body, originalUrl) {
  return { method: "POST", originalUrl, body };
}

function createFakeRes() {
  const state = { statusCode: null, body: null, headers: {} };

  return {
    state,
    set(name, value) {
      state.headers[name] = value;
      return this;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return this;
    }
  };
}

async function runCapturingConsole(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const log = [];
  const error = [];

  console.log = (...args) => log.push(args.join(" "));
  console.error = (...args) => error.push(args.join(" "));

  try {
    const result = await run();
    return { result, log, error };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function auditEntries(log) {
  return log
    .filter((line) => line.startsWith("[AUDIT]"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

function assertNoForbiddenData(event, label = "audit event") {
  const serialized = JSON.stringify(event);

  for (const forbidden of FORBIDDEN_VALUES) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${label} must not contain ${forbidden.slice(0, 12)}...`
    );
  }
}

async function runForgotPassword({
  recorder,
  workflow,
  body = { email: EXISTING_EMAIL },
  auditRecordTimeoutMs
}) {
  const controller = createPasswordResetController({
    service: createFakeService(),
    forgotPasswordWorkflow: workflow,
    recordAuditEvent: recorder.record,
    ...(auditRecordTimeoutMs === undefined ? {} : { auditRecordTimeoutMs })
  });
  const res = createFakeRes();
  const errors = [];
  const next = (error) => errors.push(error);

  const captured = await runCapturingConsole(() =>
    controller.forgotPassword(
      createFakeReq(body, "/api/auth/forgot-password"),
      res,
      next
    )
  );

  return { res, errors, ...captured };
}

async function runResetPassword({
  recorder,
  service = createFakeService(),
  body = { token: RESET_TOKEN, password: NEW_PASSWORD },
  auditRecordTimeoutMs
}) {
  const controller = createPasswordResetController({
    service,
    forgotPasswordWorkflow: null,
    recordAuditEvent: recorder.record,
    ...(auditRecordTimeoutMs === undefined ? {} : { auditRecordTimeoutMs })
  });
  const res = createFakeRes();
  const errors = [];
  const next = (error) => errors.push(error);

  const captured = await runCapturingConsole(() =>
    controller.resetPassword(
      createFakeReq(body, "/api/auth/reset-password"),
      res,
      next
    )
  );

  return { res, errors, ...captured };
}

test("accepted forgot-password records one identity-free success event", async () => {
  const recorder = createRecorder();

  const { res, errors, log, error } = await runForgotPassword({
    recorder,
    // The workflow return value is deliberately non-empty: it must be ignored.
    workflow: async () => ({ resetToken: RESET_TOKEN, resetTokenHash: RESET_TOKEN_HASH })
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(res.state.body, {
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });
  assert.equal(res.state.headers["Cache-Control"], "no-store");

  // The console trail is preserved.
  const consoleEvents = auditEntries(log);
  assert.equal(consoleEvents.length, 1);
  assert.equal(consoleEvents[0].event, "PASSWORD_RESET_REQUESTED");

  assert.deepEqual(recorder.events, [
    {
      category: "password_reset",
      action: "PASSWORD_RESET_REQUESTED",
      outcome: "success"
    }
  ]);
  assert.deepEqual(
    Object.keys(recorder.events[0]).sort(),
    IDENTITY_FREE_FIELD_KEYS
  );
  assertNoForbiddenData(recorder.events[0]);
  assert.deepEqual(error, []);
});

test("forgot-password delivery failure records one identity-free failure event and keeps the generic response", async () => {
  const recorder = createRecorder();

  const { res, errors, log, error } = await runForgotPassword({
    recorder,
    workflow: async () => {
      throw new Error(`delivery failed for ${EXISTING_EMAIL}`);
    }
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(res.state.body, {
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });

  const consoleEvents = auditEntries(log);
  assert.equal(consoleEvents.length, 1);
  assert.equal(consoleEvents[0].event, "PASSWORD_RESET_EMAIL_FAILED");

  assert.deepEqual(recorder.events, [
    {
      category: "password_reset",
      action: "PASSWORD_RESET_EMAIL_FAILED",
      outcome: "failure"
    }
  ]);
  assert.deepEqual(
    Object.keys(recorder.events[0]).sort(),
    IDENTITY_FREE_FIELD_KEYS
  );
  assertNoForbiddenData(recorder.events[0]);
  assert.deepEqual(error, []);
});

test("the forgot-password event is identical for existing and missing accounts", async () => {
  const existingRecorder = createRecorder();
  const missingRecorder = createRecorder();

  const existing = await runForgotPassword({
    recorder: existingRecorder,
    body: { email: EXISTING_EMAIL },
    workflow: async ({ email }) =>
      email === EXISTING_EMAIL
        ? { resetToken: RESET_TOKEN, resetTokenHash: RESET_TOKEN_HASH }
        : null
  });

  const missing = await runForgotPassword({
    recorder: missingRecorder,
    body: { email: MISSING_EMAIL },
    workflow: async ({ email }) => (email === EXISTING_EMAIL ? {} : null)
  });

  // Identical public response and identical persistent event: the audit store
  // cannot be used to distinguish an existing account from a missing one.
  assert.deepEqual(existing.res.state.body, missing.res.state.body);
  assert.deepEqual(existingRecorder.events, missingRecorder.events);
  assert.equal(existingRecorder.events.length, 1);
});

test("a successful password reset records one event referencing the verified user id", async () => {
  const recorder = createRecorder();

  const { res, errors, log, error } = await runResetPassword({ recorder });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(res.state.body, {
    success: true,
    message: RESET_PASSWORD_SUCCESS_MESSAGE
  });
  assert.equal(res.state.headers["Cache-Control"], "no-store");

  const consoleEvents = auditEntries(log);
  assert.equal(consoleEvents.length, 1);
  assert.equal(consoleEvents[0].event, "PASSWORD_RESET_COMPLETED");

  const id = RESET_USER_ID.toString();

  assert.deepEqual(recorder.events, [
    {
      category: "password_reset",
      action: "PASSWORD_RESET_COMPLETED",
      outcome: "success",
      actor: id,
      targetUser: id,
      resourceType: "user",
      resourceId: id
    }
  ]);
  assert.deepEqual(
    Object.keys(recorder.events[0]).sort(),
    RESET_COMPLETED_FIELD_KEYS
  );
  assert.equal("actorRole" in recorder.events[0], false);
  assertNoForbiddenData(recorder.events[0]);
  assert.deepEqual(error, []);
});

test("an invalid, expired, or reused reset token records one identity-free failure event and keeps the 400", async () => {
  const recorder = createRecorder();
  const service = createFakeService({
    error: new PasswordResetServiceError(
      PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
      "The password reset link is invalid or has expired",
      400
    )
  });

  const { res, errors, log, error } = await runResetPassword({ recorder, service });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 400);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "The password reset link is invalid or has expired"
  });

  const consoleEvents = auditEntries(log);
  assert.equal(consoleEvents.length, 1);
  assert.equal(consoleEvents[0].event, "PASSWORD_RESET_FAILED");
  assert.equal(consoleEvents[0].reason, PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN);

  assert.deepEqual(recorder.events, [
    {
      category: "password_reset",
      action: "PASSWORD_RESET_FAILED",
      outcome: "failure"
    }
  ]);
  assert.deepEqual(
    Object.keys(recorder.events[0]).sort(),
    IDENTITY_FREE_FIELD_KEYS
  );
  assertNoForbiddenData(recorder.events[0]);
  assert.deepEqual(error, []);
});

test("an unexpected reset failure is not audited and is forwarded to next", async () => {
  const failure = new Error("password update failed");
  const recorder = createRecorder();
  const service = createFakeService({ error: failure });

  const { res, errors, error } = await runResetPassword({ recorder, service });

  assert.equal(res.state.statusCode, null);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(recorder.events, [], "no event on an unexpected failure");
  assert.deepEqual(error, []);
});

test("forgot-password is not audited when the workflow is unavailable", async () => {
  const recorder = createRecorder();

  const { res, errors, error } = await runForgotPassword({
    recorder,
    workflow: null
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 503);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "Password reset is temporarily unavailable"
  });
  assert.deepEqual(recorder.events, []);
  assert.deepEqual(error, []);
});

test("a stalled audit write is bounded for the accepted forgot-password response", async () => {
  const recorder = createDeferredRecorder();

  const startedAt = Date.now();
  const { res, errors, error } = await runForgotPassword({
    recorder,
    workflow: async () => null,
    auditRecordTimeoutMs: 20
  });
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(res.state.body, {
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });

  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
  assert.ok(elapsed < 1500, "bounded by the wait limit, not the default limit");
});

test("a stalled audit write is bounded for the successful reset response", async () => {
  const recorder = createDeferredRecorder();

  const startedAt = Date.now();
  const { res, errors, error } = await runResetPassword({
    recorder,
    auditRecordTimeoutMs: 20
  });
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(res.state.body, {
    success: true,
    message: RESET_PASSWORD_SUCCESS_MESSAGE
  });

  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
  assert.ok(elapsed < 1500, "bounded by the wait limit, not the default limit");
});

test("a reset write that rejects after the wait limit adds no second diagnostic and no unhandled rejection", async () => {
  const recorder = createDeferredRecorder();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const { res, error } = await runResetPassword({
      recorder,
      auditRecordTimeoutMs: 20
    });

    assert.equal(res.state.statusCode, 200);
    assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

    recorder.rejectWrite(new Error("late audit failure"));
    await flushMicrotasks();

    assert.deepEqual(
      error,
      [AUDIT_PERSISTENCE_DIAGNOSTIC],
      "a late rejection must not emit a second diagnostic"
    );
    assert.deepEqual(unhandled, [], "a late rejection must not go unhandled");
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("the password-reset controller is exported as an injectable factory", () => {
  const controller = createPasswordResetController();

  assert.equal(typeof controller.forgotPassword, "function");
  assert.equal(typeof controller.resetPassword, "function");
});
