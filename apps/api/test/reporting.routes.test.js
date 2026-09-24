const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const {
  createReportingController
} = require("../src/controllers/reporting.controller");
const reportingRoutes = require("../src/routes/reporting.routes");
const {
  REPORTING_ERROR_CODES,
  ReportingServiceError
} = require("../src/services/reporting.service");

const { createReportingRouter } = reportingRoutes;

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const userId = new mongoose.Types.ObjectId().toString();
const otherUserId = new mongoose.Types.ObjectId().toString();
const staffId = new mongoose.Types.ObjectId().toString();
const otherStaffId = new mongoose.Types.ObjectId().toString();
const adminId = new mongoose.Types.ObjectId().toString();
const reportId = new mongoose.Types.ObjectId().toString();
const analysisId = new mongoose.Types.ObjectId().toString();
const assigneeId = new mongoose.Types.ObjectId().toString();

const calls = [];
const errors = new Map();

function makeReportDto(overrides = {}) {
  return {
    id: reportId,
    ticketNumber: "PG-2026-000001",
    analysisId,
    analysisSnapshot: {
      url: "https://example.com/login",
      risk: "low",
      score: 5,
      indicators: ["Contains suspicious keyword(s): login"],
      findings: [
        {
          type: "suspicious_keyword",
          title: "Suspicious keyword(s)",
          explanation: "Context",
          scoreContribution: 5
        }
      ]
    },
    reason: "suspected_phishing",
    details: null,
    status: "submitted",
    priority: "normal",
    assignedTo: null,
    assessment: "pending",
    reviewerNote: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    reporter: {
      id: userId,
      name: "Student",
      email: "student@test.invalid"
    },
    ...overrides
  };
}

function makeMessageDto(overrides = {}) {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    message: "Additional context",
    sender: {
      name: "Student",
      role: "user"
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeAssigneeDto(overrides = {}) {
  return {
    id: assigneeId,
    name: "Eligible Reviewer",
    email: "reviewer@test.invalid",
    role: "staff",
    ...overrides
  };
}

const defaultResults = {
  createReport: () => makeReportDto(),
  getOwnReports: () => [makeReportDto()],
  getOwnReport: () => makeReportDto(),
  getOwnReportMessages: () => [makeMessageDto()],
  createOwnReportMessage: () => makeMessageDto(),
  getReviewQueue: () => [makeReportDto()],
  getAssignmentCandidates: () => [makeAssigneeDto()],
  getReviewReport: () => makeReportDto(),
  getReviewReportMessages: () => [makeMessageDto()],
  createReviewReportMessage: () =>
    makeMessageDto({
      sender: {
        id: staffId,
        name: "Staff",
        role: "staff"
      }
    }),
  claimReviewReport: () =>
    makeReportDto({
      assignedTo: {
        id: staffId,
        name: "Staff",
        role: "staff"
      }
    }),
  assignReviewReport: () =>
    makeReportDto({
      assignedTo: {
        id: assigneeId,
        name: "Eligible Reviewer",
        email: "reviewer@test.invalid",
        role: "staff"
      }
    }),
  updateReviewReportPriority: () =>
    makeReportDto({ priority: "high" }),
  startReviewReport: () =>
    makeReportDto({ status: "under_review" }),
  completeReviewReport: () =>
    makeReportDto({
      status: "completed",
      assessment: "phishing",
      reviewerNote: "Final note",
      reviewedBy: {
        id: staffId,
        name: "Staff",
        role: "staff"
      },
      reviewedAt: "2026-01-02T00:00:00.000Z"
    })
};

const service = Object.fromEntries(
  Object.entries(defaultResults).map(([operation, result]) => [
    operation,
    async (...args) => {
      calls.push({ operation, args });

      if (errors.has(operation)) {
        const error = errors.get(operation);
        errors.delete(operation);
        throw error;
      }

      return result(...args);
    }
  ])
);

const app = express();
app.use(express.json());
app.use(
  "/api/reports",
  createReportingRouter(createReportingController(service))
);
app.use((error, req, res, next) => {
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
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

  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function makeToken(id, role) {
  return jwt.sign(
    {
      userId: id,
      role
    },
    testJwtSecret,
    { expiresIn: "1h" }
  );
}

function authHeaders(role = "user", id = userId) {
  return {
    Authorization: `Bearer ${makeToken(id, role)}`
  };
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  return fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  });
}

function assertNoStore(response) {
  assert.equal(
    response.headers.get("cache-control"),
    "no-store"
  );
}

function resetTestState() {
  calls.length = 0;
  errors.clear();
}

test("missing and invalid authentication are rejected on Reporting endpoints", async () => {
  resetTestState();

  const missingStudent = await request("/api/reports");
  assert.equal(missingStudent.status, 401);
  assertNoStore(missingStudent);

  const missingReview = await request("/api/reports/review");
  assert.equal(missingReview.status, 401);
  assertNoStore(missingReview);

  const invalidToken = await request("/api/reports", {
    headers: {
      Authorization: "Bearer invalid-token"
    }
  });
  assert.equal(invalidToken.status, 403);
  assert.equal(calls.length, 0);
});

test("normal users are denied IT review operations while staff and admin access is allowed", async () => {
  resetTestState();

  const deniedQueue = await request("/api/reports/review", {
    headers: authHeaders("user")
  });
  assert.equal(deniedQueue.status, 403);
  assertNoStore(deniedQueue);

  const deniedDetail = await request(
    `/api/reports/review/${reportId}`,
    { headers: authHeaders("user") }
  );
  assert.equal(deniedDetail.status, 403);

  const deniedClaim = await request(
    `/api/reports/review/${reportId}/claim`,
    {
      method: "PATCH",
      headers: authHeaders("user")
    }
  );
  assert.equal(deniedClaim.status, 403);

  const staffQueue = await request("/api/reports/review", {
    headers: authHeaders("staff", staffId)
  });
  assert.equal(staffQueue.status, 200);
  assertNoStore(staffQueue);

  const staffDetail = await request(
    `/api/reports/review/${reportId}`,
    { headers: authHeaders("staff", staffId) }
  );
  assert.equal(staffDetail.status, 200);

  const staffAssignment = await request(
    `/api/reports/review/${reportId}/assignment`,
    {
      method: "PATCH",
      headers: authHeaders("staff", staffId),
      body: { assignedTo: assigneeId }
    }
  );
  assert.equal(staffAssignment.status, 403);

  const staffAssignees = await request(
    "/api/reports/review/assignees",
    { headers: authHeaders("staff", staffId) }
  );
  assert.equal(staffAssignees.status, 403);

  const adminAssignees = await request(
    "/api/reports/review/assignees",
    { headers: authHeaders("admin", adminId) }
  );
  assert.equal(adminAssignees.status, 200);
  assertNoStore(adminAssignees);

  const adminAssignment = await request(
    `/api/reports/review/${reportId}/assignment`,
    {
      method: "PATCH",
      headers: authHeaders("admin", adminId),
      body: { assignedTo: assigneeId }
    }
  );
  assert.equal(adminAssignment.status, 200);
  assertNoStore(adminAssignment);
});

test("static review routes are ordered before generic report routes", async () => {
  resetTestState();

  const queue = await request("/api/reports/review", {
    headers: authHeaders("staff", staffId)
  });
  assert.equal(queue.status, 200);
  assert.equal(calls[0].operation, "getReviewQueue");

  const assignees = await request("/api/reports/review/assignees", {
    headers: authHeaders("admin", adminId)
  });
  assert.equal(assignees.status, 200);
  assert.equal(calls[1].operation, "getAssignmentCandidates");

  const reviewDetail = await request(
    `/api/reports/review/${reportId}`,
    { headers: authHeaders("staff", staffId) }
  );
  assert.equal(reviewDetail.status, 200);
  assert.equal(calls[2].operation, "getReviewReport");

  const ownDetail = await request(`/api/reports/${reportId}`, {
    headers: authHeaders("user", userId)
  });
  assert.equal(ownDetail.status, 200);
  assert.equal(calls[3].operation, "getOwnReport");
});

test("all review action routes reach their intended handlers", async () => {
  resetTestState();
  const headers = authHeaders("staff", staffId);

  const cases = [
    {
      path: `/api/reports/review/${reportId}/claim`,
      method: "PATCH",
      operation: "claimReviewReport"
    },
    {
      path: `/api/reports/review/${reportId}/priority`,
      method: "PATCH",
      body: { priority: "high" },
      operation: "updateReviewReportPriority"
    },
    {
      path: `/api/reports/review/${reportId}/start`,
      method: "PATCH",
      body: {},
      operation: "startReviewReport"
    },
    {
      path: `/api/reports/review/${reportId}/complete`,
      method: "PATCH",
      body: { assessment: "suspicious" },
      operation: "completeReviewReport"
    },
    {
      path: `/api/reports/review/${reportId}/messages`,
      method: "GET",
      operation: "getReviewReportMessages"
    },
    {
      path: `/api/reports/review/${reportId}/messages`,
      method: "POST",
      body: { message: "Please provide context" },
      operation: "createReviewReportMessage",
      expectedStatus: 201
    }
  ];

  for (const testCase of cases) {
    const response = await request(testCase.path, {
      method: testCase.method,
      headers,
      ...(testCase.body === undefined
        ? {}
        : { body: testCase.body })
    });

    assert.equal(
      response.status,
      testCase.expectedStatus || 200,
      testCase.path
    );
    assertNoStore(response);
  }

  assert.deepEqual(
    calls.map(({ operation }) => operation),
    cases.map(({ operation }) => operation)
  );
});

test("Reporting validation rejects invalid input before service calls", async () => {
  resetTestState();

  const malformedId = await request("/api/reports/not-an-id", {
    headers: authHeaders()
  });
  assert.equal(malformedId.status, 400);
  assertNoStore(malformedId);

  const invalidSubmission = await request("/api/reports", {
    method: "POST",
    headers: authHeaders(),
    body: {
      analysisId,
      reason: "other",
      priority: "high"
    }
  });
  assert.equal(invalidSubmission.status, 400);

  const invalidMessage = await request(
    `/api/reports/${reportId}/messages`,
    {
      method: "POST",
      headers: authHeaders(),
      body: {
        message: "Context",
        sender: otherUserId
      }
    }
  );
  assert.equal(invalidMessage.status, 400);

  const invalidAssignment = await request(
    `/api/reports/review/${reportId}/assignment`,
    {
      method: "PATCH",
      headers: authHeaders("admin", adminId),
      body: { assignedTo: "not-an-id" }
    }
  );
  assert.equal(invalidAssignment.status, 400);

  const invalidPriority = await request(
    `/api/reports/review/${reportId}/priority`,
    {
      method: "PATCH",
      headers: authHeaders("staff", staffId),
      body: { priority: "urgent" }
    }
  );
  assert.equal(invalidPriority.status, 400);

  const nonEmptyStart = await request(
    `/api/reports/review/${reportId}/start`,
    {
      method: "PATCH",
      headers: authHeaders("staff", staffId),
      body: { status: "under_review" }
    }
  );
  assert.equal(nonEmptyStart.status, 400);

  const invalidCompletion = await request(
    `/api/reports/review/${reportId}/complete`,
    {
      method: "PATCH",
      headers: authHeaders("staff", staffId),
      body: { assessment: "pending" }
    }
  );
  assert.equal(invalidCompletion.status, 400);

  assert.equal(calls.length, 0);
});

test("controllers pass authenticated identity and never body identity fields to services", async () => {
  resetTestState();

  await request("/api/reports", {
    method: "POST",
    headers: authHeaders("user", userId),
    body: {
      analysisId,
      reason: "other",
      details: "Context"
    }
  });
  assert.deepEqual(calls[0].args[0], {
    userId,
    analysisId,
    reason: "other",
    details: "Context"
  });

  await request(`/api/reports/${reportId}/messages`, {
    method: "POST",
    headers: authHeaders("user", userId),
    body: { message: "More context" }
  });
  assert.deepEqual(calls[1].args[0], {
    userId,
    reportId,
    message: "More context",
    actorRole: "user"
  });

  await request(`/api/reports/review/${reportId}/claim`, {
    method: "PATCH",
    headers: authHeaders("staff", staffId)
  });
  assert.deepEqual(calls[2].args[0], {
    reportId,
    actorId: staffId
  });

  await request(`/api/reports/review/${reportId}/complete`, {
    method: "PATCH",
    headers: authHeaders("staff", staffId),
    body: {
      assessment: "phishing",
      reviewerNote: "Final"
    }
  });
  assert.deepEqual(calls[3].args[0], {
    reportId,
    actorId: staffId,
    actorRole: "staff",
    assessment: "phishing",
    reviewerNote: "Final"
  });
});

test("Reporting success status codes and safe response envelopes are correct", async () => {
  resetTestState();

  const createResponse = await request("/api/reports", {
    method: "POST",
    headers: authHeaders(),
    body: {
      analysisId,
      reason: "other"
    }
  });
  assert.equal(createResponse.status, 201);
  assertNoStore(createResponse);

  const listResponse = await request("/api/reports", {
    headers: authHeaders()
  });
  assert.equal(listResponse.status, 200);
  assertNoStore(listResponse);

  const messageResponse = await request(
    `/api/reports/${reportId}/messages`,
    {
      method: "POST",
      headers: authHeaders(),
      body: { message: "Context" }
    }
  );
  assert.equal(messageResponse.status, 201);
  assertNoStore(messageResponse);

  for (const testCase of [
    {
      path: `/api/reports/review/${reportId}/claim`,
      method: "PATCH"
    },
    {
      path: `/api/reports/review/${reportId}/priority`,
      method: "PATCH",
      body: { priority: "normal" }
    },
    {
      path: `/api/reports/review/${reportId}/start`,
      method: "PATCH",
      body: {}
    },
    {
      path: `/api/reports/review/${reportId}/complete`,
      method: "PATCH",
      body: { assessment: "suspicious" }
    }
  ]) {
    const response = await request(testCase.path, {
      method: testCase.method,
      headers: authHeaders("staff", staffId),
      ...(testCase.body === undefined
        ? {}
        : { body: testCase.body })
    });
    assert.equal(response.status, 200);
    assertNoStore(response);
  }
});

test("Reporting service errors map to safe HTTP responses", async () => {
  resetTestState();

  errors.set(
    "getOwnReport",
    new ReportingServiceError(
      REPORTING_ERROR_CODES.NOT_FOUND,
      "Report not found",
      404
    )
  );
  const notFound = await request(`/api/reports/${reportId}`, {
    headers: authHeaders()
  });
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), {
    success: false,
    error: "Report not found"
  });

  errors.set(
    "createReport",
    new ReportingServiceError(
      REPORTING_ERROR_CODES.DUPLICATE_REPORT,
      "A report already exists for this analysis",
      409
    )
  );
  const duplicate = await request("/api/reports", {
    method: "POST",
    headers: authHeaders(),
    body: { analysisId, reason: "other" }
  });
  assert.equal(duplicate.status, 409);
  assertNoStore(duplicate);

  errors.set(
    "claimReviewReport",
    new ReportingServiceError(
      REPORTING_ERROR_CODES.CONFLICT,
      "Report is already assigned or completed",
      409
    )
  );
  const conflict = await request(
    `/api/reports/review/${reportId}/claim`,
    {
      method: "PATCH",
      headers: authHeaders("staff", staffId)
    }
  );
  assert.equal(conflict.status, 409);

  errors.set(
    "completeReviewReport",
    new ReportingServiceError(
      REPORTING_ERROR_CODES.FORBIDDEN,
      "Only the assigned staff member may complete this report",
      403
    )
  );
  const forbidden = await request(
    `/api/reports/review/${reportId}/complete`,
    {
      method: "PATCH",
      headers: authHeaders("staff", otherStaffId),
      body: { assessment: "phishing" }
    }
  );
  assert.equal(forbidden.status, 403);

  errors.set(
    "assignReviewReport",
    new ReportingServiceError(
      REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
      "Assignment target must be an active staff or admin account",
      400
    )
  );
  const invalidAssignee = await request(
    `/api/reports/review/${reportId}/assignment`,
    {
      method: "PATCH",
      headers: authHeaders("admin", adminId),
      body: { assignedTo: assigneeId }
    }
  );
  assert.equal(invalidAssignee.status, 400);

  errors.set(
    "getReviewQueue",
    new Error("internal database detail must not leak")
  );
  const unknown = await request("/api/reports/review", {
    headers: authHeaders("staff", staffId)
  });
  assert.equal(unknown.status, 500);
  assert.deepEqual(await unknown.json(), {
    success: false,
    error: "Internal server error"
  });
});

test("Reporting responses consistently include Cache-Control no-store", async () => {
  resetTestState();

  const responses = await Promise.all([
    request("/api/reports", { headers: authHeaders() }),
    request(`/api/reports/${reportId}`, {
      headers: authHeaders()
    }),
    request(`/api/reports/${reportId}/messages`, {
      headers: authHeaders()
    }),
    request("/api/reports/review", {
      headers: authHeaders("staff", staffId)
    }),
    request("/api/reports/review/assignees", {
      headers: authHeaders("admin", adminId)
    }),
    request(`/api/reports/review/${reportId}`, {
      headers: authHeaders("staff", staffId)
    }),
    request(`/api/reports/review/${reportId}/messages`, {
      headers: authHeaders("staff", staffId)
    })
  ]);

  for (const response of responses) {
    assertNoStore(response);
  }
});
