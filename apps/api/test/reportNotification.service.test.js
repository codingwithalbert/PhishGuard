const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReportNotificationService
} = require("../src/services/reportNotification.service");
const {
  MAIL_ENV_NAMES,
  MAIL_ERROR_CODES,
  MailServiceError,
  resolveMailConfig
} = require("../src/services/mail.service");

const TEST_API_KEY = "test-brevo-key-not-a-real-secret";
const TEST_FROM_EMAIL = "no-reply@phishguard.test";
const TEST_CLIENT_URL = "https://phishguard.example";
const RECIPIENT_EMAIL = "student@example.invalid";
const STAFF_EMAIL = "staff@example.invalid";
const TICKET_NUMBER = "PG-2026-000123";
const SUSPICIOUS_URL = "https://suspicious.example.com/login";
const REPORT_ID = "64b7f8e2a1b2c3d4e5f6a7b8";
const OWNER_ID = "64b7f8e2a1b2c3d4e5f6a7b9";
const STAFF_ID = "64b7f8e2a1b2c3d4e5f6a7c0";

const MAIL_ENV = {
  [MAIL_ENV_NAMES.apiKey]: TEST_API_KEY,
  [MAIL_ENV_NAMES.fromEmail]: TEST_FROM_EMAIL,
  [MAIL_ENV_NAMES.fromName]: "PhishGuard",
  CLIENT_URL: TEST_CLIENT_URL
};

const SENSITIVE_VALUES = [
  TEST_API_KEY,
  RECIPIENT_EMAIL,
  STAFF_EMAIL,
  SUSPICIOUS_URL,
  TICKET_NUMBER,
  REPORT_ID,
  OWNER_ID,
  STAFF_ID
];

function createReportModel(reportData) {
  return {
    findById: (id) => ({
      select: () => ({
        lean: async () =>
          reportData ? { _id: id, ...reportData } : null
      })
    })
  };
}

function createUserModel(userData) {
  return {
    findById: (id) => ({
      select: () => ({
        lean: async () => (userData ? { _id: id, ...userData } : null)
      })
    })
  };
}

function createService({
  sendMail = async () => ({ delivered: true }),
  reportModel = null,
  userModel = null,
  resolveConfig = () => resolveMailConfig(MAIL_ENV),
  env = MAIL_ENV
} = {}) {
  return createReportNotificationService({
    sendMail,
    resolveConfig,
    reportModel,
    userModel,
    env
  });
}

function createFullReportModel() {
  return createReportModel({
    ticketNumber: TICKET_NUMBER,
    user: OWNER_ID,
    analysisSnapshot: {
      url: SUSPICIOUS_URL,
      risk: "high",
      score: 75,
      indicators: ["URL uses an IP address instead of a domain name"]
    },
    reason: "suspected_phishing",
    details: "I received this link in a message claiming to be from the school.",
    status: "submitted",
    priority: "normal",
    assignedTo: STAFF_ID,
    assessment: "pending",
    reviewerNote: null
  });
}

function createFullUserModel() {
  return createUserModel({
    email: RECIPIENT_EMAIL,
    isActive: true,
    name: "Student Name",
    role: "user"
  });
}

async function captureConsole(run) {
  const originalLog = console.log;
  const lines = [];

  console.log = (...args) => lines.push(args.join(" "));

  try {
    await run();
  } finally {
    console.log = originalLog;
  }

  return lines;
}

function assertNoSensitiveData(text, label = "value") {
  for (const sensitiveValue of SENSITIVE_VALUES) {
    assert.equal(
      text.includes(sensitiveValue),
      false,
      `${label} must not contain sensitive value`
    );
  }
}

test("recipient is resolved from Report.user -> User.email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].recipient, RECIPIENT_EMAIL);
});

test("caller cannot supply or override recipient", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message",
    recipient: "attacker@evil.com",
    email: "attacker@evil.com",
    to: "attacker@evil.com"
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].recipient, RECIPIENT_EMAIL);
  assert.equal(sendCalls[0].recipient.includes("attacker"), false);
});

test("message subject and body exactly match the frozen template", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  assert.equal(sendCalls.length, 1);
  assert.equal(
    sendCalls[0].subject,
    "New message on your PhishGuard report"
  );

  const expectedBody = [
    "Hello,",
    "",
    `A PhishGuard staff member has sent a new message on your report ${TICKET_NUMBER}.`,
    "",
    "Sign in to PhishGuard to view the message and respond if needed.",
    "",
    TEST_CLIENT_URL,
    "",
    "Automated message from PhishGuard. Please do not reply."
  ].join("\n");

  assert.equal(sendCalls[0].textContent, expectedBody);
});

test("completion subject and body exactly match the frozen template", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "completion" });

  assert.equal(sendCalls.length, 1);
  assert.equal(
    sendCalls[0].subject,
    "Your PhishGuard report has been completed"
  );

  const expectedBody = [
    "Hello,",
    "",
    `Your PhishGuard report ${TICKET_NUMBER} has been completed by the IT team.`,
    "",
    "Sign in to PhishGuard to view the completed report.",
    "",
    TEST_CLIENT_URL,
    "",
    "Automated message from PhishGuard. Please do not reply."
  ].join("\n");

  assert.equal(sendCalls[0].textContent, expectedBody);
});

test("only ticketNumber and CLIENT_URL are dynamically interpolated", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const body = sendCalls[0].textContent;

  assert.ok(body.includes(TICKET_NUMBER));
  assert.ok(body.includes(TEST_CLIENT_URL));
  assert.equal(body.includes(SUSPICIOUS_URL), false);
  assert.equal(body.includes("Student Name"), false);
  assert.equal(body.includes(STAFF_EMAIL), false);
});

test("suspicious/analyzed URL is absent from email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes(SUSPICIOUS_URL), false);
});

test("report reason/details/free text are absent from email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes("suspected_phishing"), false);
  assert.equal(payload.includes("I received this link"), false);
});

test("reviewer note and assessment are absent from email", async () => {
  const sendCalls = [];
  const reportModel = createReportModel({
    ticketNumber: TICKET_NUMBER,
    user: OWNER_ID,
    assessment: "phishing",
    reviewerNote: "This is a phishing attempt."
  });
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel,
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "completion" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes("phishing"), false);
  assert.equal(payload.includes("This is a phishing attempt"), false);
});

test("report message content is absent from email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes("message content"), false);
  assert.equal(payload.includes("Can you confirm"), false);
});

test("internal Mongo ObjectIds are absent from email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes(REPORT_ID), false);
  assert.equal(payload.includes(OWNER_ID), false);
  assert.equal(payload.includes(STAFF_ID), false);
});

test("student/staff names are absent from email", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes("Student Name"), false);
  assert.equal(payload.includes("Staff"), false);
});

test("owner missing returns owner_not_found", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createReportModel(null),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "owner_not_found" });
  assert.equal(sendCalls.length, 0);
});

test("owner user document missing returns owner_not_found", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createUserModel(null)
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "owner_not_found" });
  assert.equal(sendCalls.length, 0);
});

test("inactive owner returns owner_inactive", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createUserModel({
      email: RECIPIENT_EMAIL,
      isActive: false,
      name: "Student Name"
    })
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "owner_inactive" });
  assert.equal(sendCalls.length, 0);
});

test("invalid owner email returns owner_email_invalid", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createUserModel({
      email: "not-an-email",
      isActive: true,
      name: "Student Name"
    })
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "owner_email_invalid" });
  assert.equal(sendCalls.length, 0);
});

test("missing/invalid mail config returns not_configured and no provider send", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel(),
    resolveConfig: () => {
      throw new MailServiceError(
        MAIL_ERROR_CODES.NOT_CONFIGURED,
        "Transactional mail is not configured"
      );
    }
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "not_configured" });
  assert.equal(sendCalls.length, 0);
});

test("delivery/provider/network failure returns delivery_failed", async () => {
  const service = createService({
    sendMail: async () => {
      throw new MailServiceError(
        MAIL_ERROR_CODES.DELIVERY_FAILED,
        "Transactional email could not be delivered"
      );
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "delivery_failed" });
});

test("success returns exactly { sent: true }", async () => {
  const service = createService({
    sendMail: async () => ({ delivered: true }),
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(Object.keys(result).length, 1);
});

test("failure/skip outcomes contain only sent + fixed reason", async () => {
  const testCases = [
    { reason: "owner_not_found", reportData: null, userData: null },
    { reason: "owner_inactive", reportData: { ticketNumber: TICKET_NUMBER, user: OWNER_ID }, userData: { email: RECIPIENT_EMAIL, isActive: false } },
    { reason: "owner_email_invalid", reportData: { ticketNumber: TICKET_NUMBER, user: OWNER_ID }, userData: { email: "bad", isActive: true } }
  ];

  for (const testCase of testCases) {
    const service = createService({
      sendMail: async () => ({ delivered: true }),
      reportModel: createReportModel(testCase.reportData),
      userModel: createUserModel(testCase.userData)
    });

    const result = await service({
      reportId: REPORT_ID,
      notificationType: "message"
    });

    assert.deepEqual(result, { sent: false, reason: testCase.reason });
    assert.equal(Object.keys(result).length, 2);
    assert.ok("sent" in result);
    assert.ok("reason" in result);
  }
});

test("service never exposes recipient/provider body/raw exception", async () => {
  const service = createService({
    sendMail: async () => {
      throw new Error(`Provider error for ${RECIPIENT_EMAIL} with key ${TEST_API_KEY}`);
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "delivery_failed" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "delivery_failed");
  assert.equal(JSON.stringify(result).includes(RECIPIENT_EMAIL), false);
  assert.equal(JSON.stringify(result).includes(TEST_API_KEY), false);
});

test("safe logs contain only approved fields and no sensitive content", async () => {
  const lines = await captureConsole(async () => {
    const service = createService({
      sendMail: async () => ({ delivered: true }),
      reportModel: createFullReportModel(),
      userModel: createFullUserModel()
    });

    await service({ reportId: REPORT_ID, notificationType: "message" });
  });

  const notificationLines = lines.filter((line) =>
    line.includes("[REPORT_NOTIFICATION]")
  );

  assert.ok(notificationLines.length > 0);

  for (const line of notificationLines) {
    assert.ok(line.includes("REPORT_NOTIFICATION_SENT"));
    assert.ok(line.includes(REPORT_ID));
    assert.ok(line.includes("message"));
    assert.equal(line.includes(RECIPIENT_EMAIL), false);
    assert.equal(line.includes(TEST_API_KEY), false);
    assert.equal(line.includes(SUSPICIOUS_URL), false);
    assert.equal(line.includes("New message"), false);
  }
});

test("unsupported notification type cannot produce arbitrary email/content", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "arbitrary_template",
    subject: "Custom subject",
    body: "Custom body"
  });

  assert.deepEqual(result, { sent: false, reason: "delivery_failed" });
  assert.equal(sendCalls.length, 0);
});

test("no direct Brevo/fetch implementation exists; delegates to sendTransactionalEmail", async () => {
  const sendCalls = [];
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "message" });

  assert.equal(sendCalls.length, 1);
  assert.equal(typeof sendCalls[0].recipient, "string");
  assert.equal(typeof sendCalls[0].subject, "string");
  assert.equal(typeof sendCalls[0].textContent, "string");
  assert.ok(sendCalls[0].config);
  assert.equal(sendCalls[0].config.apiKey, TEST_API_KEY);
});

test("completion notification does not mention reviewer note", async () => {
  const sendCalls = [];
  const reportModel = createReportModel({
    ticketNumber: TICKET_NUMBER,
    user: OWNER_ID,
    reviewerNote: "This is a detailed reviewer note."
  });
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel,
    userModel: createFullUserModel()
  });

  await service({ reportId: REPORT_ID, notificationType: "completion" });

  const payload = JSON.stringify(sendCalls[0]);
  assert.equal(payload.includes("reviewer note"), false);
  assert.equal(payload.includes("This is a detailed reviewer note"), false);
});

test("user query throwing results in delivery_failed not owner_not_found", async () => {
  const service = createService({
    sendMail: async () => ({ delivered: true }),
    reportModel: createFullReportModel(),
    userModel: {
      findById: () => ({
        select: () => ({
          lean: async () => {
            throw new Error("User database connection failed");
          }
        })
      })
    }
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "delivery_failed" });
  assert.equal(JSON.stringify(result).includes("User database connection failed"), false);
});

test("over-254-character owner email returns owner_email_invalid and no send", async () => {
  const sendCalls = [];
  const longEmail = `${"a".repeat(250)}@example.com`;
  const service = createService({
    sendMail: async (input) => {
      sendCalls.push(input);
      return { delivered: true };
    },
    reportModel: createFullReportModel(),
    userModel: createUserModel({
      email: longEmail,
      isActive: true
    })
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "owner_email_invalid" });
  assert.equal(sendCalls.length, 0);
});

test("service handles unexpected internal errors safely", async () => {
  const service = createService({
    sendMail: async () => ({ delivered: true }),
    reportModel: {
      findById: () => ({
        select: () => ({
          lean: async () => {
            throw new Error("Database connection failed");
          }
        })
      })
    },
    userModel: createFullUserModel()
  });

  const result = await service({
    reportId: REPORT_ID,
    notificationType: "message"
  });

  assert.deepEqual(result, { sent: false, reason: "delivery_failed" });
  assert.equal(JSON.stringify(result).includes("Database connection failed"), false);
});
