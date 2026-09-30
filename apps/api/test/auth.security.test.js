const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");
const authRoutes = require("../src/routes/auth.routes");
const errorHandler = require("../src/middleware/error.middleware");

// Exercise the production router, validators, controllers, JWTs, and bcrypt.
// Only User persistence is stubbed; no dotenv, MongoDB, or mail is used.
const testJwtSecret = crypto.randomBytes(32).toString("hex");
const PASSWORD = crypto.randomBytes(24).toString("hex");
const WRONG_PASSWORD = crypto.randomBytes(24).toString("hex");
const RESET_HASH = "auth-security-reset-hash-marker";
const RESET_TOKEN = "auth-security-raw-reset-marker";
const EMAIL = "auth.security@example.invalid";
let passwordHash;
let server;
let baseUrl;
let previousJwtSecret;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", authRoutes);
app.use(errorHandler);

before(async () => {
  previousJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = testJwtSecret;
  passwordHash = await bcrypt.hash(PASSWORD, 12);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  }
});

function makeAccount(overrides = {}) {
  // Keep protected fields visible to the controller intentionally: response
  // privacy must not depend solely on a database projection hiding them.
  return new User({
    name: "Auth Security User",
    email: EMAIL,
    password: passwordHash,
    passwordResetTokenHash: RESET_HASH,
    passwordResetExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides
  });
}

function stubPersistence(t, account = null) {
  const state = { finds: [], selections: [], ids: [], writes: [], stored: [] };

  t.mock.method(User, "findOne", (filter) => {
    state.finds.push(filter);
    const result = account && account.email === filter.email
      ? account
      : state.stored.find((document) => document.email === filter.email) || null;
    const query = {
      select(selection) {
        state.selections.push(selection);
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      }
    };
    return query;
  });

  t.mock.method(User, "findById", async (id) => {
    state.ids.push(String(id));
    return account && String(account._id) === String(id) ? account : null;
  });

  t.mock.method(User, "create", async (input) => {
    state.writes.push(input);
    // Use actual schema validation/defaults, without saving to MongoDB.
    const document = new User(input);
    await document.validate();
    state.stored.push(document);
    return document;
  });

  return state;
}

async function post(path, body) {
  return fetch(`${baseUrl}/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function register(extra = {}) {
  return post("/register", {
    name: "Auth Security User",
    email: EMAIL,
    password: PASSWORD,
    ...extra
  });
}

function getMe(account) {
  const token = jwt.sign(
    { userId: String(account._id), role: account.role },
    testJwtSecret,
    { expiresIn: "1h" }
  );
  return fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function assertInvalidLogin(response) {
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Invalid email or password"
  });
}

async function assertSafeResponse(response, status, keys, account) {
  assert.equal(response.status, status);
  const text = await response.text();
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data).sort(), [...keys].sort());
  assert.equal(data.success, true);
  assert.deepEqual(data.user, {
    id: String(account._id),
    name: account.name,
    email: account.email,
    role: account.role
  });
  for (const sensitive of [PASSWORD, WRONG_PASSWORD, account.password, RESET_HASH, RESET_TOKEN]) {
    assert.equal(text.includes(sensitive), false, "Response must not expose credential values");
  }
  return data;
}

test("login with an unknown email returns the safe 401 response", async (t) => {
  const state = stubPersistence(t);
  await assertInvalidLogin(await post("/login", { email: EMAIL, password: PASSWORD }));
  assert.deepEqual(state.finds, [{ email: EMAIL }]);
  assert.deepEqual(state.selections, ["+password"]);
  assert.equal(state.writes.length, 0);
});

test("login with an incorrect password returns the safe 401 response", async (t) => {
  const account = makeAccount();
  const state = stubPersistence(t, account);
  await assertInvalidLogin(await post("/login", { email: EMAIL, password: WRONG_PASSWORD }));
  assert.deepEqual(state.finds, [{ email: EMAIL }]);
  assert.deepEqual(state.selections, ["+password"]);
  assert.equal(state.writes.length, 0);
});

test("inactive account login returns the safe 401 response", async (t) => {
  const account = makeAccount({ isActive: false });
  const state = stubPersistence(t, account);
  await assertInvalidLogin(await post("/login", { email: EMAIL, password: PASSWORD }));
  assert.deepEqual(state.finds, [{ email: EMAIL }]);
  assert.equal(account.isActive, false);
  assert.equal(state.writes.length, 0);
});

test("GET /api/auth/me for an inactive authenticated account returns the safe 404 response", async (t) => {
  const account = makeAccount({ isActive: false });
  const state = stubPersistence(t, account);
  const response = await getMe(account);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "User not found" });
  assert.deepEqual(state.ids, [String(account._id)]);
  // This proves the me controller checks activity, not global JWT revocation.
});

test("GET /api/auth/me rejects a correctly signed expired JWT with a safe 403 before downstream execution", async (t) => {
  const account = makeAccount();
  const state = stubPersistence(t, account);
  const meRoute = authRoutes.stack.find((layer) => layer.route?.path === "/me").route;
  const handler = t.mock.method(meRoute.stack.at(-1), "handle");
  const claims = { userId: String(account._id), role: account.role, exp: 1 };
  const token = jwt.sign(claims, testJwtSecret, { noTimestamp: true });

  // Valid structure/signature; expiration alone makes this token invalid.
  assert.deepEqual(jwt.verify(token, testJwtSecret, { ignoreExpiration: true }), claims);
  assert.throws(() => jwt.verify(token, testJwtSecret), { name: "TokenExpiredError" });

  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Invalid or expired token"
  });
  assert.equal(handler.mock.callCount(), 0);
  assert.deepEqual(state, { finds: [], selections: [], ids: [], writes: [], stored: [] });
});

test("public registration ignores forged Staff and Admin privileges and stores an ordinary user", async (t) => {
  const state = stubPersistence(t);
  for (const role of ["staff", "admin"]) {
    const response = await register({
      email: `${role}.auth.security@example.invalid`,
      role,
      isAdmin: true,
      permissions: ["admin"],
      isActive: false,
      passwordResetTokenHash: RESET_HASH,
      passwordResetExpiresAt: "2030-01-01T00:00:00.000Z"
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    const stored = state.stored.at(-1);
    assert.deepEqual(Object.keys(state.writes.at(-1)).sort(), ["email", "name", "password"]);
    assert.equal(stored.role, "user");
    assert.equal(stored.isActive, true);
    assert.equal(stored.passwordResetTokenHash, null);
    assert.equal(stored.passwordResetExpiresAt, null);
    assert.equal(data.user.role, "user");
    assert.equal(data.user.id, String(stored._id));
  }
  assert.equal(state.stored.length, 2);
});

test("registration stores a bcrypt cost-12 hash instead of plaintext", async (t) => {
  const state = stubPersistence(t);
  const response = await register();
  assert.equal(response.status, 201);
  assert.equal(state.writes.length, 1);
  const storedHash = state.stored[0].password;
  assert.equal(storedHash === PASSWORD, false, "Stored password must not be plaintext");
  assert.equal(state.writes[0].password === storedHash, true);
  assert.equal(bcrypt.getRounds(storedHash), 12);
  assert.equal(await bcrypt.compare(PASSWORD, storedHash), true);
});

test("successful registration returns only safe fields without protected credential state", async (t) => {
  const state = stubPersistence(t);
  const response = await register();
  const data = await assertSafeResponse(response, 201, ["success", "message", "user"], state.stored[0]);
  assert.equal(data.message, "Registration successful");
});

test("successful login returns only safe fields and a JWT without protected credential state", async (t) => {
  const account = makeAccount();
  const state = stubPersistence(t, account);
  const response = await post("/login", { email: EMAIL, password: PASSWORD });
  const data = await assertSafeResponse(response, 200, ["success", "message", "token", "user"], account);
  assert.equal(data.message, "Login successful");
  const claims = jwt.verify(data.token, testJwtSecret);
  assert.deepEqual(Object.keys(claims).sort(), ["exp", "iat", "role", "userId"]);
  assert.equal(claims.userId, String(account._id));
  assert.equal(claims.role, "user");
  assert.equal(claims.exp - claims.iat, 60 * 60);
  assert.deepEqual(state.selections, ["+password"]);
});

test("GET /api/auth/me returns only safe fields without protected credential state", async (t) => {
  const account = makeAccount();
  const state = stubPersistence(t, account);
  await assertSafeResponse(await getMe(account), 200, ["success", "user"], account);
  assert.deepEqual(state.ids, [String(account._id)]);
});
