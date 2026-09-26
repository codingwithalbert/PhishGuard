const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const authRoutes = require("../src/routes/auth.routes");
const passwordResetRoutes = require("../src/routes/passwordReset.routes");
const errorHandler = require("../src/middleware/error.middleware");
const {
  GENERIC_FORGOT_PASSWORD_MESSAGE,
  RESET_PASSWORD_SUCCESS_MESSAGE
} = require("../src/controllers/passwordReset.controller");
const {
  MAX_RESET_TOKEN_LENGTH,
  PASSWORD_POLICY,
  PASSWORD_RESET_ERROR_CODES,
  PasswordResetServiceError
} = require("../src/services/passwordReset.service");
const {
  hashResetToken
} = require("../src/services/passwordResetToken.service");

const { createPasswordResetRouter } = passwordResetRoutes;

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = "stage3-route-test-secret-not-a-real-secret";
process.env.JWT_SECRET = testJwtSecret;

const EXISTING_EMAIL = "existing.user@example.invalid";
const MISSING_EMAIL = "missing.user@example.invalid";
const RESET_TOKEN = "a".repeat(64);
const RESET_TOKEN_HASH = hashResetToken(RESET_TOKEN);
const NEW_PASSWORD = "new-Password-2";
const RESET_USER_ID = new mongoose.Types.ObjectId();
const FORBIDDEN_SENSITIVE_VALUES = [
  RESET_TOKEN,
  RESET_TOKEN_HASH,
  NEW_PASSWORD,
  "old-Password-1"
];

// Recorded service/workflow calls. The workflow result deliberately contains a
// raw reset token so the tests can prove it never reaches a response.
const calls = [];
let serviceError = null;
let workflowError = null;
let workflowResult = null;
let workflowImplementation = null;

const service = {
  async completePasswordReset(input) {
    calls.push({ operation: "completePasswordReset", input });

    if (serviceError) {
      const error = serviceError;
      serviceError = null;
      throw error;
    }

    return { userId: RESET_USER_ID };
  },

  async clearPasswordResetStateIfCurrent(input) {
    calls.push({ operation: "clearPasswordResetStateIfCurrent", input });

    return true;
  },

  async preparePasswordReset(input) {
    calls.push({ operation: "preparePasswordReset", input });

    return null;
  }
};

const forgotPasswordWorkflow = async (input) => {
  calls.push({ operation: "forgotPasswordWorkflow", input });

  if (workflowImplementation) {
    return workflowImplementation(input);
  }

  if (workflowError) {
    const error = workflowError;
    workflowError = null;
    throw error;
  }

  return workflowResult;
};

// Contract tests must not consume the shared production limiter instances.
const passThroughLimiter = (req, res, next) => next();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Mounted first so /reset-password and /forgot-password use the injected
// service and workflow; the real auth router below still serves every
// existing auth route.
app.use(
  "/api/auth",
  createPasswordResetRouter({
    service,
    forgotPasswordWorkflow,
    forgotPasswordRateLimiter: passThroughLimiter
  })
);
app.use("/api/auth", authRoutes);
app.use(errorHandler);

let server;
let baseUrl;

// auditLog writes through console.log. Output is buffered for the whole file
// so audit assertions stay explicit and the test log remains readable.
const auditOutput = [];
const originalConsoleLog = console.log;

test.before(async () => {
  console.log = (...args) => {
    auditOutput.push(args.join(" "));
  };

  server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  console.log = originalConsoleLog;

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

function resetTestState() {
  calls.length = 0;
  serviceError = null;
  workflowError = null;
  workflowResult = null;
  workflowImplementation = null;
  auditOutput.length = 0;
}

function takeAuditEntries() {
  return auditOutput.splice(0).map((entry) => {
    const json = entry.slice(entry.indexOf("{"));

    try {
      return JSON.parse(json);
    } catch {
      return { raw: entry };
    }
  });
}

function comparableAuditEntry(entry) {
  return {
    event: entry.event,
    method: entry.method,
    path: entry.path,
    userId: entry.userId,
    role: entry.role,
    reason: entry.reason
  };
}

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers
  });
}

async function readJson(response) {
  const text = await response.text();

  return {
    text,
    data: JSON.parse(text)
  };
}

function assertNoStore(response) {
  assert.equal(
    response.headers.get("cache-control"),
    "no-store"
  );
}

function assertNoSensitiveData(text) {
  for (const sensitiveValue of FORBIDDEN_SENSITIVE_VALUES) {
    assert.equal(
      text.includes(sensitiveValue),
      false,
      `Response must not contain ${sensitiveValue.slice(0, 8)}...`
    );
  }

  for (const forbiddenField of [
    "resetToken",
    "tokenHash",
    "password",
    "resetUrl",
    "apiKey"
  ]) {
    assert.equal(
      text.includes(`"${forbiddenField}"`),
      false,
      `Response must not expose a ${forbiddenField} field`
    );
  }
}

function findAuditEvent(entries, event) {
  return entries.find((entry) => entry.event === event);
}

function assertSafeAuditEntry(entry) {
  const serialized = JSON.stringify(entry);

  for (const sensitiveValue of [
    ...FORBIDDEN_SENSITIVE_VALUES,
    EXISTING_EMAIL,
    MISSING_EMAIL,
    "Bearer"
  ]) {
    assert.equal(
      serialized.includes(sensitiveValue),
      false,
      `Audit entry must not contain ${sensitiveValue.slice(0, 8)}...`
    );
  }

  for (const forbiddenField of [
    "password",
    "token",
    "tokenHash",
    "resetToken",
    "resetUrl",
    "apiKey",
    "body",
    "authorization"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(entry, forbiddenField),
      false
    );
  }
}

test("forgot-password accepts exactly a valid email and normalizes it", async () => {
  resetTestState();
  workflowResult = null;

  const response = await post("/api/auth/forgot-password", {
    email: `  ${EXISTING_EMAIL.toUpperCase()}  `
  });

  const { text, data } = await readJson(response);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(data, {
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });
  assertNoSensitiveData(text);

  const workflowCall = calls.find(
    (call) => call.operation === "forgotPasswordWorkflow"
  );

  assert.ok(workflowCall);
  assert.equal(workflowCall.input.email, EXISTING_EMAIL);
  assert.equal(
    calls.filter(
      (call) => call.operation === "forgotPasswordWorkflow"
    ).length,
    1
  );
});

test("forgot-password rejects malformed and non-string emails", async () => {
  resetTestState();

  for (const email of [
    "not-an-email",
    "missing-domain@example",
    "missing-local@",
    "user name@example.invalid",
    "user@exam ple.invalid",
    `${"a".repeat(250)}@example.invalid`,
    "",
    "   ",
    42,
    null,
    ["someone@example.invalid"]
  ]) {
    const response = await post("/api/auth/forgot-password", {
      email
    });

    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "A valid email address is required"
    });
  }

  assert.equal(
    calls.filter(
      (call) => call.operation === "forgotPasswordWorkflow"
    ).length,
    0
  );
});

test("forgot-password rejects extra, missing, and non-object bodies", async () => {
  resetTestState();

  for (const body of [
    {},
    { email: EXISTING_EMAIL, token: RESET_TOKEN },
    { email: EXISTING_EMAIL, role: "admin" },
    { email: EXISTING_EMAIL, password: NEW_PASSWORD },
    { Email: EXISTING_EMAIL },
    []
  ]) {
    const response = await post("/api/auth/forgot-password", body);

    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "Only email may be submitted"
    });
  }

  // A non-object JSON payload is still rejected safely by the existing global
  // JSON error handling, which Stage 3 leaves unchanged.
  const scalarBody = await post("/api/auth/forgot-password", "email");

  assert.equal(scalarBody.status, 400);
  assert.deepEqual((await readJson(scalarBody)).data, {
    success: false,
    error: "Invalid JSON payload"
  });

  assert.equal(
    calls.filter(
      (call) => call.operation === "forgotPasswordWorkflow"
    ).length,
    0
  );
});

test("forgot-password returns identical public responses for existing and nonexistent accounts", async () => {
  resetTestState();

  const existingAccount = createResetTokenResult();

  workflowImplementation = async (input) => {
    if (input.email === EXISTING_EMAIL) {
      return existingAccount;
    }

    return null;
  };

  const existingResponse = await post("/api/auth/forgot-password", {
    email: EXISTING_EMAIL
  });
  const existingBody = await readJson(existingResponse);

  const missingResponse = await post("/api/auth/forgot-password", {
    email: MISSING_EMAIL
  });
  const missingBody = await readJson(missingResponse);

  assert.equal(existingResponse.status, missingResponse.status);
  assert.equal(existingResponse.status, 200);
  assert.equal(existingBody.text, missingBody.text);
  assert.deepEqual(existingBody.data, {
    success: true,
    message:
      "If an account exists for that email, a password reset link has been sent."
  });
  assertNoStore(existingResponse);
  assertNoStore(missingResponse);
  assertNoSensitiveData(existingBody.text);
  assertNoSensitiveData(missingBody.text);
  assert.equal(
    existingBody.text.includes(existingAccount.resetToken),
    false
  );
});

test("forgot-password logs a safe PASSWORD_RESET_REQUESTED event for both account cases", async () => {
  resetTestState();
  workflowImplementation = async (input) =>
    input.email === EXISTING_EMAIL ? createResetTokenResult() : null;

  await post("/api/auth/forgot-password", { email: EXISTING_EMAIL });
  const existingEntries = takeAuditEntries();

  await post("/api/auth/forgot-password", { email: MISSING_EMAIL });
  const missingEntries = takeAuditEntries();

  const existingEvent = findAuditEvent(
    existingEntries,
    "PASSWORD_RESET_REQUESTED"
  );
  const missingEvent = findAuditEvent(
    missingEntries,
    "PASSWORD_RESET_REQUESTED"
  );

  assert.ok(existingEvent);
  assert.ok(missingEvent);
  assert.equal(existingEvent.reason, "accepted");
  assert.equal(missingEvent.reason, "accepted");
  assert.deepEqual(
    comparableAuditEntry(existingEvent),
    comparableAuditEntry(missingEvent),
    "Audit output must not distinguish existing from nonexistent accounts"
  );

  for (const entry of [...existingEntries, ...missingEntries]) {
    assertSafeAuditEntry(entry);
  }
});

test("a failed delivery keeps the generic response and logs a safe EMAIL_FAILED event", async () => {
  resetTestState();
  workflowError = new Error(
    "mail provider rejected the reset message"
  );

  const failureResponse = await post("/api/auth/forgot-password", {
    email: EXISTING_EMAIL
  });
  const failureBody = await readJson(failureResponse);

  assert.equal(failureResponse.status, 200);
  assertNoStore(failureResponse);
  assert.deepEqual(failureBody.data, {
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });
  assertNoSensitiveData(failureBody.text);

  const missingResponse = await post("/api/auth/forgot-password", {
    email: MISSING_EMAIL
  });
  const missingBody = await readJson(missingResponse);

  assert.equal(
    missingResponse.status,
    failureResponse.status
  );
  assert.equal(missingBody.text, failureBody.text);

  const failureEntries = takeAuditEntries();
  const existingFailureEvent = findAuditEvent(
    failureEntries,
    "PASSWORD_RESET_EMAIL_FAILED"
  );
  const missingSuccessEvent = findAuditEvent(
    failureEntries,
    "PASSWORD_RESET_REQUESTED"
  );

  assert.ok(existingFailureEvent);
  assert.equal(existingFailureEvent.reason, "delivery_failed");
  assert.ok(missingSuccessEvent);
  assert.equal(missingSuccessEvent.reason, "accepted");

  for (const entry of failureEntries) {
    assertSafeAuditEntry(entry);
  }

  workflowError = new Error("mail provider rejected the message");
  await post("/api/auth/forgot-password", { email: EXISTING_EMAIL });

  const repeatedFailureEntries = takeAuditEntries();
  const failedEvent = findAuditEvent(
    repeatedFailureEntries,
    "PASSWORD_RESET_EMAIL_FAILED"
  );

  assert.ok(failedEvent);
  assert.equal(failedEvent.reason, "delivery_failed");
  assert.equal(
    findAuditEvent(
      repeatedFailureEntries,
      "PASSWORD_RESET_REQUESTED"
    ),
    undefined
  );

  for (const entry of repeatedFailureEntries) {
    assertSafeAuditEntry(entry);
  }

  // Conditional cleanup stays the workflow's Stage 2 responsibility.
  assert.equal(
    calls.filter(
      (call) =>
        call.operation === "clearPasswordResetStateIfCurrent"
    ).length,
    0
  );
});

test("reset-password accepts exactly a token and password and resets through the service", async () => {
  resetTestState();

  const response = await post("/api/auth/reset-password", {
    token: RESET_TOKEN,
    password: NEW_PASSWORD
  });

  const { text, data } = await readJson(response);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(data, {
    success: true,
    message:
      "Password reset successfully. You can now log in with your new password."
  });
  assert.deepEqual(Object.keys(data).sort(), ["message", "success"]);
  assertNoSensitiveData(text);

  const serviceCall = calls.find(
    (call) => call.operation === "completePasswordReset"
  );

  assert.ok(serviceCall);
  assert.deepEqual(serviceCall.input, {
    token: RESET_TOKEN,
    newPassword: NEW_PASSWORD
  });
});

test("reset-password rejects extra fields including confirmPassword", async () => {
  resetTestState();

  for (const body of [
    { token: RESET_TOKEN, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    { token: RESET_TOKEN, password: NEW_PASSWORD, email: EXISTING_EMAIL },
    { token: RESET_TOKEN },
    { password: NEW_PASSWORD },
    { token: RESET_TOKEN, password: NEW_PASSWORD, role: "admin" },
    []
  ]) {
    const response = await post("/api/auth/reset-password", body);

    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "Only token and password may be submitted"
    });
  }

  assert.equal(
    calls.filter(
      (call) => call.operation === "completePasswordReset"
    ).length,
    0
  );
});

test("reset-password rejects malformed and oversized tokens", async () => {
  resetTestState();

  for (const token of [
    "",
    "z".repeat(MAX_RESET_TOKEN_LENGTH + 1),
    12345678,
    null,
    { value: RESET_TOKEN }
  ]) {
    const response = await post("/api/auth/reset-password", {
      token,
      password: NEW_PASSWORD
    });

    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: "A valid reset token is required"
    });
  }

  assert.equal(
    calls.filter(
      (call) => call.operation === "completePasswordReset"
    ).length,
    0
  );
});

test("token shape is deliberately left to the service so failures stay generic", async () => {
  resetTestState();

  const response = await post("/api/auth/reset-password", {
    token: "   ",
    password: NEW_PASSWORD
  });

  assert.equal(response.status, 200);
  assertNoStore(response);

  const serviceCall = calls.find(
    (call) => call.operation === "completePasswordReset"
  );

  // Stage 2 turns any unknown token shape into the same generic failure.
  assert.ok(serviceCall);
  assert.equal(serviceCall.input.token, "   ");

  serviceError = new PasswordResetServiceError(
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
    "The password reset link is invalid or has expired",
    400
  );

  const rejected = await post("/api/auth/reset-password", {
    token: "   ",
    password: NEW_PASSWORD
  });

  assert.equal(rejected.status, 400);
  assert.deepEqual((await readJson(rejected)).data, {
    success: false,
    error: "The password reset link is invalid or has expired"
  });
});

test("reset-password enforces the existing 8 to 128 character password policy", async () => {
  resetTestState();

  for (const password of [
    "a".repeat(PASSWORD_POLICY.minLength - 1),
    "a".repeat(PASSWORD_POLICY.maxLength + 1),
    "",
    "   ",
    12345678,
    null
  ]) {
    const response = await post("/api/auth/reset-password", {
      token: RESET_TOKEN,
      password
    });

    const { data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`
    });
  }

  assert.equal(
    calls.filter(
      (call) => call.operation === "completePasswordReset"
    ).length,
    0
  );

  for (const password of [
    "a".repeat(PASSWORD_POLICY.minLength),
    "a".repeat(PASSWORD_POLICY.maxLength)
  ]) {
    const response = await post("/api/auth/reset-password", {
      token: RESET_TOKEN,
      password
    });

    assert.equal(response.status, 200);
  }

  assert.equal(
    calls.filter(
      (call) => call.operation === "completePasswordReset"
    ).length,
    2
  );
});

test("reset-password maps Stage 2 service errors to safe public failures", async () => {
  resetTestState();

  const failures = [
    {
      code: PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
      message:
        "The password reset link is invalid or has expired"
    },
    {
      code: PASSWORD_RESET_ERROR_CODES.INVALID_PASSWORD,
      message: "Password must be between 8 and 128 characters"
    }
  ];

  for (const failure of failures) {
    serviceError = new PasswordResetServiceError(
      failure.code,
      failure.message,
      400
    );

    const response = await post("/api/auth/reset-password", {
      token: RESET_TOKEN,
      password: NEW_PASSWORD
    });

    const { text, data } = await readJson(response);

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(data, {
      success: false,
      error: failure.message
    });
    assertNoSensitiveData(text);
  }

  serviceError = new PasswordResetServiceError(
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
    "The password reset link is invalid or has expired",
    400
  );

  await post("/api/auth/reset-password", {
    token: RESET_TOKEN,
    password: NEW_PASSWORD
  });

  const entries = takeAuditEntries();
  const failedEvent = findAuditEvent(
    entries,
    "PASSWORD_RESET_FAILED"
  );

  assert.ok(failedEvent);
  assert.equal(
    failedEvent.reason,
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
  );

  for (const entry of entries) {
    assertSafeAuditEntry(entry);
  }
});

test("reset-password never exposes unexpected failures and never returns a JWT", async () => {
  resetTestState();
  serviceError = new Error(
    "mongodb connection failure with internal detail"
  );

  // The global error handler logs server-side; silence it for this assertion.
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const response = await post("/api/auth/reset-password", {
      token: RESET_TOKEN,
      password: NEW_PASSWORD
    });

    const { text, data } = await readJson(response);

    assert.equal(response.status, 500);
    assert.deepEqual(data, {
      success: false,
      error: "Internal server error"
    });
    assert.equal(
      text.includes("mongodb connection failure"),
      false
    );
    assertNoSensitiveData(text);
    assert.equal(text.includes("token"), false);
  } finally {
    console.error = originalConsoleError;
  }

  for (const entry of takeAuditEntries()) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(entry, "token"),
      false
    );
  }
});

test("a successful reset logs a safe PASSWORD_RESET_COMPLETED event", async () => {
  resetTestState();

  const response = await post("/api/auth/reset-password", {
    token: RESET_TOKEN,
    password: NEW_PASSWORD
  });

  assert.equal(response.status, 200);

  const entries = takeAuditEntries();
  const completedEvent = findAuditEvent(
    entries,
    "PASSWORD_RESET_COMPLETED"
  );

  assert.ok(completedEvent);
  assert.equal(
    completedEvent.userId,
    RESET_USER_ID.toString()
  );
  assert.equal(completedEvent.method, "POST");
  assertNoSensitiveData(JSON.stringify(completedEvent));

  for (const entry of entries) {
    assertSafeAuditEntry(entry);
  }
});

test("production wiring exposes reset-password only and keeps existing auth routes", async () => {
  const productionPasswordResetPaths = passwordResetRoutes.stack
    .filter((layer) => layer.route)
    .map(
      (layer) =>
        `${Object.keys(layer.route.methods).join(",")} ${layer.route.path}`
    );

  assert.deepEqual(productionPasswordResetPaths, [
    "post /reset-password"
  ]);

  const authRoutePaths = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);

  assert.deepEqual(authRoutePaths, [
    "/register",
    "/login",
    "/me",
    "/staff-test",
    "/admin-test"
  ]);
});

test("forgot-password is not registered in production wiring", async () => {
  const productionApp = express();
  productionApp.use(express.json({ limit: "1mb" }));
  productionApp.use("/api/auth", authRoutes);
  productionApp.use(errorHandler);

  const productionServer = http.createServer(productionApp);

  await new Promise((resolve) => {
    productionServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const productionBaseUrl = `http://127.0.0.1:${productionServer.address().port}`;
    const response = await fetch(
      `${productionBaseUrl}/api/auth/forgot-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: EXISTING_EMAIL })
      }
    );

    const text = await response.text();

    assert.equal(response.status, 404);
    assert.equal(
      text.includes(GENERIC_FORGOT_PASSWORD_MESSAGE),
      false
    );
    assert.equal(text.includes(RESET_TOKEN), false);
    assertNoSensitiveData(text);
  } finally {
    await new Promise((resolve) => {
      productionServer.close(resolve);
    });
  }
});

test("existing register, login, me, and RBAC behavior is unchanged", async () => {
  const userToken = jwt.sign(
    {
      userId: RESET_USER_ID.toString(),
      role: "user"
    },
    testJwtSecret,
    { expiresIn: "1h" }
  );

  const missingAuthentication = await get("/api/auth/me");

  assert.equal(missingAuthentication.status, 401);
  assert.deepEqual((await readJson(missingAuthentication)).data, {
    success: false,
    error: "Authentication required"
  });

  const invalidLoginBody = await post("/api/auth/login", {});

  assert.equal(invalidLoginBody.status, 400);
  assert.deepEqual((await readJson(invalidLoginBody)).data, {
    success: false,
    error: "Email and password are required"
  });

  const weakRegistration = await post("/api/auth/register", {
    name: "Stage Three User",
    email: "stage3.user@example.invalid",
    password: "short"
  });

  assert.equal(weakRegistration.status, 400);
  assert.deepEqual((await readJson(weakRegistration)).data, {
    success: false,
    error: "Password must be between 8 and 128 characters"
  });

  const deniedAdminRoute = await get("/api/auth/admin-test", {
    Authorization: `Bearer ${userToken}`
  });

  assert.equal(deniedAdminRoute.status, 403);
  assert.deepEqual((await readJson(deniedAdminRoute)).data, {
    success: false,
    error: "You do not have permission to access this resource"
  });

  const missingTokenRoute = await get("/api/auth/staff-test");

  assert.equal(missingTokenRoute.status, 401);
});

function createResetTokenResult() {
  return {
    userId: RESET_USER_ID,
    email: EXISTING_EMAIL,
    resetToken: RESET_TOKEN,
    resetTokenHash: RESET_TOKEN_HASH,
    expiresAt: new Date("2026-03-01T10:15:00.000Z")
  };
}
