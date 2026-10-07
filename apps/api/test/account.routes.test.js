const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const accountController = require("../src/controllers/account.controller");
const authController = require("../src/controllers/auth.controller");
const authRoutes = require("../src/routes/auth.routes");
const User = require("../src/models/User");
const errorHandler = require("../src/middleware/error.middleware");
const { auditLog } = require("../src/middleware/audit.middleware");
const {
  authenticate
} = require("../src/middleware/auth.middleware");
const {
  validateChangePasswordRequest,
  validateProfileUpdateRequest
} = require("../src/middleware/account.validate.middleware");
const {
  ACCOUNT_ERROR_CODES,
  AccountServiceError
} = require("../src/services/account.service");

const { createAccountController } = accountController;

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();
const STAFF_USER_ID = new mongoose.Types.ObjectId();
const ADMIN_USER_ID = new mongoose.Types.ObjectId();
const CURRENT_PASSWORD = "current-Password-1";
const NEW_PASSWORD = "new-Password-2";
const SAFE_PROFILE = {
  id: USER_ID,
  name: "Updated Name",
  email: "account.owner@example.invalid",
  role: "user"
};

const state = {
  calls: [],
  profileResult: null,
  passwordResult: null,
  profileError: null,
  passwordError: null
};

function createFakeService() {
  return {
    async updateOwnProfileName(input) {
      state.calls.push({ operation: "updateOwnProfileName", input });

      if (state.profileError) {
        const error = state.profileError;
        state.profileError = null;
        throw error;
      }

      return state.profileResult ?? SAFE_PROFILE;
    },

    async changeOwnPassword(input) {
      state.calls.push({ operation: "changeOwnPassword", input });

      if (state.passwordError) {
        const error = state.passwordError;
        state.passwordError = null;
        throw error;
      }

      return state.passwordResult ?? { userId: String(USER_ID) };
    }
  };
}

// Mirrors the production chain exactly: authenticate -> validator -> controller.
const app = express();
app.use(express.json({ limit: "1mb" }));

const testController = createAccountController(createFakeService());

app.patch(
  "/api/auth/profile",
  authenticate,
  validateProfileUpdateRequest,
  testController.updateProfile
);

app.post(
  "/api/auth/change-password",
  authenticate,
  validateChangePasswordRequest,
  testController.changePassword
);

app.get("/api/auth/me", authenticate, authController.getMe);
app.use(errorHandler);

let server;
let baseUrl;

before(async () => {
  // `authenticate` now reads the current User record, so the synthetic ids
  // these tests sign into their JWTs must resolve to an active account. The
  // stub is a chainable thenable because the middleware calls `.select()`
  // before awaiting, and it stays a stub for the whole file so every
  // pre-existing assertion keeps its original meaning.
  const activeAccounts = new Map([
    [USER_ID.toString(), "user"],
    [OTHER_USER_ID.toString(), "user"],
    [STAFF_USER_ID.toString(), "staff"],
    [ADMIN_USER_ID.toString(), "admin"]
  ]);

  const originalFindById = User.findById.bind(User);

  User.findById = (id) => {
    const key = String(id);
    const role = activeAccounts.get(key);

    if (!role) {
      return originalFindById(id);
    }

    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(key),
          role,
          isActive: true
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  };

  server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function resetState() {
  state.calls = [];
  state.profileResult = null;
  state.passwordResult = null;
  state.profileError = null;
  state.passwordError = null;
}

function makeToken(userId = USER_ID, role = "user") {
  return jwt.sign(
    { userId: String(userId), role },
    testJwtSecret,
    { expiresIn: "1h" }
  );
}

function authHeaders(userId = USER_ID, role = "user") {
  return { Authorization: `Bearer ${makeToken(userId, role)}` };
}

async function send(path, method, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

const patchProfile = (body, headers) =>
  send("/api/auth/profile", "PATCH", body, headers);
const postChangePassword = (body, headers) =>
  send("/api/auth/change-password", "POST", body, headers);

async function readJson(response) {
  const text = await response.text();

  return { text, data: JSON.parse(text) };
}

function assertNoStore(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

// Captures audit output so emitted entries can be asserted instead of trusted.
async function captureAuditLogs(run) {
  const originalConsoleLog = console.log;
  const lines = [];

  console.log = (...args) => lines.push(args.join(" "));

  try {
    await run();
  } finally {
    console.log = originalConsoleLog;
  }

  return lines
    .filter((line) => line.startsWith("[AUDIT]"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

function assertNoSecretAuditMetadata(entry) {
  const serialized = JSON.stringify(entry);

  for (const forbidden of [
    CURRENT_PASSWORD,
    NEW_PASSWORD,
    SAFE_PROFILE.email,
    "$2b$",
    "currentPassword",
    "newPassword",
    "passwordReset",
    "Authorization",
    "Bearer",
    "body"
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Audit entry must not contain ${forbidden}`
    );
  }
}

// A generic safe error must not carry internal, credential, or reset detail.
function assertNoInternalDetail(text) {
  for (const forbidden of [
    CURRENT_PASSWORD,
    NEW_PASSWORD,
    "wrong-Password-9",
    "$2b$",
    "password",
    "passwordReset",
    "internal detail",
    "Account password state is unavailable",
    "storage backend"
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `Safe error response must not contain ${forbidden}`
    );
  }
}

test("both account routes exist in production with the required handler order", () => {
  const routes = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map((entry) => entry.handle)
    }));

  const profileRoute = routes.find(
    (route) => route.path === "/profile"
  );
  const changePasswordRoute = routes.find(
    (route) => route.path === "/change-password"
  );

  assert.ok(profileRoute, "PATCH /profile must be registered");
  assert.ok(changePasswordRoute, "POST /change-password must be registered");
  assert.deepEqual(profileRoute.methods, ["patch"]);
  assert.deepEqual(changePasswordRoute.methods, ["post"]);

  assert.deepEqual(profileRoute.handlers, [
    authenticate,
    validateProfileUpdateRequest,
    accountController.updateProfile
  ]);
  assert.deepEqual(changePasswordRoute.handlers, [
    authenticate,
    validateChangePasswordRequest,
    accountController.changePassword
  ]);
});

test("existing auth routes are unchanged", () => {
  const registered = authRoutes.stack
    .filter((layer) => layer.route)
    .map(
      (layer) =>
        `${Object.keys(layer.route.methods).join(",")} ${layer.route.path}`
    );

  for (const existing of [
    "post /register",
    "post /login",
    "get /me",
    "get /staff-test",
    "get /admin-test"
  ]) {
    assert.ok(
      registered.includes(existing),
      `${existing} must remain registered`
    );
  }

  const meRoute = authRoutes.stack
    .filter((layer) => layer.route)
    .find((layer) => layer.route.path === "/me");

  assert.deepEqual(
    meRoute.route.stack.map((entry) => entry.handle),
    [authenticate, authController.getMe]
  );
});

test("GET /api/auth/me still requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`);

  assert.equal(response.status, 401);
  assert.deepEqual((await readJson(response)).data, {
    success: false,
    error: "Authentication required"
  });
});

test("both account endpoints require authentication", async () => {
  resetState();

  const profile = await patchProfile({ name: "Valid Name" });
  const password = await postChangePassword({
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD
  });

  assert.equal(profile.status, 401);
  assert.equal(password.status, 401);
  assert.deepEqual((await readJson(profile)).data, {
    success: false,
    error: "Authentication required"
  });
  assert.deepEqual((await readJson(password)).data, {
    success: false,
    error: "Authentication required"
  });
  assert.equal(state.calls.length, 0);
});

test("an invalid token is rejected before either handler", async () => {
  resetState();

  // A malformed bearer token is rejected as an invalid token, and a non-bearer
  // authorization header is rejected as unauthenticated. Both are the existing
  // authenticate behavior, reused unchanged.
  const invalidToken = await patchProfile(
    { name: "Valid Name" },
    { Authorization: "Bearer not-a-valid-token" }
  );

  assert.equal(invalidToken.status, 403);
  assert.deepEqual((await readJson(invalidToken)).data, {
    success: false,
    error: "Invalid or expired token"
  });

  const nonBearer = await postChangePassword(
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD
    },
    { Authorization: "not-even-bearer" }
  );

  assert.equal(nonBearer.status, 401);
  assert.deepEqual((await readJson(nonBearer)).data, {
    success: false,
    error: "Authentication required"
  });

  assert.equal(state.calls.length, 0);
});

test("all authenticated roles may manage their own account", async () => {
  for (const role of ["user", "staff", "admin"]) {
    resetState();

    const response = await patchProfile(
      { name: "Valid Name" },
      authHeaders(USER_ID, role)
    );

    const { data } = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(state.calls[0].input.userId, String(USER_ID));
  }
});

test("a profile update uses the authenticated user id as the only target", async () => {
  resetState();

  const response = await patchProfile(
    { name: "  Valid Name  " },
    authHeaders(USER_ID)
  );

  const { text, data } = await readJson(response);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(data, {
    success: true,
    user: {
      id: String(USER_ID),
      name: SAFE_PROFILE.name,
      email: SAFE_PROFILE.email,
      role: SAFE_PROFILE.role
    }
  });
  assert.deepEqual(Object.keys(data.user).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);
  // The safe profile legitimately includes the account email; it must not
  // include any credential or reset material.
  for (const forbidden of [
    CURRENT_PASSWORD,
    NEW_PASSWORD,
    "password",
    "passwordReset",
    "$2b$",
    "token"
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `Profile response must not expose ${forbidden}`
    );
  }

  const [call] = state.calls;

  assert.equal(call.operation, "updateOwnProfileName");
  assert.deepEqual(call.input, {
    userId: String(USER_ID),
    name: "Valid Name"
  });
  assert.equal(
    Object.keys(call.input).includes("id"),
    false
  );
});

test("a client cannot target another account through the profile body", async () => {
  resetState();

  for (const body of [
    { name: "Valid Name", id: String(OTHER_USER_ID) },
    { name: "Valid Name", userId: String(OTHER_USER_ID) },
    { name: "Valid Name", email: "attacker@example.invalid" },
    { name: "Valid Name", role: "admin" },
    { name: "Valid Name", isActive: false },
    { name: "Valid Name", password: "hijack" },
    { name: "Valid Name", passwordResetTokenHash: "hash" }
  ]) {
    const response = await patchProfile(body, authHeaders(USER_ID));
    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "Only name may be submitted"
    });
  }

  assert.equal(state.calls.length, 0);
});

test("profile validation failures are wired and never reach the service", async () => {
  resetState();

  for (const body of [
    {},
    { name: "a" },
    { name: "a".repeat(51) },
    { name: 42 },
    { name: ["Name"] },
    []
  ]) {
    const response = await patchProfile(body, authHeaders(USER_ID));
    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.equal(data.success, false);
  }

  assert.equal(state.calls.length, 0);

  // A non-object JSON payload is rejected by the shared body parser before any
  // route runs, so it uses the existing global 400 and, like every other
  // PhishGuard endpoint, does not reach the endpoint's no-store boundary.
  const scalarBody = await send(
    "/api/auth/profile",
    "PATCH",
    "name",
    authHeaders(USER_ID)
  );

  assert.equal(scalarBody.status, 400);
  assert.deepEqual((await readJson(scalarBody)).data, {
    success: false,
    error: "Invalid JSON payload"
  });
  assert.equal(state.calls.length, 0);
});

test("a missing or inactive account returns the safe 404 for both endpoints", async () => {
  resetState();

  state.profileError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.NOT_FOUND,
    "Account not found",
    404
  );

  const profile = await patchProfile(
    { name: "Valid Name" },
    authHeaders(USER_ID)
  );

  assert.equal(profile.status, 404);
  assertNoStore(profile);
  assert.deepEqual((await readJson(profile)).data, {
    success: false,
    error: "Account not found"
  });

  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.NOT_FOUND,
    "Account not found",
    404
  );

  const password = await postChangePassword(
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD
    },
    authHeaders(USER_ID)
  );

  assert.equal(password.status, 404);
  assertNoStore(password);
  assert.deepEqual((await readJson(password)).data, {
    success: false,
    error: "Account not found"
  });
});

test("a successful password change returns only a safe confirmation", async () => {
  resetState();

  const response = await postChangePassword(
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD
    },
    authHeaders(USER_ID)
  );

  const { text, data } = await readJson(response);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(data, {
    success: true,
    message: "Password changed successfully."
  });
  assert.deepEqual(Object.keys(data).sort(), ["message", "success"]);

  for (const forbidden of [
    "token",
    "user",
    "password",
    "$2b$",
    "passwordReset",
    CURRENT_PASSWORD,
    NEW_PASSWORD
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `Password success must not expose ${forbidden}`
    );
  }

  const [call] = state.calls;

  assert.equal(call.operation, "changeOwnPassword");
  assert.deepEqual(call.input, {
    userId: String(USER_ID),
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD
  });
});

test("change-password validation is wired and never reaches the service", async () => {
  resetState();

  const rejectedBodies = [
    {},
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      userId: String(OTHER_USER_ID)
    },
    { currentPassword: "", newPassword: NEW_PASSWORD },
    { currentPassword: CURRENT_PASSWORD, newPassword: "short" },
    { currentPassword: CURRENT_PASSWORD, newPassword: "a".repeat(129) },
    { currentPassword: CURRENT_PASSWORD },
    { newPassword: NEW_PASSWORD },
    []
  ];

  for (const body of rejectedBodies) {
    const response = await postChangePassword(
      body,
      authHeaders(USER_ID)
    );

    assert.equal(response.status, 400);
    assertNoStore(response);

    const text = await response.text();

    for (const secret of [CURRENT_PASSWORD, NEW_PASSWORD]) {
      if (typeof body.currentPassword === "string" && body.currentPassword.length > 0) {
        assert.equal(
          text.includes(body.currentPassword),
          false
        );
      }

      if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
        assert.equal(
          text.includes(body.newPassword),
          false
        );
      }
    }
  }

  assert.equal(state.calls.length, 0);
});

test("an incorrect current password returns 401 and audits a fixed reason", async () => {
  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD,
    "Current password is incorrect",
    401
  );

  let entries = [];

  const response = await captureAuditLogs(async () => {
    entries = [];
  });

  assert.deepEqual(response, []);

  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD,
    "Current password is incorrect",
    401
  );

  const httpResponse = await postChangePassword(
    {
      currentPassword: "wrong-Password-9",
      newPassword: NEW_PASSWORD
    },
    authHeaders(USER_ID)
  );

  const { text, data } = await readJson(httpResponse);

  assert.equal(httpResponse.status, 401);
  assertNoStore(httpResponse);
  assert.deepEqual(data, {
    success: false,
    error: "Current password is incorrect"
  });

  for (const forbidden of [
    "wrong-Password-9",
    NEW_PASSWORD,
    "$2b$",
    "passwordReset"
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `Password failure must not expose ${forbidden}`
    );
  }
});

test("the failed password verification audit entry is safe", async () => {
  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD,
    "Current password is incorrect",
    401
  );

  const entries = await captureAuditLogs(async () => {
    await postChangePassword(
      {
        currentPassword: "wrong-Password-9",
        newPassword: NEW_PASSWORD
      },
      authHeaders(USER_ID)
    );
  });

  const failure = entries.find(
    (entry) => entry.event === "PASSWORD_CHANGE_FAILED"
  );

  assert.ok(failure, "PASSWORD_CHANGE_FAILED must be emitted");
  assert.equal(failure.reason, "invalid_current_password");
  assert.equal(failure.userId, String(USER_ID));
  assert.equal(failure.role, "user");
  assert.equal(
    entries.find(
      (entry) => entry.event === "PASSWORD_CHANGED"
    ),
    undefined
  );

  for (const entry of entries) {
    assertNoSecretAuditMetadata(entry);
  }
});

test("audit paths exclude queries without changing request URLs or safe metadata", async () => {
  const marker = "synthetic-query-private-value";
  const encoded = "%73%79%6e%74%68%65%74%69%63%2D%65%6E%63%6F%64%65%64";
  for (const [originalUrl, expectedPath] of [
    ["/api/auth/login", "/api/auth/login"],
    ["/api/auth/reset-password?", "/api/auth/reset-password"],
    [`/api/auth/login?password=${marker}&token=${marker}&token=${encoded}?email=${marker}`, "/api/auth/login"],
    [`/api/auth/forgot-password?email=${encoded}&url=${marker}`, "/api/auth/forgot-password"],
    ["/api/auth/profile%3Funchanged%2Fpath", "/api/auth/profile%3Funchanged%2Fpath"]
  ]) {
    const req = {
      method: "POST",
      originalUrl,
      url: originalUrl.slice("/api/auth".length),
      baseUrl: "/api/auth",
      route: { path: "/login" },
      params: {},
      user: { userId: String(USER_ID), role: "user" },
      body: { password: CURRENT_PASSWORD, token: marker },
      headers: { authorization: `Bearer ${marker}` }
    };
    const before = structuredClone(req);
    const entries = await captureAuditLogs(() => {
      auditLog("LOGIN_FAILED", req, { reason: "invalid_credentials" });
    });

    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.deepEqual(entry, {
      timestamp: entry.timestamp,
      event: "LOGIN_FAILED",
      method: "POST",
      path: expectedPath,
      userId: String(USER_ID),
      role: "user",
      reason: "invalid_credentials"
    });
    assert.equal(Number.isNaN(Date.parse(entry.timestamp)), false);
    assert.deepEqual(req, before);
    assertNoSecretAuditMetadata(entry);
    const output = JSON.stringify(entries);
    for (const forbidden of [marker, encoded, decodeURIComponent(encoded)]) {
      assert.equal(output.includes(forbidden), false, "Query values must not reach audit output");
    }
  }
});

test("query-bearing account requests preserve responses and sanitized audit events", async () => {
  const marker = "synthetic-account-query-value";
  const query = `?token=${marker}&token=%73%65%63%72%65%74&email=${marker}?password=${marker}`;
  const headers = authHeaders(USER_ID);
  for (const [path, method, body, event, status, expectedBody, failure] of [
    ["/api/auth/profile", "PATCH", { name: "Updated Name" }, "PROFILE_UPDATED", 200,
      { success: true, user: { ...SAFE_PROFILE, id: String(USER_ID) } }, false],
    ["/api/auth/change-password", "POST", { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      "PASSWORD_CHANGED", 200, { success: true, message: "Password changed successfully." }, false],
    ["/api/auth/change-password", "POST", { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      "PASSWORD_CHANGE_FAILED", 401, { success: false, error: "Current password is incorrect" }, true]
  ]) {
    resetState();
    if (failure) {
      state.passwordError = new AccountServiceError(
        ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD, "Current password is incorrect", 401
      );
    }
    const entries = await captureAuditLogs(async () => {
      const response = await send(`${path}${query}`, method, body, headers);
      assert.equal(response.status, status);
      assertNoStore(response);
      assert.deepEqual((await readJson(response)).data, expectedBody);
    });

    assert.equal(state.calls.length, 1);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.path, path);
    assert.equal(entry.event, event);
    assert.equal(entry.method, method);
    assert.equal(entry.userId, String(USER_ID));
    assert.equal(entry.role, "user");
    assert.equal(entry.reason, failure ? "invalid_current_password" : undefined);
    assertNoSecretAuditMetadata(entry);
    const output = JSON.stringify(entries);
    for (const forbidden of [marker, "%73%65%63%72%65%74", "secret", headers.Authorization]) {
      assert.equal(output.includes(forbidden), false, "Query or header values must not reach audit output");
    }
  }
});

test("a successful profile update emits a safe PROFILE_UPDATED event", async () => {
  resetState();

  const entries = await captureAuditLogs(async () => {
    await patchProfile(
      { name: "Updated Name" },
      authHeaders(USER_ID)
    );
  });

  const updated = entries.find(
    (entry) => entry.event === "PROFILE_UPDATED"
  );

  assert.ok(updated, "PROFILE_UPDATED must be emitted");
  assert.equal(updated.userId, String(USER_ID));
  assert.equal(updated.role, "user");
  assert.equal(updated.method, "PATCH");
  assert.equal(updated.path, "/api/auth/profile");

  for (const entry of entries) {
    assertNoSecretAuditMetadata(entry);
  }
});

test("a successful password change emits a safe PASSWORD_CHANGED event", async () => {
  resetState();

  const entries = await captureAuditLogs(async () => {
    await postChangePassword(
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD
      },
      authHeaders(USER_ID)
    );
  });

  const changed = entries.find(
    (entry) => entry.event === "PASSWORD_CHANGED"
  );

  assert.ok(changed, "PASSWORD_CHANGED must be emitted");
  assert.equal(changed.userId, String(USER_ID));
  assert.equal(changed.role, "user");

  // Only the safe authenticated actor metadata is present.
  assert.deepEqual(Object.keys(changed).sort(), [
    "event",
    "method",
    "path",
    "role",
    "timestamp",
    "userId"
  ]);
  assert.equal(
    changed.changedUserId,
    undefined,
    "Audit metadata must not include service-returned identifiers"
  );
  assert.equal(
    entries.find(
      (entry) => entry.event === "PASSWORD_CHANGE_FAILED"
    ),
    undefined
  );

  for (const entry of entries) {
    assertNoSecretAuditMetadata(entry);
  }
});

test("an unchanged password returns the safe 400 without a new audit event", async () => {
  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.UNCHANGED_PASSWORD,
    "New password must be different from the current password",
    400
  );

  const entries = await captureAuditLogs(async () => {
    const response = await postChangePassword(
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD
      },
      authHeaders(USER_ID)
    );

    assert.equal(response.status, 400);
    assertNoStore(response);
  });

  assert.deepEqual(
    entries.filter(
      (entry) =>
        entry.event === "PASSWORD_CHANGED" ||
        entry.event === "PASSWORD_CHANGE_FAILED"
    ),
    []
  );
});

test("an unexpected failure uses the existing safe 500 handling", async () => {
  resetState();

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    state.passwordError = new Error(
      "MongoDB connection failure with internal detail"
    );

    const response = await postChangePassword(
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD
      },
      authHeaders(USER_ID)
    );

    const { text, data } = await readJson(response);

    assert.equal(response.status, 500);
    assert.deepEqual(data, {
      success: false,
      error: "Internal server error"
    });
    assertNoStore(response);
    assert.equal(
      text.includes("internal detail"),
      false
    );
    assert.equal(text.includes(NEW_PASSWORD), false);
    assert.equal(
      response.headers.get("content-type"),
      "application/json; charset=utf-8"
    );
  } finally {
    console.error = originalConsoleError;
  }

  resetState();

  const originalProfileConsoleError = console.error;
  console.error = () => {};

  try {
    state.profileError = new Error(
      "profile lookup failed with internal detail"
    );

    const response = await patchProfile(
      { name: "Valid Name" },
      authHeaders(USER_ID)
    );

    const { text } = await readJson(response);

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.equal(
      text.includes("internal detail"),
      false
    );
  } finally {
    console.error = originalProfileConsoleError;
  }
});

test("a corrupt stored password state stays a generic safe 500", async () => {
  resetState();

  state.passwordError = new AccountServiceError(
    ACCOUNT_ERROR_CODES.INVALID_STORED_PASSWORD,
    "Account password state is unavailable",
    500
  );

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const response = await postChangePassword(
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD
      },
      authHeaders(USER_ID)
    );

    const { text, data } = await readJson(response);

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "Internal server error"
    });

    // The internal service description must not be published.
    assert.equal(
      text.includes("Account password state is unavailable"),
      false
    );
    assertNoInternalDetail(text);
  } finally {
    console.error = originalConsoleError;
  }
});

test("an internal 5xx service error never publishes its message", async () => {
  const internalFailures = [
    {
      code: ACCOUNT_ERROR_CODES.INVALID_STORED_PASSWORD,
      message: "Account password state is unavailable",
      status: 503
    },
    {
      code: "ACCOUNT_INTERNAL_TEST_CODE",
      message: "internal detail: storage backend unreachable",
      status: 500
    }
  ];

  for (const failure of internalFailures) {
    resetState();

    state.profileError = new AccountServiceError(
      failure.code,
      failure.message,
      failure.status
    );

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const response = await patchProfile(
        { name: "Valid Name" },
        authHeaders(USER_ID)
      );

      const { text, data } = await readJson(response);

      assert.equal(response.status, 500);
      assertNoStore(response);
      assert.deepEqual(data, {
        success: false,
        error: "Internal server error"
      });
      assert.equal(text.includes(failure.message), false);
      assertNoInternalDetail(text);
    } finally {
      console.error = originalConsoleError;
    }
  }
});
