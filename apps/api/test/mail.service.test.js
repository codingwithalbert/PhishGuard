const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BREVO_SMTP_EMAIL_ENDPOINT,
  MAIL_ENV_NAMES,
  MAIL_ERROR_CODES,
  MAIL_REQUEST_TIMEOUT_MS,
  MailServiceError,
  PASSWORD_RESET_EMAIL_SUBJECT,
  assertResolvedMailConfig,
  buildPasswordResetEmailText,
  resolveMailConfig,
  sendPasswordResetEmail,
  sendTransactionalEmail
} = require("../src/services/mail.service");

const TEST_API_KEY = "test-brevo-key-not-a-real-secret";
const TEST_FROM_EMAIL = "no-reply@phishguard.test";
const TEST_FROM_NAME = "PhishGuard";
const TEST_CLIENT_URL = "https://phishguard.example";
const RECIPIENT_EMAIL = "user@example.invalid";
const RESET_TOKEN = "c".repeat(64);
const RESET_TOKEN_HASH = "d".repeat(64);

const MAIL_ENV = {
  [MAIL_ENV_NAMES.apiKey]: TEST_API_KEY,
  [MAIL_ENV_NAMES.fromEmail]: TEST_FROM_EMAIL,
  [MAIL_ENV_NAMES.fromName]: TEST_FROM_NAME
};

const RESOLVED_MAIL_CONFIG = resolveMailConfig(MAIL_ENV);

const SENSITIVE_VALUES = [
  TEST_API_KEY,
  RECIPIENT_EMAIL,
  TEST_CLIENT_URL,
  RESET_TOKEN,
  RESET_TOKEN_HASH
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

test("sendTransactionalEmail constructs the expected Brevo payload", async () => {
  const fetchImpl = createFetchStub();
  const subject = "Test subject";
  const textContent = "Test body content";

  const result = await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject,
    textContent,
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  });

  assert.deepEqual(result, { delivered: true });
  assert.equal(fetchImpl.calls.length, 1);

  const [call] = fetchImpl.calls;

  assert.equal(call.url, BREVO_SMTP_EMAIL_ENDPOINT);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(call.options.headers["api-key"], TEST_API_KEY);
  assert.equal(
    call.options.headers["content-type"],
    "application/json"
  );

  const payload = JSON.parse(call.options.body);

  assert.deepEqual(payload.sender, {
    name: TEST_FROM_NAME,
    email: TEST_FROM_EMAIL
  });
  assert.deepEqual(payload.to, [{ email: RECIPIENT_EMAIL }]);
  assert.equal(payload.subject, subject);
  assert.equal(payload.textContent, textContent);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, "htmlContent"),
    false
  );
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["sender", "subject", "textContent", "to"]
  );
});

test("sendTransactionalEmail uses configured sender name and email", async () => {
  const fetchImpl = createFetchStub();

  await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject: "Subject",
    textContent: "Body",
    config: {
      apiKey: TEST_API_KEY,
      fromEmail: "custom@phishguard.test",
      fromName: "Custom Name"
    },
    fetchImpl
  });

  const payload = JSON.parse(fetchImpl.calls[0].options.body);

  assert.deepEqual(payload.sender, {
    name: "Custom Name",
    email: "custom@phishguard.test"
  });
});

test("sendTransactionalEmail uses the expected authorization header without exposing the key elsewhere", async () => {
  const fetchImpl = createFetchStub();

  await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject: "Subject",
    textContent: "Body",
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  });

  const [call] = fetchImpl.calls;

  assert.equal(call.options.headers["api-key"], TEST_API_KEY);

  const serializedCall = JSON.stringify(call);
  const keyOccurrences = serializedCall.split(TEST_API_KEY).length - 1;

  assert.equal(
    keyOccurrences,
    1,
    "API key must appear exactly once (in the api-key header)"
  );
});

test("sendTransactionalEmail rejects recipient that does not satisfy the email-shape policy", async () => {
  const invalidRecipients = [
    "",
    "not-an-email",
    "missing@domain",
    "@example.com",
    "user@",
    "user@example",
    "user @example.com",
    "user@exam ple.com",
    `${"a".repeat(250)}@example.com`
  ];

  for (const recipient of invalidRecipients) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient,
          subject: "Subject",
          textContent: "Body",
          config: RESOLVED_MAIL_CONFIG,
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
      "No provider call may be made with an invalid recipient"
    );
  }
});

test("sendTransactionalEmail rejects empty or invalid subject", async () => {
  const invalidSubjects = [
    "",
    "   ",
    42,
    null,
    undefined,
    {}
  ];

  for (const subject of invalidSubjects) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject,
          textContent: "Body",
          config: RESOLVED_MAIL_CONFIG,
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
      "No provider call may be made with an invalid subject"
    );
  }
});

test("sendTransactionalEmail rejects empty or invalid text content", async () => {
  const invalidTextContents = [
    "",
    "   ",
    42,
    null,
    undefined,
    {}
  ];

  for (const textContent of invalidTextContents) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject: "Subject",
          textContent,
          config: RESOLVED_MAIL_CONFIG,
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
      "No provider call may be made with invalid text content"
    );
  }
});

test("sendTransactionalEmail rejects missing or invalid mail configuration safely", async () => {
  const invalidConfigs = [
    undefined,
    {},
    { apiKey: "", fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY },
    { fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY, fromEmail: "not-an-email" },
    { apiKey: "   ", fromEmail: TEST_FROM_EMAIL },
    { apiKey: TEST_API_KEY, fromEmail: `${"a".repeat(250)}@example.invalid` }
  ];

  for (const config of invalidConfigs) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject: "Subject",
          textContent: "Body",
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

  const envShapedFetch = createFetchStub();

  await assert.rejects(
    () =>
      sendTransactionalEmail({
        recipient: RECIPIENT_EMAIL,
        subject: "Subject",
        textContent: "Body",
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
});

test("sendTransactionalEmail converts provider non-success response into sanitized mail error", async () => {
  for (const status of [200, 202, 204, 400, 401, 403, 429, 500, 503]) {
    const fetchImpl = createFetchStub({
      status,
      body: {
        code: "unauthorized",
        message: "Key not found",
        recipient: RECIPIENT_EMAIL
      }
    });

    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject: "Subject",
          textContent: "Body",
          config: RESOLVED_MAIL_CONFIG,
          fetchImpl
        }),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(error.code, MAIL_ERROR_CODES.DELIVERY_FAILED);
        return true;
      }
    );
  }
});

test("sendTransactionalEmail converts network failure into sanitized mail error", async () => {
  const rejectingFetch = createFetchStub({ status: "reject" });

  const rejectLines = await captureConsole(async () => {
    await assert.rejects(
      () =>
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject: "Subject",
          textContent: "Body",
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
        sendTransactionalEmail({
          recipient: RECIPIENT_EMAIL,
          subject: "Subject",
          textContent: "Body",
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

test("sendTransactionalEmail timeout behavior remains bounded", async () => {
  const fetchImpl = createFetchStub();

  await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject: "Subject",
    textContent: "Body",
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl,
    timeoutMs: 5000
  });

  const [call] = fetchImpl.calls;

  assert.ok(call.options.signal);
  assert.equal(call.options.signal.aborted, false);
});

test("sendTransactionalEmail does not expose provider response body through thrown errors", async () => {
  const providerBody = {
    code: "unauthorized",
    message: "Key not found for recipient",
    recipient: RECIPIENT_EMAIL,
    internalDetail: "sensitive provider data"
  };

  const fetchImpl = createFetchStub({
    status: 400,
    body: providerBody
  });

  const error = await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject: "Subject",
    textContent: "Body",
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  })
    .then(() => null)
    .catch((thrown) => thrown);

  assert.ok(error instanceof MailServiceError);
  assert.equal(error.code, MAIL_ERROR_CODES.DELIVERY_FAILED);

  const serialized = JSON.stringify(error);
  assert.equal(serialized.includes("unauthorized"), false);
  assert.equal(serialized.includes("Key not found"), false);
  assert.equal(serialized.includes("sensitive provider data"), false);
  assert.equal(serialized.includes(RECIPIENT_EMAIL), false);
  assert.equal(serialized.includes(TEST_API_KEY), false);
});

test("sendTransactionalEmail logs nothing", async () => {
  const successLines = await captureConsole(async () => {
    await sendTransactionalEmail({
      recipient: RECIPIENT_EMAIL,
      subject: "Subject",
      textContent: "Body",
      config: RESOLVED_MAIL_CONFIG,
      fetchImpl: createFetchStub()
    });
  });

  assert.deepEqual(successLines, []);

  const providerBody = {
    code: "unauthorized",
    message: "Key not found for recipient",
    recipient: RECIPIENT_EMAIL
  };

  const failureLines = await captureConsole(async () => {
    await sendTransactionalEmail({
      recipient: RECIPIENT_EMAIL,
      subject: "Subject",
      textContent: "Body",
      config: RESOLVED_MAIL_CONFIG,
      fetchImpl: createFetchStub({
        status: 400,
        body: providerBody
      })
    }).catch(() => undefined);
  });

  assert.deepEqual(failureLines, []);

  for (const line of failureLines) {
    assertNoSensitiveData(line, "Log line");
    assert.equal(line.includes("unauthorized"), false);
    assert.equal(line.includes("Key not found"), false);
    assert.equal(line.includes("api-key"), false);
  }
});

test("sendPasswordResetEmail produces the same Brevo payload as before the refactor", async () => {
  const fetchImpl = createFetchStub();
  const url = resetUrl();

  const result = await sendPasswordResetEmail({
    recipient: RECIPIENT_EMAIL,
    resetUrl: url,
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  });

  assert.deepEqual(result, { delivered: true });
  assert.equal(fetchImpl.calls.length, 1);

  const [call] = fetchImpl.calls;

  assert.equal(call.url, BREVO_SMTP_EMAIL_ENDPOINT);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(call.options.headers["api-key"], TEST_API_KEY);
  assert.equal(
    call.options.headers["content-type"],
    "application/json"
  );

  const payload = JSON.parse(call.options.body);

  assert.deepEqual(payload.sender, {
    name: TEST_FROM_NAME,
    email: TEST_FROM_EMAIL
  });
  assert.deepEqual(payload.to, [{ email: RECIPIENT_EMAIL }]);
  assert.equal(payload.subject, PASSWORD_RESET_EMAIL_SUBJECT);
  assert.equal(
    payload.subject,
    "Reset your PhishGuard password"
  );

  const expectedText = buildPasswordResetEmailText(url);
  assert.equal(payload.textContent, expectedText);
  assert.ok(payload.textContent.includes("PhishGuard"));
  assert.ok(payload.textContent.includes(url));
  assert.ok(payload.textContent.includes("15 minutes"));
  assert.ok(payload.textContent.includes("only be used once"));
  assert.ok(payload.textContent.toLowerCase().includes("ignore this email"));
  assert.equal(
    /password (has been|was) (changed|updated|reset)/i.test(payload.textContent),
    false
  );
  assert.equal(payload.textContent.includes("<"), false);
  assert.equal(payload.textContent.includes("http://"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, "htmlContent"),
    false
  );
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["sender", "subject", "textContent", "to"]
  );
});

test("sendPasswordResetEmail still validates resetUrl", async () => {
  const invalidUrls = [
    "",
    "   ",
    "not-a-url",
    "javascript:alert(1)",
    "ftp://phishguard.example",
    42,
    null
  ];

  for (const resetUrl of invalidUrls) {
    const fetchImpl = createFetchStub();

    await assert.rejects(
      () =>
        sendPasswordResetEmail({
          recipient: RECIPIENT_EMAIL,
          resetUrl,
          config: RESOLVED_MAIL_CONFIG,
          fetchImpl
        }),
      (error) => {
        assertSanitizedMailError(error);
        assert.equal(error.code, MAIL_ERROR_CODES.NOT_CONFIGURED);
        return true;
      }
    );

    assert.equal(fetchImpl.calls.length, 0);
  }
});

test("sendPasswordResetEmail delivery failure preserves the pre-refactor message", async () => {
  const fetchImpl = createFetchStub({ status: "reject" });

  const error = await sendPasswordResetEmail({
    recipient: RECIPIENT_EMAIL,
    resetUrl: resetUrl(),
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  })
    .then(() => null)
    .catch((thrown) => thrown);

  assertSanitizedMailError(error);
  assert.equal(error.code, MAIL_ERROR_CODES.DELIVERY_FAILED);
  assert.equal(
    error.message,
    "Password reset email could not be delivered"
  );
  assertNoSensitiveData(error.message, "Delivery error message");
});

test("sendTransactionalEmail delivery failure uses the generic message", async () => {
  const fetchImpl = createFetchStub({ status: "reject" });

  const error = await sendTransactionalEmail({
    recipient: RECIPIENT_EMAIL,
    subject: "Subject",
    textContent: "Body",
    config: RESOLVED_MAIL_CONFIG,
    fetchImpl
  })
    .then(() => null)
    .catch((thrown) => thrown);

  assertSanitizedMailError(error);
  assert.equal(error.code, MAIL_ERROR_CODES.DELIVERY_FAILED);
  assert.equal(
    error.message,
    "Transactional email could not be delivered"
  );
  assertNoSensitiveData(error.message, "Delivery error message");
});

test("MAIL_REQUEST_TIMEOUT_MS remains 10000", () => {
  assert.equal(MAIL_REQUEST_TIMEOUT_MS, 10000);
});

test("MAIL_ERROR_CODES remain unchanged", () => {
  assert.deepEqual(MAIL_ERROR_CODES, {
    NOT_CONFIGURED: "MAIL_NOT_CONFIGURED",
    DELIVERY_FAILED: "MAIL_DELIVERY_FAILED"
  });
});

test("MAIL_ENV_NAMES remain unchanged", () => {
  assert.deepEqual(MAIL_ENV_NAMES, {
    apiKey: "BREVO_API_KEY",
    fromEmail: "MAIL_FROM_EMAIL",
    fromName: "MAIL_FROM_NAME"
  });
});
