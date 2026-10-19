const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const {
  createLoginController,
  AUDIT_RECORD_TIMEOUT_MS
} = require("../src/controllers/auth.controller");

// Offline tests for persistent login audit integration.
//
// The login handler is built through `createLoginController` with a fake user
// model and a fake recorder, so nothing here connects to MongoDB or any external
// service, loads an environment file, or writes a real document. The JWT secret
// is generated in-process for the duration of the file.
//
// The real `auditLog` console helper and the real `bcrypt` comparison are
// exercised; only the database-facing dependencies are faked.

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const USER_ID = new mongoose.Types.ObjectId();
const EMAIL = "login.audit@example.invalid";
const PASSWORD = "correct-Horse-1";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

after(() => {
  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function activeUser(overrides = {}) {
  return {
    _id: USER_ID,
    name: "Login User",
    email: EMAIL,
    role: "user",
    isActive: true,
    tokenVersion: 0,
    password: PASSWORD_HASH,
    ...overrides
  };
}

// Chainable thenable, mirroring the shape the controller awaits:
//   User.findOne(...).select("+password")
function createFakeUserModel(user) {
  const state = { filters: [], projections: [] };

  return {
    state,
    findOne(filter) {
      state.filters.push(filter);

      const query = {
        select(projection) {
          state.projections.push(projection);
          return query;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(user).then(onFulfilled, onRejected);
        }
      };

      return query;
    }
  };
}

function createRecorder({ error = null, delay = false } = {}) {
  const events = [];

  async function record(event) {
    if (delay) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    events.push(event);

    if (error) {
      throw error;
    }

    return { _id: "audit-record-1", ...event };
  }

  return { record, events };
}

// A recorder whose single write stays pending until the test settles it. This
// models a database write that neither resolves nor rejects while it is being
// awaited (a stalled socket or a buffered command), and, through resolveWrite /
// rejectWrite, a write that only settles after the login wait limit. Nothing here
// touches a database.
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

// Lets queued microtasks and the deferred write's attached handlers run.
async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createFakeReq(body, originalUrl = "/api/auth/login") {
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

// Captures console.log and console.error for the duration of `run`, returning the
// captured lines so audit output can be asserted instead of trusted.
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

function parseAuditEntries(lines) {
  return lines
    .filter((line) => line.startsWith("[AUDIT]"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

const AUDIT_PERSISTENCE_DIAGNOSTIC =
  '[AUDIT_PERSISTENCE] {"event":"AUDIT_PERSISTENCE_FAILED",'
  + '"code":"AUDIT_PERSISTENCE_FAILED"}';

async function runLogin({ user, recorder, body = {}, url, auditRecordTimeoutMs }) {
  const controller = createLoginController({
    userModel: createFakeUserModel(user),
    recordAuditEvent: recorder.record,
    ...(auditRecordTimeoutMs === undefined ? {} : { auditRecordTimeoutMs })
  });
  const res = createFakeRes();
  const errors = [];
  const next = (error) => errors.push(error);

  const captured = await runCapturingConsole(() =>
    controller.login(
      createFakeReq({ email: EMAIL, password: PASSWORD, ...body }, url),
      res,
      next
    )
  );

  return { res, errors, ...captured };
}

test("a successful login records one persistent success event", async () => {
  const recorder = createRecorder();

  const { res, errors, log, error } = await runLogin({
    user: activeUser(),
    recorder
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(res.state.body.message, "Login successful");
  assert.equal(typeof res.state.body.token, "string");
  assert.equal(res.state.body.user.role, "user");

  const decoded = jwt.verify(res.state.body.token, testJwtSecret);
  assert.equal(decoded.userId, USER_ID.toString());
  assert.equal(decoded.role, "user");

  assert.deepEqual(recorder.events, [
    {
      category: "authentication",
      action: "LOGIN_SUCCESS",
      outcome: "success",
      actor: USER_ID.toString(),
      actorRole: "user"
    }
  ]);

  assert.deepEqual(error, []);

  const entries = parseAuditEntries(log);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "LOGIN_SUCCESS");
  assert.equal(entries[0].userId, USER_ID.toString());
  assert.equal(entries[0].role, "user");
  assert.equal(entries[0].method, "POST");
});

test("failed logins record one identity-free failure event per request", async () => {
  const cases = [
    { label: "unknown account", user: null, body: {} },
    { label: "inactive account", user: activeUser({ isActive: false }), body: {} },
    {
      label: "invalid token version",
      user: activeUser({ tokenVersion: -1 }),
      body: {}
    },
    { label: "wrong password", user: activeUser(), body: { password: "nope" } },
    {
      // Two failure conditions at once: the funnel must still emit exactly one
      // event, not one per rejected check.
      label: "inactive account with wrong password",
      user: activeUser({ isActive: false }),
      body: { password: "nope" }
    }
  ];

  for (const { label, user, body } of cases) {
    const recorder = createRecorder();

    const { res, errors, log, error } = await runLogin({ user, recorder, body });

    assert.deepEqual(errors, [], `${label}: next must not be called`);
    assert.equal(res.state.statusCode, 401, `${label}: status`);
    assert.deepEqual(
      res.state.body,
      { success: false, error: "Invalid email or password" },
      `${label}: body must be unchanged`
    );

    assert.deepEqual(
      recorder.events,
      [
        {
          category: "authentication",
          action: "LOGIN_FAILED",
          outcome: "failure"
        }
      ],
      `${label}: exactly one persistent failure event`
    );

    assert.deepEqual(error, [], `${label}: no persistence diagnostics`);

    const entries = parseAuditEntries(log);
    assert.equal(entries.length, 1, `${label}: one console event`);
    assert.equal(entries[0].event, "LOGIN_FAILED");
    assert.equal(entries[0].reason, "invalid_credentials");
    assert.equal(entries[0].userId, null);
  }
});

test("no credentials or submitted email reach the audit service", async () => {
  for (const label of ["success", "failure"]) {
    const recorder = createRecorder();
    const user = label === "success" ? activeUser() : null;

    await runLogin({ user, recorder });

    assert.equal(recorder.events.length, 1);

    const serialized = JSON.stringify(recorder.events[0]);

    for (const forbidden of [EMAIL, PASSWORD, PASSWORD_HASH, "$2b$"]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `${label}: audit event must not contain ${forbidden}`
      );
    }
  }
});

test("a failure event exposes no actor, target, or identity fields", async () => {
  const recorder = createRecorder();

  await runLogin({ user: null, recorder });

  assert.deepEqual(Object.keys(recorder.events[0]).sort(), [
    "action",
    "category",
    "outcome"
  ]);
});

test("persistence completes before the login handler resolves", async () => {
  const recorder = createRecorder({ delay: true });

  await runLogin({ user: activeUser(), recorder });

  assert.equal(recorder.events.length, 1, "the event must be written on return");
});

test("the login audit wait limit is fixed at 1500 ms", () => {
  assert.equal(AUDIT_RECORD_TIMEOUT_MS, 1500);
});

test("a stalled audit write is bounded and does not hold the success response open", async () => {
  const recorder = createDeferredRecorder();

  const startedAt = Date.now();
  const { res, errors, log, error } = await runLogin({
    user: activeUser(),
    recorder,
    auditRecordTimeoutMs: 20
  });
  const elapsed = Date.now() - startedAt;

  // The login succeeds even though the write never settles.
  assert.deepEqual(errors, [], "next must not be called");
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(typeof res.state.body.token, "string");

  // The write was attempted (not skipped by a wiring mistake) and is still
  // pending: the wait limit bounds the request, it does not cancel the write.
  assert.equal(recorder.events.length, 1);

  // Exactly one fixed diagnostic, and the console audit trail is intact.
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
  assert.equal(parseAuditEntries(log).length, 1);

  // The response returned on the bounded wait, not the full default limit.
  assert.ok(
    elapsed < AUDIT_RECORD_TIMEOUT_MS,
    "must be bounded by the wait limit, not the default timeout"
  );
});

test("a stalled audit write does not change the failed-login response", async () => {
  const recorder = createDeferredRecorder();

  const { res, errors, log, error } = await runLogin({
    user: null,
    recorder,
    auditRecordTimeoutMs: 20
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 401);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "Invalid email or password"
  });

  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);
  assert.equal(parseAuditEntries(log).length, 1);
});

test("a write that rejects after the wait limit adds no second diagnostic and no unhandled rejection", async () => {
  const recorder = createDeferredRecorder();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const { res, error } = await runLogin({
      user: activeUser(),
      recorder,
      auditRecordTimeoutMs: 20
    });

    assert.equal(res.state.statusCode, 200);
    assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

    // The write fails only after the request has already been answered.
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
  const recorder = createDeferredRecorder();

  const { res, error } = await runLogin({
    user: activeUser(),
    recorder,
    auditRecordTimeoutMs: 20
  });

  assert.equal(res.state.statusCode, 200);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

  // The write completes only after the request has already been answered.
  recorder.resolveWrite({ _id: "late-audit-record" });
  await flushMicrotasks();

  assert.deepEqual(
    error,
    [AUDIT_PERSISTENCE_DIAGNOSTIC],
    "a late success must not emit a second diagnostic"
  );
});

test("an audit write that settles within the wait limit emits no diagnostic", async () => {
  const recorder = createRecorder({ delay: true });

  const { res, error, log } = await runLogin({
    user: activeUser(),
    recorder,
    auditRecordTimeoutMs: 1500
  });

  assert.equal(res.state.statusCode, 200);
  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, []);
  assert.equal(parseAuditEntries(log).length, 1);
});

test("a persistence failure does not change the success response", async () => {
  const secret =
    "mongodb+srv://audit:hunter2@cluster.example/auditLogs connection refused";
  const recorder = createRecorder({ error: new Error(secret) });

  const { res, errors, log, error } = await runLogin({
    user: activeUser(),
    recorder
  });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(typeof res.state.body.token, "string");

  // The recorder was actually invoked (not skipped by a wiring mistake) and the
  // failure was handled best-effort.
  assert.equal(recorder.events.length, 1);

  // Only the fixed diagnostic is emitted, and no sensitive value appears in it.
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

  for (const line of [...log, ...error]) {
    assert.equal(line.includes(secret), false, "no driver text may leak");
    assert.equal(line.includes("hunter2"), false, "no credential may leak");
  }

  // The console audit trail is still emitted for the successful login.
  assert.equal(parseAuditEntries(log).length, 1);
});

test("a persistence failure does not change the failure response", async () => {
  const secret = "not-a-real-connection-string";
  const recorder = createRecorder({ error: new Error(secret) });

  const { res, errors, log, error } = await runLogin({ user: null, recorder });

  assert.deepEqual(errors, []);
  assert.equal(res.state.statusCode, 401);
  assert.deepEqual(res.state.body, {
    success: false,
    error: "Invalid email or password"
  });

  assert.equal(recorder.events.length, 1);
  assert.deepEqual(error, [AUDIT_PERSISTENCE_DIAGNOSTIC]);

  for (const line of [...log, ...error]) {
    assert.equal(line.includes(secret), false);
  }

  assert.equal(parseAuditEntries(log).length, 1);
});

test("the console audit path strips query strings", async () => {
  const recorder = createRecorder();

  const { log } = await runLogin({
    user: activeUser(),
    recorder,
    url: `/api/auth/login?email=${encodeURIComponent(EMAIL)}&password=${PASSWORD}`
  });

  const [entry] = parseAuditEntries(log);

  assert.equal(entry.path, "/api/auth/login");
  assert.equal(JSON.stringify(entry).includes(EMAIL), false);
  assert.equal(JSON.stringify(entry).includes(PASSWORD), false);
});

test("the module still exports register, login, and getMe", () => {
  const authController = require("../src/controllers/auth.controller");

  assert.equal(typeof authController.register, "function");
  assert.equal(typeof authController.login, "function");
  assert.equal(typeof authController.getMe, "function");
});
