const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

const authRoutes = require("../src/routes/auth.routes");
const {
  createPasswordResetRouter
} = require("../src/routes/passwordReset.routes");
const {
  forgotPasswordLimiter,
  loginLimiter
} = require("../src/middleware/rateLimit.middleware");

// Real limiter instances are exercised here. Both are module-level singletons,
// so each is used by exactly one test in this file.
const FORGOT_LIMIT = 5;
const LOGIN_LIMIT = 10;
const EMAIL = "limited.user@example.invalid";
const PASSWORD = "limited-Password-1";
const RESET_TOKEN = "b".repeat(64);
const workflowCalls = [];

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api/auth",
  createPasswordResetRouter({
    service: {
      async completePasswordReset() {
        return { userId: new mongoose.Types.ObjectId() };
      }
    },
    forgotPasswordWorkflow: async () => {
      workflowCalls.push(Date.now());
      return null;
    }
  })
);
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

test("forgot-password requests are limited to five per window with a safe message", async () => {
  const statuses = [];
  let limitedResponse;

  for (let attempt = 1; attempt <= FORGOT_LIMIT + 1; attempt += 1) {
    const response = await post("/api/auth/forgot-password", {
      email: EMAIL
    });

    statuses.push(response.status);
    assertDraftEightHeaders(response);

    if (attempt === 1) {
      const data = await response.json();

      assert.equal(data.success, true);
      assert.equal(
        data.message,
        "If an account exists for that email, a password reset link has been sent."
      );
    }

    if (response.status === 429) {
      limitedResponse = response;
    }
  }

  assert.deepEqual(
    statuses,
    [200, 200, 200, 200, 200, 429]
  );
  assert.ok(limitedResponse);

  const limitedText = await limitedResponse.text();
  const limitedData = JSON.parse(limitedText);

  assert.deepEqual(limitedData, {
    success: false,
    error:
      "Too many password reset requests. Please try again later."
  });
  assert.equal(limitedText.includes(EMAIL), false);
  assert.equal(limitedText.includes(RESET_TOKEN), false);
  assert.equal(limitedText.includes(PASSWORD), false);

  // The limiter runs before validation and the workflow, so a blocked request
  // never reaches the mail workflow.
  assert.equal(
    workflowCalls.length,
    FORGOT_LIMIT
  );

  const blockedBeforeValidation = await post(
    "/api/auth/forgot-password",
    { email: "not-an-email" }
  );

  assert.equal(blockedBeforeValidation.status, 429);
  assert.equal(workflowCalls.length, FORGOT_LIMIT);
});

test("the login limiter still allows ten attempts and keeps its own message", async () => {
  const statuses = [];
  let limitedResponse;

  for (let attempt = 1; attempt <= LOGIN_LIMIT + 1; attempt += 1) {
    // A malformed login body never reaches the database, so this verifies the
    // limiter without any MongoDB access.
    const response = await post("/api/auth/login", {});

    statuses.push(response.status);
    assertDraftEightHeaders(response);

    if (response.status === 429) {
      limitedResponse = response;
    }
  }

  assert.deepEqual(
    statuses,
    [
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      429
    ]
  );
  assert.ok(limitedResponse);

  const limitedData = await limitedResponse.json();

  assert.deepEqual(limitedData, {
    success: false,
    error: "Too many login attempts. Please try again later."
  });
});

test("both limiters are exported as distinct middleware instances", () => {
  assert.equal(typeof loginLimiter, "function");
  assert.equal(typeof forgotPasswordLimiter, "function");
  assert.notEqual(loginLimiter, forgotPasswordLimiter);
});
