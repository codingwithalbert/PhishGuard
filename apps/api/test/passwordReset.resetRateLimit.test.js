const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

const passwordResetRoutes = require("../src/routes/passwordReset.routes");
const {
  createPasswordResetRouter
} = require("../src/routes/passwordReset.routes");
const {
  resetPasswordLimiter,
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter
} = require("../src/middleware/rateLimit.middleware");
const {
  validateResetPasswordRequest
} = require("../src/middleware/passwordReset.validate.middleware");

// Reset-token submission rate limiting (Phase 0 security hardening).
//
// The real `resetPasswordLimiter` singleton is exercised against an isolated
// Express server with a stubbed `completePasswordReset` and a faked audit
// writer, so the test measures the limiter rather than the token lookup and
// the bcrypt re-hash it protects. The forgot-password limiter is replaced by
// a pass-through for this suite so the two quotas can never interfere.
//
// No MongoDB is used and no network service is contacted.
//
// RESERVATION: the behavioral test below consumes the singleton's full
// IP-keyed bucket. Structural (non-HTTP) assertions must therefore come after
// it, exactly like the forgot-password limiter suite.

const RESET_LIMIT = 10;
const LINK_TOKEN = "c".repeat(64);
const RESET_PASSWORD = "reset-Password-3";
const completedResets = [];

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api/auth",
  createPasswordResetRouter({
    service: {
      async completePasswordReset() {
        completedResets.push(Date.now());

        return { userId: new mongoose.Types.ObjectId() };
      }
    },
    forgotPasswordWorkflow: async () => null,
    forgotPasswordRateLimiter: (req, res, next) => next(),
    recordAuditEvent: async () => null
  })
);

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

async function post(path, body) {
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

test("password reset submissions are limited to ten per window with a safe message", async () => {
  const statuses = [];
  let limitedResponse;

  for (let attempt = 1; attempt <= RESET_LIMIT + 1; attempt += 1) {
    const response = await post("/api/auth/reset-password", {
      token: LINK_TOKEN,
      password: RESET_PASSWORD
    });

    statuses.push(response.status);
    assertDraftEightHeaders(response);

    if (response.status === 429) {
      limitedResponse = response;
    }
  }

  assert.deepEqual(
    statuses,
    [
      200, 200, 200, 200, 200,
      200, 200, 200, 200, 200,
      429
    ]
  );
  assert.ok(limitedResponse);

  // Every admitted request reached the stub service (whose response is the
  // single-use reset success shape), so the limiter itself did the counting.
  assert.equal(completedResets.length, RESET_LIMIT);

  const limitedText = await limitedResponse.text();
  const limitedData = JSON.parse(limitedText);

  assert.deepEqual(limitedData, {
    success: false,
    error: "Too many password reset attempts. Please try again later."
  });
  assert.equal(limitedText.includes(LINK_TOKEN), false);
  assert.equal(limitedText.includes(RESET_PASSWORD), false);
});

test("the limiter runs before validation, so a blocked caller performs no token work", async () => {
  // First: an invalid payload after exhaustion is still 429, not 400.
  const blockedInvalid = await post("/api/auth/reset-password", {
    token: 5,
    password: "short"
  });

  assert.equal(blockedInvalid.status, 429);

  // Second: a syntactically valid payload after exhaustion never reaches the
  // stubbed service, which is what bounds bcrypt CPU from a blocked caller.
  const blockedValid = await post("/api/auth/reset-password", {
    token: LINK_TOKEN,
    password: RESET_PASSWORD
  });

  assert.equal(blockedValid.status, 429);
  assert.equal(completedResets.length, RESET_LIMIT);
});

test("the production reset-password route mounts the limiter before validation", () => {
  const resetRoute = passwordResetRoutes.stack
    .filter((layer) => layer.route)
    .find((layer) => layer.route.path === "/reset-password");

  assert.ok(resetRoute, "POST /reset-password must be registered");
  assert.deepEqual(
    Object.keys(resetRoute.route.methods),
    ["post"]
  );

  const handlers = resetRoute.route.stack.map((entry) => entry.handle);

  assert.equal(handlers.length, 3);
  assert.equal(handlers[0], resetPasswordLimiter);
  assert.equal(handlers[1], validateResetPasswordRequest);
  assert.equal(handlers[2].name, "resetPassword");
});

test("the reset limiter is a distinct instance from every other limiter", () => {
  assert.equal(typeof resetPasswordLimiter, "function");

  for (const existing of [
    forgotPasswordLimiter,
    loginLimiter,
    registerLimiter
  ]) {
    assert.notEqual(resetPasswordLimiter, existing);
  }
});
