const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const authRoutes = require("../src/routes/auth.routes");
const {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter
} = require("../src/middleware/rateLimit.middleware");

// Real limiter instances are exercised here, mounted on the real auth routes.
//
// Each limiter is a module-level singleton with in-process state, so every test
// resets the client key before it starts. That makes each test independent:
// it does not rely on another test having consumed (or left intact) any
// counter, and the suite passes in any order.
//
// No MongoDB, running API, .env value, or external service is used. Requests
// send empty bodies, which `validateRegistration` rejects with a 400 before
// the controller, so neither the database nor the bcrypt hash is ever reached.
// What these tests prove is that the limiter counts requests, returns the
// project's safe 429 payload, and runs ahead of validation and the controller.
const REGISTER_LIMIT = 20;
const LOGIN_LIMIT = 10;
const FORGOT_LIMIT = 5;

// The test server binds to the IPv4 loopback, so every request arrives with
// `req.ip === "127.0.0.1"`. That is the single client key these limiters use,
// and therefore the only key that needs clearing between tests.
const CLIENT_KEY = "127.0.0.1";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", authRoutes);

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);

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

test.beforeEach(async () => {
  // Clear every limiter's counter so no test inherits state from another.
  await registerLimiter.resetKey(CLIENT_KEY);
  await loginLimiter.resetKey(CLIENT_KEY);
  await forgotPasswordLimiter.resetKey(CLIENT_KEY);
});

async function post(path, body = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function assertDraftEightHeaders(response) {
  assert.ok(response.headers.get("ratelimit"));
  assert.ok(response.headers.get("ratelimit-policy"));
  assert.equal(response.headers.get("x-ratelimit-limit"), null);
  assert.equal(response.headers.get("x-ratelimit-remaining"), null);
  assert.equal(response.headers.get("x-ratelimit-reset"), null);
}

// Posts `count` times and records the status of each response.
async function collectStatuses(path, body, count) {
  const statuses = [];

  for (let attempt = 0; attempt < count; attempt += 1) {
    const response = await post(path, body);

    statuses.push(response.status);
    assertDraftEightHeaders(response);
  }

  return statuses;
}

test("the registration limiter is a distinct exported middleware instance", () => {
  assert.equal(typeof registerLimiter, "function");
  assert.notEqual(registerLimiter, loginLimiter);
  assert.notEqual(registerLimiter, forgotPasswordLimiter);
});

test("registration allows twenty requests per window and blocks the twenty-first", async () => {
  const statuses = await collectStatuses(
    "/api/auth/register",
    {},
    REGISTER_LIMIT + 1
  );

  // The first twenty requests pass the limiter and are then rejected by
  // registration validation with a 400; the twenty-first is limited.
  assert.deepEqual(
    statuses.slice(0, REGISTER_LIMIT),
    Array.from({ length: REGISTER_LIMIT }, () => 400)
  );
  assert.deepEqual(statuses.slice(REGISTER_LIMIT), [429]);

  const limitedResponse = await post("/api/auth/register");
  const limitedData = await limitedResponse.json();

  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(limitedData, {
    success: false,
    error: "Too many registration attempts. Please try again later."
  });
});

test("the registration limiter runs before registration validation and the controller", async () => {
  // Exhaust the window with requests whose bodies are invalid.
  await collectStatuses("/api/auth/register", {}, REGISTER_LIMIT);

  // A request with an invalid body is still answered with the limiter's 429
  // rather than the validator's 400. That ordering is only possible if the
  // limiter is mounted ahead of `validateRegistration`, so a blocked caller
  // never reaches the bcrypt hash or account creation.
  const blockedResponse = await post("/api/auth/register", {
    name: "Valid Name",
    email: "not-an-email",
    password: "short"
  });

  assert.equal(blockedResponse.status, 429);
  assert.deepEqual(await blockedResponse.json(), {
    success: false,
    error: "Too many registration attempts. Please try again later."
  });

  // The same invalid body is answered by validation when the window is not
  // exhausted, confirming 429 above is the limiter and not the validator.
  await registerLimiter.resetKey(CLIENT_KEY);

  const validationResponse = await post("/api/auth/register", {
    name: "Valid Name",
    email: "not-an-email",
    password: "short"
  });

  assert.equal(validationResponse.status, 400);
});

test("registration traffic does not consume the login limiter's counter", async () => {
  // Burn more than the registration limit.
  await collectStatuses(
    "/api/auth/register",
    {},
    REGISTER_LIMIT + 1
  );

  const loginStatuses = await collectStatuses(
    "/api/auth/login",
    {},
    LOGIN_LIMIT + 1
  );

  // The login counter started empty, so login still allows its full limit of
  // ten before limiting the eleventh.
  assert.deepEqual(
    loginStatuses.slice(0, LOGIN_LIMIT),
    Array.from({ length: LOGIN_LIMIT }, () => 400)
  );
  assert.deepEqual(loginStatuses.slice(LOGIN_LIMIT), [429]);

  const limitedResponse = await post("/api/auth/login", {});
  const limitedData = await limitedResponse.json();

  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(limitedData, {
    success: false,
    error: "Too many login attempts. Please try again later."
  });
});

test("forgot-password keeps its own limit and message", async () => {
  const statuses = await collectStatuses(
    "/api/auth/forgot-password",
    { email: "limited.user@example.invalid" },
    FORGOT_LIMIT + 1
  );

  // Forgot-password accepts its request, so the first five succeed and only
  // the sixth is limited, unaffected by any registration or login traffic.
  assert.deepEqual(
    statuses.slice(0, FORGOT_LIMIT),
    Array.from({ length: FORGOT_LIMIT }, () => 200)
  );
  assert.deepEqual(statuses.slice(FORGOT_LIMIT), [429]);

  const limitedResponse = await post("/api/auth/forgot-password", {
    email: "limited.user@example.invalid"
  });
  const limitedData = await limitedResponse.json();

  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(limitedData, {
    success: false,
    error: "Too many password reset requests. Please try again later."
  });
});
