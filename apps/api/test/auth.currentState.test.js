const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { format } = require("node:util");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");
const {
  authenticate,
  createAuthenticate
} = require("../src/middleware/auth.middleware");
const { authorizeRoles } = require("../src/middleware/role.middleware");
const errorHandler = require("../src/middleware/error.middleware");

// Server-authoritative current-user authentication.
//
// The real production `authenticate` middleware and the real role middleware
// are exercised. Only the User model is faked, so no MongoDB, no dotenv, no
// .env value, and no external service is involved.
//
// Each test builds its own fake user model and its own middleware instance via
// `createAuthenticate`, so no limiter state, request state, or lookup counter
// is shared between tests.
const testJwtSecret = crypto.randomBytes(32).toString("hex");
const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = testJwtSecret;

const INVALID_TOKEN_MESSAGE = "Invalid or expired token";
const MISSING_TOKEN_MESSAGE = "Authentication required";

// Records every query the middleware attempts so a test can prove that no
// database lookup happened when the request was rejected earlier.
function createFakeUserModel(usersById) {
  const state = { lookups: [], projections: [] };

  state.model = {
    findById(id) {
      state.lookups.push(String(id));

      const found =
        typeof id === "string" ? usersById[String(id)] ?? null : null;

      return {
        select(projection) {
          state.projections.push(projection);
          return {
            then(onFulfilled, onRejected) {
              return Promise.resolve(found).then(onFulfilled, onRejected);
            }
          };
        }
      };
    }
  };

  return state;
}

function createHarness({ usersById = {}, allowedRoles } = {}) {
  const fake = createFakeUserModel(usersById);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  let protectedHandlerCalls = 0;
  let lastRequestUser = null;

  const protectedHandler = (req, res) => {
    protectedHandlerCalls += 1;
    lastRequestUser = req.user ?? null;

    return res.status(200).json({
      success: true,
      observedUser: req.user
    });
  };

  // Only the injectable middleware is mounted. The production singleton is
  // never exercised against a live request here, because it reads the real
  // User model and would wait on a MongoDB connection that must not exist.
  const fakeMiddleware = createAuthenticate({ userModel: fake.model });

  app.get("/protected", fakeMiddleware, protectedHandler);

  app.get(
    "/privileged",
    fakeMiddleware,
    authorizeRoles(...(allowedRoles ?? ["admin", "staff"])),
    protectedHandler
  );

  app.use(errorHandler);

  return {
    app,
    fake,
    get protectedHandlerCalls() {
      return protectedHandlerCalls;
    },
    get lastRequestUser() {
      return lastRequestUser;
    }
  };
}

let server;
let baseUrl;

// Serves a harness on its own ephemeral loopback port for the duration of one
// request, so every test gets an isolated app with no shared state.
async function serve(harness, path = "/protected", options = {}) {
  const local = http.createServer(harness.app);

  await new Promise((resolve) => {
    local.listen(0, "127.0.0.1", resolve);
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${local.address().port}${path}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? {})
        }
      }
    );

    return {
      status: response.status,
      body: await response.json()
    };
  } finally {
    await new Promise((resolve) => {
      local.close(resolve);
    });
  }
}

test.before(async () => {
  server = http.createServer(express());
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function signToken(claims = {}, options = {}) {
  return jwt.sign(claims, testJwtSecret, options);
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
}

test("the production export stays a single middleware and the factory is available", () => {
  assert.equal(typeof authenticate, "function");
  assert.equal(typeof createAuthenticate, "function");

  // The production export is a plain 3-argument Express handler, so every
  // existing `authenticate` route import keeps working unchanged.
  assert.equal(authenticate.length, 3);
  assert.equal(authenticate.name, "authenticate");

  const created = createAuthenticate();

  assert.equal(typeof created, "function");
  assert.equal(created.name, "authenticate");
  assert.notEqual(created, authenticate);
});

test("1. a valid token for an active user succeeds and req.user uses database state", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "user",
        isActive: true
      }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "user" });
  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 200);
  assert.deepEqual(body.observedUser, {
    userId: userId.toString(),
    role: "user"
  });
  assert.equal(harness.protectedHandlerCalls, 1);
});

test("1b. the database role overrides a differing token role claim for an active user", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "staff",
        isActive: true
      }
    }
  });

  // The token still claims the original, lower role.
  const token = signToken({ userId: userId.toString(), role: "user" });
  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 200);
  assert.equal(body.observedUser.role, "staff");
});

test("2. a valid token for a nonexistent user is rejected and the handler never runs", async () => {
  const harness = createHarness({ usersById: {} });
  const token = signToken({
    userId: new mongoose.Types.ObjectId().toString(),
    role: "user"
  });

  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 403);
  assert.deepEqual(body, { success: false, error: INVALID_TOKEN_MESSAGE });
  assert.equal(harness.protectedHandlerCalls, 0);
  assert.equal(harness.fake.lookups.length, 1);
});

test("3. an inactive user is rejected and the handler never runs", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: { _id: userId, role: "user", isActive: false }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "admin" });
  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 403);
  assert.deepEqual(body, { success: false, error: INVALID_TOKEN_MESSAGE });
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("3b. a missing isActive field is treated as not active", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: { _id: userId, role: "user" }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "user" });
  const { status } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 403);
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("4. role promotion in the database grants access on the next protected request", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "admin",
        isActive: true
      }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "user" });
  const { status, body } = await serve(harness, "/privileged", {
    headers: authHeaders(token)
  });

  assert.equal(status, 200);
  assert.equal(body.observedUser.role, "admin");
  assert.equal(harness.protectedHandlerCalls, 1);
});

test("5. role demotion in the database denies privileged access immediately", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "user",
        isActive: true
      }
    }
  });

  // Still-signed, still-unexpired, and still claiming admin.
  const token = signToken({ userId: userId.toString(), role: "admin" });
  const { status, body } = await serve(harness, "/privileged", {
    headers: authHeaders(token)
  });

  assert.equal(status, 403);
  assert.deepEqual(body, {
    success: false,
    error: "You do not have permission to access this resource"
  });
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("6. a forged token is rejected without any User lookup", async () => {
  const harness = createHarness({ usersById: {} });
  const forged = jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role: "admin" },
    crypto.randomBytes(32).toString("hex"),
    { expiresIn: "1h" }
  );

  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(forged)
  });

  assert.equal(status, 403);
  assert.deepEqual(body, { success: false, error: INVALID_TOKEN_MESSAGE });
  assert.equal(harness.fake.lookups.length, 0);
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("7. an expired token is rejected without any User lookup", async () => {
  const harness = createHarness({ usersById: {} });
  const expired = signToken(
    {
      userId: new mongoose.Types.ObjectId().toString(),
      role: "user",
      exp: 1
    },
    { noTimestamp: true }
  );

  assert.throws(() => jwt.verify(expired, testJwtSecret), {
    name: "TokenExpiredError"
  });

  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(expired)
  });

  assert.equal(status, 403);
  assert.deepEqual(body, { success: false, error: INVALID_TOKEN_MESSAGE });
  assert.equal(harness.fake.lookups.length, 0);
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("8. a missing Authorization header is 401 with no User lookup", async () => {
  const harness = createHarness({ usersById: {} });
  const { status, body } = await serve(harness, "/protected");

  assert.equal(status, 401);
  assert.deepEqual(body, { success: false, error: MISSING_TOKEN_MESSAGE });
  assert.equal(harness.fake.lookups.length, 0);
  assert.equal(harness.protectedHandlerCalls, 0);
});

test("8b. a non-Bearer Authorization header is 401 with no User lookup", async () => {
  const harness = createHarness({ usersById: {} });
  const { status, body } = await serve(harness, "/protected", {
    headers: { Authorization: "Basic dXNlcjpwYXNz" }
  });

  assert.equal(status, 401);
  assert.deepEqual(body, { success: false, error: MISSING_TOKEN_MESSAGE });
  assert.equal(harness.fake.lookups.length, 0);
});

test("9. a structurally invalid decoded userId is rejected before any database query", async () => {
  for (const badId of ["not-an-object-id", "12345", "abcdefghijkl", 42, null]) {
    const harness = createHarness({ usersById: {} });
    const token = signToken({ userId: badId, role: "admin" });

    const { status, body } = await serve(harness, "/protected", {
      headers: authHeaders(token)
    });

    assert.equal(status, 403, `expected 403 for userId ${String(badId)}`);
    assert.deepEqual(body, { success: false, error: INVALID_TOKEN_MESSAGE });
    assert.equal(
      harness.fake.lookups.length,
      0,
      `no query may be attempted for userId ${String(badId)}`
    );
    assert.equal(harness.protectedHandlerCalls, 0);
  }
});

test("9b. a token with no userId claim at all is rejected before any database query", async () => {
  const harness = createHarness({ usersById: {} });
  const token = signToken({ role: "admin" });
  const { status } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 403);
  assert.equal(harness.fake.lookups.length, 0);
});

test("10. the role middleware receives the refreshed database role", async () => {
  const userId = new mongoose.Types.ObjectId();
  const seenRoles = [];

  const fakeModel = createFakeUserModel({
    [userId.toString()]: { _id: userId, role: "staff", isActive: true }
  });

  const recording = authorizeRoles("admin", "staff");
  const app = express();
  const middleware = createAuthenticate({ userModel: fakeModel.model });

  app.get("/x", middleware, (req, res, next) => {
    seenRoles.push(req.user.role);
    return recording(req, res, next);
  });
  app.get("/x", (req, res) => res.status(200).json({ success: true }));

  const local = http.createServer(app);
  await new Promise((resolve) => {
    local.listen(0, "127.0.0.1", resolve);
  });

  try {
    const token = signToken({ userId: userId.toString(), role: "user" });
    const response = await fetch(
      `http://127.0.0.1:${local.address().port}/x`,
      { headers: authHeaders(token) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(seenRoles, ["staff"]);
  } finally {
    await new Promise((resolve) => {
      local.close(resolve);
    });
  }
});

test("11. no protected handler runs after any authentication rejection", async () => {
  const inactiveId = new mongoose.Types.ObjectId();
  const missingId = new mongoose.Types.ObjectId();

  const cases = [
    {
      label: "missing header",
      headers: {},
      expected: 401,
      usersById: {}
    },
    {
      label: "forged token",
      headers: authHeaders(
        jwt.sign(
          { userId: missingId.toString() },
          crypto.randomBytes(32).toString("hex")
        )
      ),
      expected: 403,
      usersById: {}
    },
    {
      label: "nonexistent user",
      headers: authHeaders(signToken({ userId: missingId.toString() })),
      expected: 403,
      usersById: {}
    },
    {
      label: "inactive user",
      headers: authHeaders(
        signToken({ userId: inactiveId.toString(), role: "admin" })
      ),
      expected: 403,
      usersById: {
        [inactiveId.toString()]: {
          _id: inactiveId,
          role: "user",
          isActive: false
        }
      }
    }
  ];

  for (const testCase of cases) {
    const harness = createHarness({ usersById: testCase.usersById });
    const { status } = await serve(harness, "/privileged", {
      headers: testCase.headers
    });

    assert.equal(status, testCase.expected, testCase.label);
    assert.equal(
      harness.protectedHandlerCalls,
      0,
      `handler must not run for ${testCase.label}`
    );
  }
});

test("12. the User lookup projection is limited to _id, role and isActive", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "user",
        isActive: true,
        // These must never be requested by the projection.
        password: "should-never-be-selected",
        passwordResetTokenHash: "should-never-be-selected",
        passwordResetExpiresAt: new Date()
      }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "user" });
  const { status, body } = await serve(harness, "/protected", {
    headers: authHeaders(token)
  });

  assert.equal(status, 200);
  assert.deepEqual(harness.fake.projections, [
    { _id: 1, role: 1, isActive: 1 }
  ]);
  assert.deepEqual(Object.keys(body.observedUser).sort(), ["role", "userId"]);
  assert.equal(JSON.stringify(body).includes("should-never-be-selected"), false);
});

test("an unexpected database failure is reported as a safe 403 without leaking detail", async () => {
  const app = express();
  const exploding = {
    findById() {
      return {
        select() {
          // A real rejected promise, so `await` settles and the middleware's
          // own try/catch runs.
          return Promise.reject(
            new Error("MongoNetworkError: connection to 10.0.0.5:27017 failed")
          );
        }
      };
    }
  };

  app.get(
    "/x",
    createAuthenticate({ userModel: exploding }),
    (req, res) => res.status(200).json({ success: true })
  );
  app.use(errorHandler);

  const local = http.createServer(app);
  await new Promise((resolve) => {
    local.listen(0, "127.0.0.1", resolve);
  });

  try {
    const token = signToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: "user"
    });
    const response = await fetch(
      `http://127.0.0.1:${local.address().port}/x`,
      { headers: authHeaders(token) }
    );
    const text = await response.text();

    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(text), {
      success: false,
      error: INVALID_TOKEN_MESSAGE
    });
    assert.equal(text.includes("MongoNetworkError"), false);
    assert.equal(text.includes("10.0.0.5"), false);
  } finally {
    await new Promise((resolve) => {
      local.close(resolve);
    });
  }
});

// Builds a User model whose findById rejects with a deliberately
// sensitive-looking error, so the negative logging assertions are meaningful.
function createExplodingUserModel(thrownError) {
  return {
    findById() {
      return {
        select() {
          // A real rejected promise, so `await` settles and the middleware's
          // own try/catch runs.
          return Promise.reject(thrownError);
        }
      };
    }
  };
}

const SENSITIVE_ERROR_MARKER = "mongodb+srv://user:pa55w0rd@db.internal.invalid/phishguard";

function createSensitiveLookupError() {
  const error = new TypeError(
    `MongoNetworkError: connection to ${SENSITIVE_ERROR_MARKER} timed out`
  );

  // An attacker-influenced name must not reach the diagnostic verbatim.
  error.name = "AttackerControlledErrorName";
  error.code = 6;
  error.hostName = "db.internal.invalid";
  error.databaseName = "phishguard";
  error.filter = { user: "507f1f77bcf86cd799439011" };
  error.credentials = { password: "pa55w0rd" };

  return error;
}

async function runLookupFailureRequest(t, thrownError) {
  const captured = [];
  t.mock.method(console, "error", (...args) => {
    captured.push(args);
  });

  const app = express();
  let handlerCalls = 0;

  app.get(
    "/x",
    createAuthenticate({ userModel: createExplodingUserModel(thrownError) }),
    (req, res) => {
      handlerCalls += 1;
      return res.status(200).json({ success: true });
    }
  );
  app.use(errorHandler);

  const local = http.createServer(app);
  await new Promise((resolve) => {
    local.listen(0, "127.0.0.1", resolve);
  });

  try {
    const userId = new mongoose.Types.ObjectId();
    const token = signToken({ userId: userId.toString(), role: "user" });
    const response = await fetch(
      `http://127.0.0.1:${local.address().port}/x`,
      { headers: authHeaders(token) }
    );

    return {
      status: response.status,
      text: await response.text(),
      captured,
      handlerCalls,
      userId: userId.toString(),
      token
    };
  } finally {
    await new Promise((resolve) => {
      local.close(resolve);
    });
  }
}

function parseAuthDiagnostics(captured) {
  return captured
    .filter((args) => format(...args).startsWith("[AUTH] "))
    .map((args) => JSON.parse(format(...args).slice("[AUTH] ".length)));
}

test("a current-user lookup failure keeps the generic 403 and logs one sanitized diagnostic", async (t) => {
  const thrownError = createSensitiveLookupError();
  const result = await runLookupFailureRequest(t, thrownError);

  // 1. The client contract is unchanged: same status, same generic body.
  assert.equal(result.status, 403);
  assert.deepEqual(JSON.parse(result.text), {
    success: false,
    error: INVALID_TOKEN_MESSAGE
  });

  // 2. The protected handler never runs.
  assert.equal(result.handlerCalls, 0);

  // 3. Exactly one diagnostic is emitted.
  assert.equal(result.captured.length, 1);

  const diagnostics = parseAuthDiagnostics(result.captured);

  assert.equal(diagnostics.length, 1);
  const diagnostic = diagnostics[0];

  // 4. It identifies the condition with fixed metadata only.
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "category",
    "errorType",
    "event",
    "status",
    "timestamp"
  ]);
  assert.equal(diagnostic.event, "AUTH_CURRENT_USER_LOOKUP_FAILED");
  assert.equal(diagnostic.category, "current_user_lookup_failure");
  assert.equal(diagnostic.status, 403);
  assert.equal(Number.isNaN(Date.parse(diagnostic.timestamp)), false);

  // The error type is normalized through `instanceof`, never the raw name.
  assert.equal(diagnostic.errorType, "TypeError");

  // 5. Nothing sensitive reached the response or the log.
  const logged = result.captured.map((args) => format(...args)).join("\n");

  for (const forbidden of [
    SENSITIVE_ERROR_MARKER,
    "MongoNetworkError",
    "MongoNetwork",
    "10.0.0.5",
    "db.internal.invalid",
    "phishguard",
    "pa55w0rd",
    "AttackerControlledErrorName",
    result.userId,
    result.token,
    "Bearer",
    "Authorization"
  ]) {
    assert.equal(logged.includes(forbidden), false, forbidden);
    assert.equal(result.text.includes(forbidden), false, forbidden);
  }

  // No stack, and no arbitrary error property was serialized.
  assert.equal(logged.includes(" at "), false);
  assert.equal(/\bcode\b/.test(logged), false);
  assert.equal(/\bfilter\b/.test(logged), false);
  assert.equal(/\bcredentials\b/.test(logged), false);
  assert.equal(/\bhostName\b/.test(logged), false);
});

test("a non-Error thrown value still yields a normalized Unknown diagnostic", async (t) => {
  const result = await runLookupFailureRequest(t, { secret: "synthetic-payload" });
  const diagnostics = parseAuthDiagnostics(result.captured);

  assert.equal(result.status, 403);
  assert.equal(result.handlerCalls, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].errorType, "Unknown");
  assert.equal(
    format(...result.captured[0]).includes("synthetic-payload"),
    false
  );
});

test("an invalid or expired JWT does not emit the lookup-failure diagnostic", async (t) => {
  const captured = [];
  t.mock.method(console, "error", (...args) => {
    captured.push(args);
  });

  const harness = createHarness({ usersById: {} });
  const expiredToken = signToken(
    {
      userId: new mongoose.Types.ObjectId().toString(),
      role: "user",
      exp: 1
    },
    { noTimestamp: true }
  );

  const expired = await serve(harness, "/protected", {
    headers: authHeaders(expiredToken)
  });

  assert.equal(expired.status, 403);
  assert.deepEqual(expired.body, {
    success: false,
    error: INVALID_TOKEN_MESSAGE
  });
  assert.equal(harness.fake.lookups.length, 0);
  assert.equal(harness.protectedHandlerCalls, 0);

  const forged = await serve(harness, "/protected", {
    headers: authHeaders(
      jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString(), role: "admin" },
        crypto.randomBytes(32).toString("hex")
      )
    )
  });

  assert.equal(forged.status, 403);

  const missing = await serve(harness, "/protected");

  assert.equal(missing.status, 401);

  // Credential rejections are silent by design; only a lookup failure is logged.
  assert.equal(captured.length, 0);
  assert.deepEqual(parseAuthDiagnostics(captured), []);
});

test("no User caching is introduced: two requests each perform their own lookup", async () => {
  const userId = new mongoose.Types.ObjectId();
  const harness = createHarness({
    usersById: {
      [userId.toString()]: {
        _id: userId,
        role: "user",
        isActive: true
      }
    }
  });

  const token = signToken({ userId: userId.toString(), role: "user" });

  await serve(harness, "/protected", { headers: authHeaders(token) });
  await serve(harness, "/protected", { headers: authHeaders(token) });

  assert.equal(harness.fake.lookups.length, 2);
});

test("the User schema still keeps credential and reset-state fields unselected", () => {
  const paths = User.schema.paths;

  assert.equal(paths.password.options.select, false);
  assert.equal(paths.passwordResetTokenHash.options.select, false);
  assert.equal(paths.passwordResetExpiresAt.options.select, false);
  assert.equal(paths.isActive.options.default, true);
  assert.deepEqual(paths.role.options.enum, ["admin", "staff", "user"]);
});

test("the unused bootstrap server bound a loopback port for the suite", async () => {
  // Guards that test.before ran and freed its port.
  assert.ok(baseUrl.startsWith("http://127.0.0.1:"));
  await get("/definitely-not-mounted");
});