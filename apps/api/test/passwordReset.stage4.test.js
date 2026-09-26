const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

const {
  BREVO_SMTP_EMAIL_ENDPOINT,
  MAIL_ENV_NAMES,
  MAIL_ERROR_CODES,
  MailServiceError,
  PASSWORD_RESET_EMAIL_SUBJECT,
  resolveMailConfig,
  sendPasswordResetEmail
} = require("../src/services/mail.service");
const {
  PASSWORD_RESET_WORKFLOW_ERROR_CODES,
  PasswordResetWorkflowError,
  buildPasswordResetUrl,
  createForgotPasswordWorkflow
} = require("../src/services/passwordReset.workflow");
const passwordResetRoutes = require("../src/routes/passwordReset.routes");
const authRoutes = require("../src/routes/auth.routes");
const {
  authenticate
} = require("../src/middleware/auth.middleware");
const {
  forgotPasswordLimiter
} = require("../src/middleware/rateLimit.middleware");
const {
  validateForgotPasswordRequest,
  validateResetPasswordRequest
} = require("../src/middleware/passwordReset.validate.middleware");

const { createPasswordResetRouter } = passwordResetRoutes;

const TEST_API_KEY = "test-brevo-key-not-a-real-secret";
const TEST_FROM_EMAIL = "no-reply@phishguard.test";
const TEST_CLIENT_URL = "https://phishguard.example";
const EXISTING_EMAIL = "existing.user@example.invalid";
const MISSING_EMAIL = "missing.user@example.invalid";
const RESET_TOKEN = "c".repeat(64);
const RESET_TOKEN_HASH = "d".repeat(64);
const NEW_PASSWORD = "new-Password-2";
const USER_ID = new mongoose.Types.ObjectId();

// Environment-shaped configuration, as the workflow receives it.
const MAIL_ENV = {
  [MAIL_ENV_NAMES.apiKey]: TEST_API_KEY,
  [MAIL_ENV_NAMES.fromEmail]: TEST_FROM_EMAIL,
  [MAIL_ENV_NAMES.fromName]: "PhishGuard"
};

// Resolved configuration, as the mail service requires it.
const RESOLVED_MAIL_CONFIG = resolveMailConfig(MAIL_ENV);

const WORKFLOW_ENV = {
  ...MAIL_ENV,
  CLIENT_URL: TEST_CLIENT_URL
};

const SENSITIVE_VALUES = [
  TEST_API_KEY,
  RESET_TOKEN,
  RESET_TOKEN_HASH,
  NEW_PASSWORD,
  EXISTING_EMAIL,
  TEST_CLIENT_URL
];

function resetUrl() {
  return `${TEST_CLIENT_URL}/reset-password/${RESET_TOKEN}`;
}

function createFetchStub({
  status = 201,
  body = { messageId: "<20260301100000.123456@brevo>" }
} = {}) {
  const calls = [];

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (status === "reject") {
      throw new TypeError(
        "fetch failed: connection refused to api.brevo.com"
      );
    }

    return {
      status,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      }
    };
  };

  fetchImpl.calls = calls;

  return fetchImpl;
}

function assertNoSensitiveData(text, label = "value") {
  for (const sensitiveValue of SENSITIVE_VALUES) {
    assert.equal(
      text.includes(sensitiveValue),
      false,
      `${label} must not contain ${sensitiveValue.slice(0, 10)}...`
    );
  }
}

async function captureConsole(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];

  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));

  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines;
}

function assertSanitizedMailError(error) {
  assert.ok(error instanceof MailServiceError);
  assert.equal(error.name, "MailServiceError");
  assertNoSensitiveData(JSON.stringify(error), "Mail error");
  assertNoSensitiveData(error.message, "Mail error message");
  assert.equal(
    Object.prototype.hasOwnProperty.call(error, "cause"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(error, "response"),
    false
  );

  return error;
}

function createWorkflowHarness({
  prepared = null,
  prepareError = null,
  clearError = null,
  sendError = null,
  configError = null,
  urlError = null
} = {}) {
  const calls = {
    prepare: [],
    clear: [],
    send: [],
    config: []
  };

  const workflow = createForgotPasswordWorkflow({
    env: WORKFLOW_ENV,
    prepareReset: async (input) => {
      calls.prepare.push(input);

      if (prepareError) {
        throw prepareError;
      }

      return prepared;
    },
    clearResetStateIfCurrent: async (input) => {
      calls.clear.push(input);

      if (clearError) {
        throw clearError;
      }

      return true;
    },
    sendMail: async (input) => {
      calls.send.push(input);

      if (sendError) {
        throw sendError;
      }

      return { delivered: true };
    },
    resolveConfig: (env) => {
      calls.config.push(env);

      if (configError) {
        throw configError;
      }

      return resolveMailConfig(env);
    },
    buildResetUrl: (input) => {
      if (urlError) {
        throw urlError;
      }

      return buildPasswordResetUrl(input);
    }
  });

  return { calls, workflow };
}

function createPreparedAccount(overrides = {}) {
  return {
    userId: USER_ID,
    email: EXISTING_EMAIL,
    resetToken: RESET_TOKEN,
    resetTokenHash: RESET_TOKEN_HASH,
    ...overrides
  };
}

test("the reset email is sent to Brevo with the documented contract", async () => {
  const fetchImpl = createFetchStub();

  const result = await sendPasswordResetEmail({
    recipient: EXISTING_EMAIL,
    resetUrl: resetUrl(),
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  });

  assert.deepEqual(result, { delivered: true });
  assert.equal(fetchImpl.calls.length, 1);

  const [call] = fetchImpl.calls;

  assert.equal(call.url, BREVO_SMTP_EMAIL_ENDPOINT);
  assert.equal(
    call.url,
    "https://api.brevo.com/v3/smtp/email"
  );
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(call.options.headers["api-key"], TEST_API_KEY);
  assert.equal(
    call.options.headers["content-type"],
    "application/json"
  );

  const payload = JSON.parse(call.options.body);

  assert.deepEqual(payload.sender, {
    name: "PhishGuard",
    email: TEST_FROM_EMAIL
  });
  assert.deepEqual(payload.to, [{ email: EXISTING_EMAIL }]);
  assert.equal(payload.subject, PASSWORD_RESET_EMAIL_SUBJECT);
  assert.equal(
    payload.subject,
    "Reset your PhishGuard password"
  );

  // Exactly one body field is sent, matching the accepted Brevo request.
  assert.equal(typeof payload.textContent, "string");
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, "htmlContent"),
    false
  );
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["sender", "subject", "textContent", "to"]
  );

  const content = payload.textContent;

  assert.ok(content.includes("PhishGuard"));
  assert.ok(content.includes(resetUrl()));
  assert.ok(content.includes("15 minutes"));
  assert.ok(content.includes("only be used once"));
  assert.ok(content.toLowerCase().includes("ignore this email"));
  assert.equal(
    /password (has been|was) (changed|updated|reset)/i.test(content),
    false
  );
  assert.equal(content.includes("<"), false);
  assert.equal(content.includes("http://"), false);
});

test("the sender name falls back to PhishGuard when unset", async () => {
  const fetchImpl = createFetchStub();

  await sendPasswordResetEmail({
    recipient: EXISTING_EMAIL,
    resetUrl: resetUrl(),
    config: {
      apiKey: TEST_API_KEY,
      fromEmail: TEST_FROM_EMAIL
    },
    fetchImpl
  });

  const payload = JSON.parse(fetchImpl.calls[0].options.body);

  assert.equal(payload.sender.name, "PhishGuard");
});

test("only the documented Brevo success status counts as delivered", async () => {
  for (const status of [200, 202, 204, 400, 401, 403, 429, 500, 503]) {
    const fetchImpl = createFetchStub({
      status,
      body: {
        code: "unauthorized",
        message: "Key not found",
        recipient: EXISTING_EMAIL
      }
    });

    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config: RESOLVED_MAIL_CONFIG,
          fetchImpl
        }),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(
          error.code,
          MAIL_ERROR_CODES.DELIVERY_FAILED
        );
        return true;
      }
    );
  }
});

test("network failures and timeouts are sanitized and never logged", async () => {
  const rejectingFetch = createFetchStub({ status: "reject" });

  const rejectLines = await captureConsole(async () => {
    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config: RESOLVED_MAIL_CONFIG,
          fetchImpl: rejectingFetch
        }),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(error.code, MAIL_ERROR_CODES.DELIVERY_FAILED);
        assert.equal(
          error.message.includes("connection refused"),
          false
        );
        return true;
      }
    );
  });

  assert.deepEqual(rejectLines, []);

  const missingResponseLines = await captureConsole(async () => {
    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config: RESOLVED_MAIL_CONFIG,
          fetchImpl: async () => undefined
        }),
      (error) => {
        assertSanitizedMailError(error);
        return true;
      }
    );
  });

  assert.deepEqual(missingResponseLines, []);
});
test("missing or invalid mail configuration fails safely", async () => {
  // The send boundary accepts only resolved configuration.
  const invalidResolvedConfigs = [
    undefined,
    {},
    { apiKey: "", fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY },
    { fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY, fromEmail: "not-an-email" },
    { apiKey: "   ", fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY, fromEmail: `${"a".repeat(250)}@example.invalid` }
  ];

  for (const config of invalidResolvedConfigs) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config,
          fetchImpl
        }),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(error.code, MAIL_ERROR_CODES.NOT_CONFIGURED);
        return true;
      }
    );

    assert.equal(
      fetchImpl.calls.length,
      0,
      "No provider call may be made without valid configuration"
    );
  }

  // An environment-shaped object is not accepted at the send boundary: the
  // caller owns the environment lookup.
  const envShapedFetch = createFetchStub();

  await assert.rejects(
    () =>
      sendPasswordResetEmail({
        recipient: EXISTING_EMAIL,
        resetUrl: resetUrl(),
        config: MAIL_ENV,
        fetchImpl: envShapedFetch
      }),
    (error) => {
      assertSanitizedMailError(error);
      assert.equal(error.code, MAIL_ERROR_CODES.NOT_CONFIGURED);
      return true;
    }
  );

  assert.equal(envShapedFetch.calls.length, 0);

  // The environment boundary rejects the same misconfigurations.
  const invalidEnvironments = [
    {},
    { [MAIL_ENV_NAMES.apiKey]: "" },
    { [MAIL_ENV_NAMES.fromEmail]: TEST_FROM_EMAIL },
    { [MAIL_ENV_NAMES.apiKey]: TEST_API_KEY },
    {
      [MAIL_ENV_NAMES.apiKey]: TEST_API_KEY,
      [MAIL_ENV_NAMES.fromEmail]: "not-an-email"
    },
    {
      [MAIL_ENV_NAMES.apiKey]: "   ",
      [MAIL_ENV_NAMES.fromEmail]: TEST_FROM_EMAIL
    }
  ];

  for (const env of invalidEnvironments) {
    assert.throws(
      () => resolveMailConfig(env),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(error.code, MAIL_ERROR_CODES.NOT_CONFIGURED);
        return true;
      }
    );
  }

  assert.deepEqual(RESOLVED_MAIL_CONFIG, {
    apiKey: TEST_API_KEY,
    fromEmail: TEST_FROM_EMAIL,
    fromName: "PhishGuard"
  });

  assert.equal(MAIL_ENV_NAMES.apiKey, "BREVO_API_KEY");
  assert.equal(MAIL_ENV_NAMES.fromEmail, "MAIL_FROM_EMAIL");
  assert.equal(MAIL_ENV_NAMES.fromName, "MAIL_FROM_NAME");
});

test("the workflow resolves the environment once and sends the resolved config", async () => {
  const fetchImpl = createFetchStub();
  const clearCalls = [];
  let capturedConfig = null;
  const prepared = createPreparedAccount();

  // Production composition, with only the transport injected.
  const workflow = createForgotPasswordWorkflow({
    env: WORKFLOW_ENV,
    prepareReset: async () => prepared,
    clearResetStateIfCurrent: async (input) => {
      clearCalls.push(input);
      return true;
    },
    resolveConfig: (env) => resolveMailConfig(env),
    sendMail: async (input) => {
      capturedConfig = input.config;
      return sendPasswordResetEmail({
        ...input,
        fetchImpl
      });
    }
  });

  const result = await workflow({ email: EXISTING_EMAIL });

  assert.equal(result, null);

  // The resolved object crosses the boundary unchanged, and it is not an
  // environment-shaped object that would need a second lookup.
  assert.deepEqual(capturedConfig, {
    apiKey: TEST_API_KEY,
    fromEmail: TEST_FROM_EMAIL,
    fromName: "PhishGuard"
  });
  assert.deepEqual(Object.keys(capturedConfig).sort(), [
    "apiKey",
    "fromEmail",
    "fromName"
  ]);
  assert.equal(MAIL_ENV_NAMES.apiKey in capturedConfig, false);

  // The request therefore reaches the provider with the exact contract.
  assert.equal(fetchImpl.calls.length, 1);

  const [call] = fetchImpl.calls;

  assert.equal(call.url, BREVO_SMTP_EMAIL_ENDPOINT);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers["api-key"], TEST_API_KEY);
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(
    call.options.headers["content-type"],
    "application/json"
  );

  const payload = JSON.parse(call.options.body);

  assert.deepEqual(payload.sender, {
    name: "PhishGuard",
    email: TEST_FROM_EMAIL
  });
  assert.deepEqual(payload.to, [{ email: EXISTING_EMAIL }]);
  assert.equal(
    payload.subject,
    "Reset your PhishGuard password"
  );
  assert.ok(payload.textContent.includes(resetUrl()));
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, "htmlContent"),
    false
  );

  // A delivered link leaves its reset state active.
  assert.equal(clearCalls.length, 0);
});

test("the mail service never logs payloads, keys, recipients, or URLs", async () => {
  const successLines = await captureConsole(async () => {
    await sendPasswordResetEmail({
      recipient: EXISTING_EMAIL,
      resetUrl: resetUrl(),
      config: RESOLVED_MAIL_CONFIG,
      fetchImpl: createFetchStub()
    });
  });

  assert.deepEqual(successLines, []);

  const providerBody = {
    code: "unauthorized",
    message: "Key not found for recipient",
    recipient: EXISTING_EMAIL
  };

  const failureLines = await captureConsole(async () => {
    await sendPasswordResetEmail({
      recipient: EXISTING_EMAIL,
      resetUrl: resetUrl(),
      config: RESOLVED_MAIL_CONFIG,
      fetchImpl: createFetchStub({
        status: 400,
        body: providerBody
      })
    }).catch(() => undefined);
  });

  // A rejected send logs nothing at all: no status, no provider content, and no
  // secret, recipient, reset link, token, or configuration value.
  assert.deepEqual(failureLines, []);

  for (const line of failureLines) {
    assertNoSensitiveData(line, "Log line");
    assert.equal(line.includes("unauthorized"), false);
    assert.equal(line.includes("Key not found"), false);
    assert.equal(line.includes("api-key"), false);
  }
});

test("configuration failures are sanitized and never logged", async () => {
  const lines = await captureConsole(async () => {
    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config: { apiKey: "", fromEmail: TEST_FROM_EMAIL },
          fetchImpl: createFetchStub()
        }),
      (error) => {
        assertSanitizedMailError(error);
        return true;
      }
    );

    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: EXISTING_EMAIL,
          resetUrl: resetUrl(),
          config: MAIL_ENV,
          fetchImpl: createFetchStub()
        }),
      (error) => {
        assertSanitizedMailError(error);
        return true;
      }
    );
  });

  assert.deepEqual(lines, []);
});

test("the reset URL is built safely from CLIENT_URL and the raw token", () => {
  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "https://phishguard.example",
      resetToken: RESET_TOKEN
    }),
    `https://phishguard.example/reset-password/${RESET_TOKEN}`
  );

  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "https://phishguard.example/",
      resetToken: RESET_TOKEN
    }),
    `https://phishguard.example/reset-password/${RESET_TOKEN}`
  );

  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "https://phishguard.example///",
      resetToken: RESET_TOKEN
    }),
    `https://phishguard.example/reset-password/${RESET_TOKEN}`
  );

  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "http://localhost:5173/app/",
      resetToken: RESET_TOKEN
    }),
    `http://localhost:5173/app/reset-password/${RESET_TOKEN}`
  );

  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "  https://phishguard.example  ",
      resetToken: RESET_TOKEN
    }),
    `https://phishguard.example/reset-password/${RESET_TOKEN}`
  );

  assert.equal(
    buildPasswordResetUrl({
      clientUrl: "https://phishguard.example",
      resetToken: "token/with spaces&and?chars"
    }),
    "https://phishguard.example/reset-password/token%2Fwith%20spaces%26and%3Fchars"
  );
});

test("invalid reset link configuration is rejected safely", () => {
  const invalidInputs = [
    {},
    { clientUrl: TEST_CLIENT_URL },
    { resetToken: RESET_TOKEN },
    { clientUrl: "", resetToken: RESET_TOKEN },
    { clientUrl: "   ", resetToken: RESET_TOKEN },
    { clientUrl: "not-a-url", resetToken: RESET_TOKEN },
    { clientUrl: "javascript:alert(1)", resetToken: RESET_TOKEN },
    { clientUrl: "ftp://phishguard.example", resetToken: RESET_TOKEN },
    { clientUrl: 42, resetToken: RESET_TOKEN },
    { clientUrl: TEST_CLIENT_URL, resetToken: "" },
    { clientUrl: TEST_CLIENT_URL, resetToken: null }
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => buildPasswordResetUrl(input),
      (error) => {
        assert.ok(error instanceof PasswordResetWorkflowError);
        assert.equal(
          error.code,
          PASSWORD_RESET_WORKFLOW_ERROR_CODES.INVALID_LINK_CONFIGURATION
        );
        assertNoSensitiveData(
          JSON.stringify(error),
          "Reset link error"
        );
        return true;
      }
    );
  }
});

test("a nonexistent account triggers no mail call and no reset state", async () => {
  const harness = createWorkflowHarness({ prepared: null });

  const result = await harness.workflow({
    email: MISSING_EMAIL
  });

  assert.equal(result, null);
  assert.equal(harness.calls.prepare.length, 1);
  assert.equal(harness.calls.prepare[0].email, MISSING_EMAIL);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.clear.length, 0);
});

test("an existing account prepares reset state and sends exactly one email", async () => {
  const prepared = createPreparedAccount();
  const harness = createWorkflowHarness({ prepared });

  const result = await harness.workflow({ email: EXISTING_EMAIL });

  assert.equal(result, null);
  assert.deepEqual(harness.calls.prepare, [
    { email: EXISTING_EMAIL }
  ]);
  assert.equal(harness.calls.send.length, 1);
  assert.deepEqual(harness.calls.send[0], {
    recipient: EXISTING_EMAIL,
    resetUrl: resetUrl(),
    config: {
      apiKey: TEST_API_KEY,
      fromEmail: TEST_FROM_EMAIL,
      fromName: "PhishGuard"
    }
  });

  // A delivered link keeps its reset state active.
  assert.equal(harness.calls.clear.length, 0);
});

test("the raw token is passed only to reset-link construction", async () => {
  const prepared = createPreparedAccount();
  const urlInputs = [];
  const harness = createWorkflowHarness({ prepared });

  const workflow = createForgotPasswordWorkflow({
    env: WORKFLOW_ENV,
    prepareReset: async () => prepared,
    clearResetStateIfCurrent: async () => true,
    sendMail: async () => ({ delivered: true }),
    resolveConfig: (env) => resolveMailConfig(env),
    buildResetUrl: (input) => {
      urlInputs.push(input);
      return buildPasswordResetUrl(input);
    }
  });

  await workflow({ email: EXISTING_EMAIL });

  assert.equal(urlInputs.length, 1);
  assert.deepEqual(urlInputs[0], {
    clientUrl: TEST_CLIENT_URL,
    resetToken: RESET_TOKEN
  });

  const sentPayload = JSON.stringify(harness.calls.send);
  assert.equal(sentPayload.includes(RESET_TOKEN_HASH), false);
  assert.equal(
    sentPayload.includes("\"resetTokenHash\""),
    false
  );
});

test("a failed delivery clears only its own request state and stays sanitized", async () => {
  const prepared = createPreparedAccount();
  const providerError = new Error(
    `Brevo rejected the message for ${EXISTING_EMAIL} with key ${TEST_API_KEY}`
  );
  const harness = createWorkflowHarness({
    prepared,
    sendError: providerError
  });

  const error = await harness.workflow({ email: EXISTING_EMAIL })
    .then(() => null)
    .catch((thrown) => thrown);

  assert.ok(error instanceof PasswordResetWorkflowError);
  assert.equal(error.name, "PasswordResetWorkflowError");
  assert.equal(
    error.code,
    PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_DELIVERY_FAILED
  );
  assertNoSensitiveData(JSON.stringify(error), "Workflow error");
  assertNoSensitiveData(error.message, "Workflow error message");

  assert.equal(harness.calls.clear.length, 1);
  assert.deepEqual(harness.calls.clear[0], {
    userId: USER_ID,
    resetTokenHash: RESET_TOKEN_HASH
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.calls.clear[0],
      "resetToken"
    ),
    false
  );
});

test("a late failure of an older request cannot clear a newer reset request", async () => {
  const older = createPreparedAccount();
  const newer = createPreparedAccount({
    userId: new mongoose.Types.ObjectId(),
    resetToken: "e".repeat(64),
    resetTokenHash: "f".repeat(64)
  });

  // Minimal model of the Stage 2 stored state and its conditional cleanup.
  const store = { hash: null };
  const clearCalls = [];
  let prepared = null;
  let failSend = true;
  let preparesState = true;

  const workflow = createForgotPasswordWorkflow({
    env: WORKFLOW_ENV,
    prepareReset: async () => {
      if (preparesState) {
        store.hash = prepared.resetTokenHash;
      }

      return prepared;
    },
    clearResetStateIfCurrent: async ({ userId, resetTokenHash }) => {
      clearCalls.push({ userId, resetTokenHash });

      if (store.hash !== resetTokenHash) {
        return false;
      }

      store.hash = null;
      return true;
    },
    sendMail: async () => {
      if (failSend) {
        throw new Error("provider unavailable");
      }

      return { delivered: true };
    },
    resolveConfig: (env) => resolveMailConfig(env)
  });

  // The first request fails and clears exactly its own state.
  prepared = older;

  await assert.rejects(() => workflow({ email: EXISTING_EMAIL }));

  assert.equal(store.hash, null);
  assert.equal(clearCalls.length, 1);

  // A newer request becomes the only outstanding reset state.
  failSend = false;
  prepared = newer;

  await workflow({ email: EXISTING_EMAIL });

  assert.equal(store.hash, newer.resetTokenHash);

  // The older request's delivery now fails late, after its own preparation
  // already happened and a newer request replaced its reset state.
  failSend = true;
  preparesState = false;
  prepared = older;

  await assert.rejects(() => workflow({ email: EXISTING_EMAIL }));

  assert.equal(clearCalls.length, 2);
  assert.deepEqual(clearCalls[1], {
    userId: older.userId,
    resetTokenHash: older.resetTokenHash
  });
  assert.equal(
    store.hash,
    newer.resetTokenHash,
    "A newer reset request must survive an older failed delivery"
  );
});

test("a failed conditional cleanup is attempted once and stays sanitized", async () => {
  const prepared = createPreparedAccount();
  const databaseError = new Error(
    `cleanup failed for ${EXISTING_EMAIL} hash ${RESET_TOKEN_HASH}`
  );
  const harness = createWorkflowHarness({
    prepared,
    sendError: new Error("provider unavailable"),
    clearError: databaseError
  });

  const error = await harness.workflow({ email: EXISTING_EMAIL })
    .then(() => null)
    .catch((thrown) => thrown);

  // The original sanitized workflow error is preserved: the database failure
  // never replaces it and never reaches the controller.
  assert.ok(error instanceof PasswordResetWorkflowError);
  assert.equal(error.name, "PasswordResetWorkflowError");
  assert.equal(
    error.code,
    PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_DELIVERY_FAILED
  );
  assert.equal(
    error.message,
    "Password reset email could not be delivered"
  );
  assert.equal(
    error.message.includes("cleanup failed"),
    false
  );
  assertNoSensitiveData(JSON.stringify(error), "Workflow error");
  assertNoSensitiveData(error.message, "Workflow error message");

  // Exactly one conditional attempt, with no retry and no unconditional
  // cleanup. Residual risk: the stored hash may remain valid until its normal
  // 15-minute expiration, so the state cannot be reported as cleared.
  assert.equal(harness.calls.clear.length, 1);
  assert.deepEqual(harness.calls.clear[0], {
    userId: USER_ID,
    resetTokenHash: RESET_TOKEN_HASH
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.calls.clear[0],
      "resetToken"
    ),
    false,
    "Cleanup must never receive the raw reset token"
  );

  // No sensitive information is logged or exposed anywhere on this path.
  const lines = await captureConsole(async () => {
    await harness
      .workflow({ email: EXISTING_EMAIL })
      .catch(() => undefined);
  });

  assert.deepEqual(lines, []);
});

test("a reset link misconfiguration also clears its own request state", async () => {
  const prepared = createPreparedAccount();
  const harness = createWorkflowHarness({
    prepared,
    urlError: new Error(
      "reset link configuration missing"
    )
  });

  const error = await harness.workflow({ email: EXISTING_EMAIL })
    .then(() => null)
    .catch((thrown) => thrown);

  assert.equal(
    error.code,
    PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_DELIVERY_FAILED
  );
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.clear.length, 1);
  assert.deepEqual(harness.calls.clear[0], {
    userId: USER_ID,
    resetTokenHash: RESET_TOKEN_HASH
  });
});

test("missing mail configuration fails before any reset state is created", async () => {
  const harness = createWorkflowHarness({
    prepared: createPreparedAccount(),
    configError: new Error("mail not configured")
  });

  const error = await harness.workflow({ email: EXISTING_EMAIL })
    .then(() => null)
    .catch((thrown) => thrown);

  assert.ok(error instanceof PasswordResetWorkflowError);
  assert.equal(
    error.code,
    PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_CONFIGURATION
  );
  assertNoSensitiveData(JSON.stringify(error), "Workflow error");
  assert.equal(harness.calls.prepare.length, 0);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.clear.length, 0);
});

test("the production workflow fails safely without mail configuration", async () => {
  const { forgotPasswordWorkflow } = require("../src/services/passwordReset.workflow");

  // The default workflow reads real process.env, which defines no mail
  // settings in this test process.
  const error = await forgotPasswordWorkflow({
    email: EXISTING_EMAIL
  })
    .then(() => null)
    .catch((thrown) => thrown);

  assert.ok(error instanceof PasswordResetWorkflowError);
  assert.equal(
    error.code,
    PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_CONFIGURATION
  );
  assertNoSensitiveData(JSON.stringify(error), "Workflow error");
});

test("the workflow itself logs nothing", async () => {
  const harness = createWorkflowHarness({
    prepared: createPreparedAccount(),
    sendError: new Error("provider unavailable")
  });

  const lines = await captureConsole(async () => {
    await harness
      .workflow({ email: EXISTING_EMAIL })
      .catch(() => undefined);
  });

  assert.deepEqual(lines, []);
});

test("production routing registers both endpoints in the required order", () => {
  const routes = passwordResetRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map(
        (entry) => entry.handle
      )
    }));

  const forgotRoute = routes.find(
    (route) => route.path === "/forgot-password"
  );
  const resetRoute = routes.find(
    (route) => route.path === "/reset-password"
  );

  assert.ok(forgotRoute);
  assert.ok(resetRoute);
  assert.deepEqual(forgotRoute.methods, ["post"]);
  assert.deepEqual(resetRoute.methods, ["post"]);

  assert.equal(forgotRoute.handlers.length, 3);
  assert.equal(
    forgotRoute.handlers[0],
    forgotPasswordLimiter
  );
  assert.equal(
    forgotRoute.handlers[1],
    validateForgotPasswordRequest
  );
  assert.equal(
    forgotRoute.handlers[2].name,
    "forgotPassword"
  );

  assert.equal(resetRoute.handlers.length, 2);
  assert.equal(
    resetRoute.handlers[0],
    validateResetPasswordRequest
  );
  assert.equal(
    resetRoute.handlers[1].name,
    "resetPassword"
  );

  for (const route of [forgotRoute, resetRoute]) {
    assert.equal(
      route.handlers.includes(authenticate),
      false,
      "Password reset endpoints must not require authentication"
    );
  }
});

test("existing auth routes remain unchanged after Stage 4 wiring", () => {
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

test("HTTP contract stays identical for existing, missing, and failed workflows", async () => {
  const workflowCalls = [];
  let workflowError = null;
  let preparedExists = true;

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api/auth",
    createPasswordResetRouter({
      service: {
        async completePasswordReset() {
          return { userId: USER_ID };
        }
      },
      forgotPasswordWorkflow: async ({ email }) => {
        workflowCalls.push(email);

        if (workflowError) {
          throw workflowError;
        }

        return preparedExists && email === EXISTING_EMAIL
          ? createPreparedAccount()
          : null;
      },
      forgotPasswordRateLimiter: (req, res, next) => next()
    })
  );
  app.use("/api/auth", authRoutes);

  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const post = async (email) => {
    const response = await fetch(
      `${baseUrl}/api/auth/forgot-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      }
    );

    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      text: await response.text()
    };
  };

  try {
    const existing = await post(EXISTING_EMAIL);

    preparedExists = false;
    const missing = await post(MISSING_EMAIL);

    workflowError = new Error(
      `delivery failed for ${EXISTING_EMAIL}`
    );
    const failed = await post(EXISTING_EMAIL);

    assert.equal(existing.status, 200);
    assert.equal(existing.cacheControl, "no-store");
    assert.deepEqual(JSON.parse(existing.text), {
      success: true,
      message:
        "If an account exists for that email, a password reset link has been sent."
    });
    assert.equal(missing.status, existing.status);
    assert.equal(missing.text, existing.text);
    assert.equal(failed.status, existing.status);
    assert.equal(failed.text, existing.text);
    assert.deepEqual(workflowCalls, [
      EXISTING_EMAIL,
      MISSING_EMAIL,
      EXISTING_EMAIL
    ]);

    for (const response of [existing, missing, failed]) {
      assertNoSensitiveData(response.text, "Response body");
      assert.equal(
        response.text.includes("messageId"),
        false
      );
      assert.equal(
        response.text.includes("token"),
        false
      );
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});
