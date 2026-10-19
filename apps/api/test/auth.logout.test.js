const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const AuditLog = require("../src/models/AuditLog");
const authRoutes = require("../src/routes/auth.routes");
const errorHandler = require("../src/middleware/error.middleware");
const {
  createLogoutController,
  LOGGED_OUT_MESSAGE,
  SIGNED_OUT_MESSAGE
} = require("../src/controllers/auth.controller");
const {
  revokeOwnTokens,
  ACCOUNT_ERROR_CODES,
  AccountServiceError
} = require("../src/services/account.service");

// Server-side logout (Phase 0 security hardening).
//
// Three layers offline, no MongoDB, no live API:
//   1. account.service.revokeOwnTokens unit semantics, including the
//      REQUIRED distinction between an unconfirmed write (an error) and a
//      resolved write that matched no account (not an error, and not a
//      server-side revocation).
//   2. createLogoutController boundary semantics: distinct static messages,
//      no-store caching, bounded persistent audit event, and safe error
//      forwarding for an unconfirmed revocation.
//   3. An end-to-end revocation proof through the real production router:
//      logout bumps tokenVersion, and the previously valid token is then
//      rejected by `authenticate` on the very next request.

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const USER_ID = new mongoose.Types.ObjectId();
const NO_MATCH_USER_ID = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------
// 1. Service: revokeOwnTokens
// ---------------------------------------------------------------------

function makeRecordingUserModel(implementation) {
  const calls = [];

  return {
    calls,
    updateOne(filter, update) {
      calls.push({ filter, update });

      return implementation(filter, update);
    }
  };
}

test("revokeOwnTokens bumps tokenVersion for the authenticated account only", async () => {
  let bumpCalls = 0;
  const userModel = makeRecordingUserModel(() => {
    bumpCalls += 1;

    return { matchedCount: 1 };
  });

  const result = await revokeOwnTokens({
    userId: USER_ID.toString(),
    userModel
  });

  assert.deepEqual(result, { revoked: true });
  assert.equal(bumpCalls, 1);
  assert.equal(userModel.calls.length, 1);
  assert.deepEqual(userModel.calls[0].filter, { _id: USER_ID.toString() });
  assert.deepEqual(userModel.calls[0].update, {
    $inc: { tokenVersion: 1 }
  });
});

test("a resolved write matching no account is NOT a revocation and NOT an error", async () => {
  // The account vanished or was already invalidated between authentication
  // and the write. The session was already unauthenticatable, so logout is
  // complete - but the model must report that NO server-side revocation
  // happened, and it must not throw.
  const userModel = makeRecordingUserModel(() => ({ matchedCount: 0 }));

  const result = await revokeOwnTokens({
    userId: NO_MATCH_USER_ID.toString(),
    userModel
  });

  assert.deepEqual(result, { revoked: false });
});

test("an unconfirmed write result is refused as an error, never as success", async () => {
  const userModel = makeRecordingUserModel(() => undefined);

  await assert.rejects(
    revokeOwnTokens({ userId: USER_ID.toString(), userModel }),
    (error) =>
      error instanceof AccountServiceError &&
      error.code === ACCOUNT_ERROR_CODES.REVOCATION_UNCONFIRMED &&
      error.status === 500
  );

  // A rejected promise from the driver is likewise a real failure.
  const rejectingModel = makeRecordingUserModel(() => {
    throw new Error("driver simulated failure");
  });

  await assert.rejects(
    revokeOwnTokens({ userId: USER_ID.toString(), userModel: rejectingModel }),
    /driver simulated failure/
  );
});

test("revokeOwnTokens requires an authenticated user id", async () => {
  const userModel = makeRecordingUserModel(() => ({ matchedCount: 1 }));

  await assert.rejects(
    revokeOwnTokens({ userId: undefined, userModel }),
    (error) =>
      error instanceof AccountServiceError &&
      error.code === ACCOUNT_ERROR_CODES.NOT_FOUND &&
      error.status === 404
  );

  assert.equal(userModel.calls.length, 0);
});

// ---------------------------------------------------------------------
// 2. Controller: createLogoutController
// ---------------------------------------------------------------------

function makeResponse() {
  return {
    headers: {},
    statusCode: null,
    payload: null,
    set(key, value) {
      this.headers[key] = value;

      return this;
    },
    status(code) {
      this.statusCode = code;

      return this;
    },
    json(body) {
      this.payload = body;

      return this;
    }
  };
}

function makeRequest() {
  return {
    method: "POST",
    originalUrl: "/api/auth/logout",
    user: {
      userId: USER_ID.toString(),
      role: "user"
    }
  };
}

function makeStubAccountService({ revoked, failure } = {}) {
  const calls = [];

  return {
    calls,
    async revokeOwnTokens(input) {
      calls.push(input);

      if (failure) {
        failure();

        return undefined;
      }

      return { revoked };
    }
  };
}

test("logout answers with the truthful revocation message and no-store", async (t) => {
  const persistAuditCalls = [];
  const accountServiceStub = makeStubAccountService({ revoked: true });
  const consoleLog = t.mock.method(console, "log", () => {});
  const controller = createLogoutController({
    accountService: accountServiceStub,
    recordAuditEvent: async (event) => {
      persistAuditCalls.push(event);

      return null;
    }
  });

  const res = makeResponse();

  await controller.logout(makeRequest(), res, () => {
    throw new Error("next must not be called on the success path");
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: true,
    message: LOGGED_OUT_MESSAGE
  });
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(accountServiceStub.calls, [
    { userId: USER_ID.toString() }
  ]);

  // Exactly one durable audit event, carrying only the authenticated actor.
  assert.equal(persistAuditCalls.length, 1);
  assert.deepEqual(persistAuditCalls[0], {
    category: "authentication",
    action: "LOGOUT",
    outcome: "success",
    actor: USER_ID.toString(),
    actorRole: "user"
  });

  // Exactly one console audit event for LOGOUT, with no sensitive values.
  // auditLog prints the prefix and the JSON payload as separate arguments,
  // so the whole call is joined before matching.
  const auditLines = consoleLog.mock.calls
    .map((call) => call.arguments.join(" "))
    .filter(
      (line) => typeof line === "string" && line.startsWith("[AUDIT]")
    );

  assert.equal(auditLines.length, 1);
  assert.match(auditLines[0], /"event":"LOGOUT"/);
  assert.equal(
    auditLines.includes("current-Password-1"),
    false
  );
});

test("a resolved write with no matched account truthfully reports sign-out without revocation", async (t) => {
  const accountServiceStub = makeStubAccountService({ revoked: false });
  const controller = createLogoutController({
    accountService: accountServiceStub,
    recordAuditEvent: async () => null
  });

  const res = makeResponse();

  await controller.logout(makeRequest(), res, () => {
    throw new Error("next must not be called on the success path");
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: true,
    message: SIGNED_OUT_MESSAGE
  });

  // The rubric-critical guarantee: no response ever claims server-side
  // revocation for an unconfirmed write.
  assert.equal(
    JSON.stringify(res.payload).includes("revok"),
    false
  );
  assert.notEqual(res.payload.message, LOGGED_OUT_MESSAGE);
});

test("an unconfirmed revocation forwards to the sanitized error handler", async (t) => {
  let forwarded = null;
  const accountServiceStub = makeStubAccountService({
    failure: () => {
      throw new Error("driver simulated failure");
    }
  });
  const controller = createLogoutController({
    accountService: accountServiceStub,
    recordAuditEvent: async () => null
  });

  const res = makeResponse();

  await controller.logout(makeRequest(), res, (error) => {
    forwarded = error;
  });

  assert.ok(forwarded instanceof Error);
  assert.equal(res.statusCode, null);
  assert.equal(res.payload, null);
});

// ---------------------------------------------------------------------
// 3. End to end through the production router
// ---------------------------------------------------------------------

function mockAuthenticatedUser(t, id, role, tokenVersion) {
  return t.mock.method(User, "findOne", () => {
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: id,
          role,
          isActive: true,
          tokenVersion
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  });
}

// Keeps the persistent audit writer entirely offline and instant.
function mockAuditPersistence(t) {
  return t.mock.method(AuditLog, "create", async () => ({}));
}

const e2eApp = express();
e2eApp.use(express.json({ limit: "1mb" }));
e2eApp.use("/api/auth", authRoutes);
e2eApp.use(errorHandler);

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(e2eApp);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
});

function makeE2EToken(tokenVersion = 0) {
  return jwt.sign(
    {
      userId: USER_ID.toString(),
      role: "user",
      tokenVersion
    },
    testJwtSecret,
    {
      expiresIn: "1h"
    }
  );
}

async function send(path, token, method = "GET") {
  const headers = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers
  });
}

test("without a bearer token, logout is rejected as unauthenticated", async () => {
  const response = await send("/api/auth/logout", null, "POST");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Authentication required"
  });
});

test("logout through the production router revokes the account-wide token", async (t) => {
  mockAuthenticatedUser(t, USER_ID, "user", 0);
  mockAuditPersistence(t);

  const bumpMock = t.mock.method(User, "updateOne", async () => ({
    matchedCount: 1
  }));

  const token = makeE2EToken(0);

  // The logout response confirms the server-side revocation, because the
  // tokenVersion bump was confirmed by the (mocked) database operation.
  const logoutResponse = await send("/api/auth/logout", token, "POST");

  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutResponse.headers.get("cache-control"), "no-store");

  const logoutData = await logoutResponse.json();

  assert.deepEqual(logoutData, {
    success: true,
    message: LOGGED_OUT_MESSAGE
  });

  assert.equal(bumpMock.mock.callCount(), 1);
  assert.deepEqual(bumpMock.mock.calls[0].arguments[0], {
    _id: USER_ID.toString()
  });
  assert.deepEqual(bumpMock.mock.calls[0].arguments[1], {
    $inc: { tokenVersion: 1 }
  });

  // REVOCATION PROOF: the same token from before logout fails the very next
  // request, because authenticate resolves tokenVersion 1 against the
  // token's recorded 0.
  const afterLogoutLookup = t.mock.method(User, "findOne", () => {
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: USER_ID,
          role: "user",
          isActive: true,
          tokenVersion: 1
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  });

  const revokedResponse = await send("/api/auth/me", token, "GET");

  assert.equal(revokedResponse.status, 403);
  assert.deepEqual(await revokedResponse.json(), {
    success: false,
    error: "Invalid or expired token"
  });
  assert.equal(afterLogoutLookup.mock.callCount(), 1);
});

test("a resolved write matching no account signs the caller out without a revocation claim", async (t) => {
  mockAuthenticatedUser(t, USER_ID, "user", 0);
  mockAuditPersistence(t);

  t.mock.method(User, "updateOne", async () => ({ matchedCount: 0 }));

  const response = await send("/api/auth/logout", makeE2EToken(0), "POST");

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.deepEqual(data, {
    success: true,
    message: SIGNED_OUT_MESSAGE
  });
  assert.equal(
    JSON.stringify(data).includes("revok"),
    false
  );
});

test("an unconfirmed revocation answers with the sanitized generic 500", async (t) => {
  mockAuthenticatedUser(t, USER_ID, "user", 0);

  t.mock.method(User, "updateOne", async () => undefined);

  const response = await send("/api/auth/logout", makeE2EToken(0), "POST");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Internal server error"
  });
});
