const { test } = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/User");
const {
  createRegistrationController
} = require("../src/controllers/auth.controller");

// Offline tests for persistent registration audit integration.
//
// The registration handler is built through `createRegistrationController` with a
// fake user model and a fake recorder, so nothing here connects to MongoDB or any
// external service, loads an environment file, or writes a real document. The
// real `bcrypt` hashing and the real `User` schema defaults are exercised; only
// the database-facing dependencies are faked.

const EMAIL = "register.audit@example.invalid";
const PASSWORD = "correct-Horse-1";

function activeUser(overrides = {}) {
  return new User({
    name: "Register User",
    email: EMAIL,
    password: "stored-hash-marker",
    ...overrides
  });
}

// Mimics the shape the controller awaits: `User.findOne({ email })` resolving to
// an existing account or null. `create` records the payload it was handed and
// returns a real `User` document (which applies the default role) without saving.
function createFakeUserModel({ existingUser = null } = {}) {
  const state = { findFilters: [], createdPayloads: [], created: [] };

  return {
    state,
    findOne(filter) {
      state.findFilters.push(filter);
      return Promise.resolve(existingUser);
    },
    async create(payload) {
      state.createdPayloads.push(payload);
      const document = new User(payload);
      state.created.push(document);
      return document;
    }
  };
}

function createRecorder({ error = null } = {}) {
  const events = [];

  async function record(event) {
    events.push(event);

    if (error) {
      throw error;
    }

    return { _id: "audit-record-1", ...event };
  }

  return { record, events };
}

// A recorder whose single write stays pending until the test settles it, modelling
// a stalled database write and a write that only settles after the wait limit.
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

function createFakeReq(body, originalUrl = "/api/auth/register") {
  return { method: "POST", originalUrl, body };
}

function createFakeRes() {
  const state = { statusCode: null, body: null };

  return {
    state,
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

const AUDIT_PERSISTENCE_DIAGNOSTIC =
  '[AUDIT_PERSISTENCE] {"event":"AUDIT_PERSISTENCE_FAILED",'
  + '"code":"AUDIT_PERSISTENCE_FAILED"}';

async function runRegister({
  userModel,
  recorder,
  body = {},
  auditRecordTimeoutMs
}) {
  const controller = createRegistrationController({
    userModel,
    recordAuditEvent: recorder.record,
    ...(auditRecordTimeoutMs === undefined ? {} : { auditRecordTimeoutMs })
  });
  const res = createFakeRes();
  const errors = [];
  const next = (error) => errors.push(error);

  const captured = await runCapturingConsole(() =>
    controller.register(
      createFakeReq({ name: "Register User", email: EMAIL, password: PASSWORD, ...body }),
      res,
      next
    )
  );

  return { res, errors, ...captured };
}

test("a successful registration records one success event referencing the new account", async () => {
  const userModel = createFakeUserModel();
  const recorder = createRecorder();

  const { res, errors, log, error } = await runRegister({ userModel, recorder });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 201);
  assert.equal(res.state.body.success, true);
  assert.equal(res.state.body.message, "Registration successful");

  const [stored] = userModel.state.created;
  const id = stored._id.toString();

  assert.equal(res.state.body.user.role, "user");
  assert.equal(res.state.body.user.id, stored._id);

  // Only name/email/password are forwarded; the role is never client-supplied.
  assert.deepEqual(Object.keys(userModel.state.createdPayloads[0]).sort(), [
    "email",
    "name",
    "password"
  ]);

  // Exactly one persistent success event, with the full allowlisted field set.
  assert.deepEqual(recorder.events, [
    {
      category: "account",
      action: "REGISTRATION_SUCCESS",
      outcome: "success",
      actor: id,
      actorRole: "user",
      resourceType: "user",
      resourceId: id
    }
  ]);

  // Registration does not emit a console audit event, and no diagnostic appears.
  assert.equal(log.filter((line) => line.startsWith("[AUDIT]")).length, 0);
  assert.deepEqual(error, []);
});

test("no credentials or submitted email reach the audit service", async () => {
  const recorders = {
    success: createRecorder(),
    duplicate: createRecorder()
  };

  await runRegister({
    userModel: createFakeUserModel(),
    recorder: recorders.success
  });
  await runRegister({
    userModel: createFakeUserModel({ existingUser: activeUser() }),
    recorder: recorders.duplicate
  });

  const serialized = JSON.stringify([
    recorders.success.events[0],
    recorders.duplicate.events[0]
  ]);

  for (const forbidden of [EMAIL, PASSWORD, "$2b$"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear`);
  }
});

test("a client-supplied role is ignored and the default user role is stored", async () => {
  const userModel = createFakeUserModel();
  const recorder = createRecorder();

  const { res, errors } = await runRegister({
    userModel,
    recorder,
    body: { role: "admin", isAdmin: true, isActive: false, permissions: ["admin"] }
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 201);

  const [stored] = userModel.state.created;

  // The forged fields never reach User.create, and the model default applies.
  assert.deepEqual(Object.keys(userModel.state.createdPayloads[0]).sort(), [
    "email",
    "name",
    "password"
  ]);
  assert.equal(stored.role, "user");
  assert.equal(res.state.body.user.role, "user");

  // The audit actor role is the persisted role, not the submitted one.
  assert.equal(recorder.events[0].actorRole, "user");
});

test("a duplicate email records one identity-free failure event and keeps the 409", async () => {
  const userModel = createFakeUserModel({ existingUser: activeUser() });
  const recorder = createRecorder();

  const { res, errors, log, error } = await runRegister({ userModel, recorder });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 409);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "An account with this email already exists"
  });

  // No account is created on the rejection branch.
  assert.equal(userModel.state.created.length, 0);

  // Exactly one event, with no actor, identity, or resource reference.
  assert.deepEqual(recorder.events, [
    {
      category: "account",
      action: "REGISTRATION_FAILED",
      outcome: "failure"
    }
  ]);
  assert.deepEqual(Object.keys(recorder.events[0]).sort(), [
    "action",
    "category",
    "outcome"
  ]);

  assert.equal(log.filter((line) => line.startsWith("[AUDIT]")).length, 0);
  assert.deepEqual(error, []);
});

test("an unexpected database failure is not audited and is forwarded to next", async () => {
  const failure = new Error("registration persistence failed");
  const recorder = createRecorder();
  const userModel = {
    state: {},
    findOne: () => Promise.resolve(null),
    create: () => Promise.reject(failure)
  };

  const { res, errors, error } = await runRegister({ userModel, recorder });

  // No response was written; the sanitized error handling takes over.
  assert.equal(res.state.statusCode, null);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(recorder.events, [], "no event on an unexpected failure");
  assert.deepEqual(error, []);
});

test("a stalled audit write is bounded and does not hold the success response open", async () => {
  const userModel = createFakeUserModel();
  const recorder = createDeferredRecorder();

  const startedAt = Date.now();
  const { res, errors, error } = await runRegister({
    userModel,
    recorder,
    auditRecordTimeoutMs: 20
  });
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 201);
  assert.equal(res.state.body.success, true);

  // The write was attempted and is still pending: bounded, not cancelled.
  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
  assert.ok(elapsed < 1500, "bounded by the wait limit, not the default limit");
});

test("a stalled audit write does not change the duplicate-email response", async () => {
  const userModel = createFakeUserModel({ existingUser: activeUser() });
  const recorder = createDeferredRecorder();

  const { res, errors, error } = await runRegister({
    userModel,
    recorder,
    auditRecordTimeoutMs: 20
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 409);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "An account with this email already exists"
  });

  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
});

test("a write that rejects after the wait limit adds no second diagnostic and no unhandled rejection", async () => {
  const userModel = createFakeUserModel();
  const recorder = createDeferredRecorder();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const { res, error } = await runRegister({
      userModel,
      recorder,
      auditRecordTimeoutMs: 20
    });

    assert.equal(res.state.statusCode, 201);
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

test("a write that succeeds after the wait limit adds no second diagnostic", async () => {
  const userModel = createFakeUserModel();
  const recorder = createDeferredRecorder();

  const { res, error } = await runRegister({
    userModel,
    recorder,
    auditRecordTimeoutMs: 20
  });

  assert.equal(res.state.statusCode, 201);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

  recorder.resolveWrite({ _id: "late-registration-record" });
  await flushMicrotasks();

  assert.deepEqual(
    error,
    [AUDIT_PERSISTENCE_DIAGNOSTIC],
    "a late success must not emit a second diagnostic"
  );
});

test("a write that settles within the wait limit emits no diagnostic", async () => {
  const userModel = createFakeUserModel();
  const recorder = createRecorder();

  const { res, error } = await runRegister({
    userModel,
    recorder,
    auditRecordTimeoutMs: 1500
  });

  assert.equal(res.state.statusCode, 201);
  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, []);
});

test("the module exports the register factory and the shared wait limit", () => {
  const authController = require("../src/controllers/auth.controller");

  assert.equal(typeof authController.createRegistrationController, "function");
  assert.equal(typeof authController.register, "function");
  assert.equal(authController.AUDIT_RECORD_TIMEOUT_MS, 1500);
});
