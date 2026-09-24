const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const {
  validateReportSubmission,
  validateReportMessage,
  validateReportPriority,
  validateReportAssignment,
  validateStartReview,
  validateReportCompletion,
  validateReportId,
  validateAnalysisId
} = require("../src/middleware/reporting.validate.middleware");
const {
  toAnalysisSnapshotDto,
  toStudentUserReferenceDto,
  toITUserReferenceDto,
  toMinimalReporterDto,
  toAssigneeCandidateDto,
  toStudentReportDto,
  toITReviewReportDto,
  toStudentReportMessageDto,
  toITReviewReportMessageDto
} = require("../src/services/reporting.dto");

function createObjectId() {
  return new mongoose.Types.ObjectId();
}

function runMiddleware(middleware, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(
    options,
    "body"
  );
  const req = {
    body: hasBody ? options.body : undefined,
    params: options.params || {}
  };

  let response;
  const res = {
    status(code) {
      return {
        json(data) {
          response = {
            status: code,
            data
          };
        }
      };
    }
  };

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  return {
    req,
    response,
    nextCalled
  };
}

function assertAccepted(result) {
  assert.equal(result.nextCalled, true);
  assert.equal(result.response, undefined);
}

function assertRejected(result) {
  assert.equal(result.nextCalled, false);
  assert.ok(result.response);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.success, false);
  assert.equal(typeof result.response.data.error, "string");
}

function createReportFixture(overrides = {}) {
  const reportId = createObjectId();
  const analysisId = createObjectId();
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const updatedAt = new Date("2026-01-02T00:00:00.000Z");
  const reviewedAt = new Date("2026-01-03T00:00:00.000Z");

  return {
    _id: reportId,
    ticketNumber: "PG-2026-000001",
    analysis: analysisId,
    analysisSnapshot: {
      url: "https://example.com/login",
      risk: "low",
      score: 5,
      indicators: [
        "Contains suspicious keyword(s): login"
      ]
    },
    reason: "suspected_phishing",
    details: "Initial context",
    status: "completed",
    priority: "high",
    assignedTo: null,
    assessment: "phishing",
    reviewerNote: "Final review note",
    reviewedBy: null,
    reviewedAt,
    createdAt,
    updatedAt,
    ...overrides
  };
}

function createUser(overrides = {}) {
  return new User({
    name: "Assigned IT",
    email: "assigned-it@test.invalid",
    password: "test-password-hash",
    role: "staff",
    isActive: true,
    ...overrides
  });
}

test("Report submission validation accepts the exact allowlist and trims details", () => {
  const analysisId = createObjectId().toString();
  const result = runMiddleware(validateReportSubmission, {
    body: {
      analysisId,
      reason: "suspected_phishing",
      details: "  Initial context  "
    }
  });

  assertAccepted(result);
  assert.equal(result.req.body.analysisId, analysisId);
  assert.equal(result.req.body.details, "Initial context");
});

test("Report submission validation rejects missing or malformed analysisId", () => {
  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        reason: "other"
      }
    })
  );

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId: "not-an-object-id",
        reason: "other"
      }
    })
  );

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId: 123,
        reason: "other"
      }
    })
  );
});

test("Report submission validation enforces reason, details, and unknown fields", () => {
  const analysisId = createObjectId().toString();

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId
      }
    })
  );

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId,
        reason: "unknown"
      }
    })
  );

  const blankDetails = runMiddleware(validateReportSubmission, {
    body: {
      analysisId,
      reason: "other",
      details: "   "
    }
  });
  assertAccepted(blankDetails);
  assert.equal(blankDetails.req.body.details, null);

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId,
        reason: "other",
        details: "a".repeat(501)
      }
    })
  );

  assertRejected(
    runMiddleware(validateReportSubmission, {
      body: {
        analysisId,
        reason: "other",
        details: null
      }
    })
  );

  for (const field of [
    "ticketNumber",
    "user",
    "analysisSnapshot",
    "status",
    "priority",
    "assignedTo",
    "assessment",
    "reviewerNote",
    "reviewedBy",
    "reviewedAt",
    "unexpected"
  ]) {
    assertRejected(
      runMiddleware(validateReportSubmission, {
        body: {
          analysisId,
          reason: "other",
          [field]: "client-controlled"
        }
      })
    );
  }
});

test("Message validation accepts one trimmed message and rejects empty or oversized content", () => {
  const valid = runMiddleware(validateReportMessage, {
    body: {
      message: "  Additional context  "
    }
  });
  assertAccepted(valid);
  assert.equal(valid.req.body.message, "Additional context");

  for (const message of [undefined, "", "   ", 42, null]) {
    const body = message === undefined ? {} : { message };
    assertRejected(
      runMiddleware(validateReportMessage, { body })
    );
  }

  assertRejected(
    runMiddleware(validateReportMessage, {
      body: {
        message: "a".repeat(1001)
      }
    })
  );
});

test("Message validation rejects forged sender, role, Report, and timestamp fields", () => {
  for (const field of [
    "sender",
    "senderRole",
    "report",
    "createdAt",
    "updatedAt",
    "unexpected"
  ]) {
    assertRejected(
      runMiddleware(validateReportMessage, {
        body: {
          message: "Context",
          [field]: "client-controlled"
        }
      })
    );
  }
});

test("Priority validation accepts the three approved values and rejects extras", () => {
  for (const priority of ["low", "normal", "high"]) {
    assertAccepted(
      runMiddleware(validateReportPriority, {
        body: { priority }
      })
    );
  }

  for (const priority of ["urgent", "", null, 1]) {
    assertRejected(
      runMiddleware(validateReportPriority, {
        body: { priority }
      })
    );
  }

  assertRejected(
    runMiddleware(validateReportPriority, {
      body: {
        priority: "normal",
        status: "completed"
      }
    })
  );
});

test("Assignment validation checks only the assignedTo ObjectId", () => {
  const assignedTo = createObjectId().toString();

  assertAccepted(
    runMiddleware(validateReportAssignment, {
      body: { assignedTo }
    })
  );

  for (const invalidAssignedTo of [
    "not-an-object-id",
    "123456789012",
    123,
    null
  ]) {
    assertRejected(
      runMiddleware(validateReportAssignment, {
        body: { assignedTo: invalidAssignedTo }
      })
    );
  }

  assertRejected(
    runMiddleware(validateReportAssignment, {
      body: {
        assignedTo,
        user: "forged-user"
      }
    })
  );
});

test("Start Review validation accepts only an absent or empty body", () => {
  assertAccepted(
    runMiddleware(validateStartReview, {
      body: undefined
    })
  );
  assertAccepted(
    runMiddleware(validateStartReview, {
      body: {}
    })
  );

  for (const body of [
    { status: "under_review" },
    { assessment: "phishing" },
    { priority: "high" },
    { assignedTo: createObjectId().toString() },
    null,
    []
  ]) {
    assertRejected(
      runMiddleware(validateStartReview, { body })
    );
  }
});

test("Completion validation accepts final assessments and normalizes reviewerNote", () => {
  for (const assessment of [
    "phishing",
    "suspicious",
    "no_threat_identified"
  ]) {
    const result = runMiddleware(validateReportCompletion, {
      body: {
        assessment,
        reviewerNote: "  Final explanation  "
      }
    });

    assertAccepted(result);
    assert.equal(result.req.body.reviewerNote, "Final explanation");
  }

  const missingNote = runMiddleware(validateReportCompletion, {
    body: {
      assessment: "suspicious"
    }
  });
  assertAccepted(missingNote);
  assert.equal(missingNote.req.body.reviewerNote, null);

  const blankNote = runMiddleware(validateReportCompletion, {
    body: {
      assessment: "suspicious",
      reviewerNote: "   "
    }
  });
  assertAccepted(blankNote);
  assert.equal(blankNote.req.body.reviewerNote, null);
});

test("Completion validation rejects pending, invalid notes, and forged metadata", () => {
  for (const assessment of [
    "pending",
    "safe",
    "",
    null
  ]) {
    assertRejected(
      runMiddleware(validateReportCompletion, {
        body: { assessment }
      })
    );
  }

  for (const reviewerNote of [
    "a".repeat(1001),
    null,
    42
  ]) {
    assertRejected(
      runMiddleware(validateReportCompletion, {
        body: {
          assessment: "phishing",
          reviewerNote
        }
      })
    );
  }

  for (const field of [
    "status",
    "reviewedBy",
    "reviewedAt",
    "priority",
    "assignedTo",
    "ticketNumber",
    "unexpected"
  ]) {
    assertRejected(
      runMiddleware(validateReportCompletion, {
        body: {
          assessment: "phishing",
          [field]: "client-controlled"
        }
      })
    );
  }
});

test("route parameter validation rejects malformed report and analysis IDs", () => {
  const validReportId = createObjectId().toString();
  const validAnalysisId = createObjectId().toString();

  assertAccepted(
    runMiddleware(validateReportId, {
      params: { reportId: validReportId }
    })
  );
  assertAccepted(
    runMiddleware(validateAnalysisId, {
      params: { analysisId: validAnalysisId }
    })
  );

  for (const parameter of ["reportId", "analysisId"]) {
    for (const invalidId of [
      "not-an-object-id",
      "123456789012",
      123,
      null
    ]) {
      const middleware =
        parameter === "reportId"
          ? validateReportId
          : validateAnalysisId;
      const params = {
        [parameter]: invalidId
      };

      assertRejected(
        runMiddleware(middleware, { params })
      );
    }
  }
});

test("student Report DTO contains only approved safe fields", () => {
  const assignedTo = createUser({
    name: "Assigned IT",
    email: "assigned@test.invalid",
    role: "staff"
  });
  const reviewedBy = createUser({
    name: "Reviewing Admin",
    email: "reviewer@test.invalid",
    role: "admin"
  });
  const report = createReportFixture({
    assignedTo,
    reviewedBy,
    analysisSnapshot: {
      url: "https://example.com/login",
      risk: "low",
      score: 5,
      indicators: [
        "Contains suspicious keyword(s): login",
        "Unknown legacy indicator"
      ],
      findings: [
        {
          type: "forged-finding"
        }
      ]
    },
    user: createUser({
      name: "Reporter",
      email: "reporter@test.invalid",
      role: "user"
    })
  });

  const dto = toStudentReportDto(report);

  assert.deepEqual(Object.keys(dto).sort(), [
    "analysisId",
    "analysisSnapshot",
    "assessment",
    "assignedTo",
    "createdAt",
    "details",
    "id",
    "priority",
    "reason",
    "reviewedAt",
    "reviewedBy",
    "reviewerNote",
    "status",
    "ticketNumber",
    "updatedAt"
  ]);
  assert.deepEqual(Object.keys(dto.analysisSnapshot).sort(), [
    "findings",
    "indicators",
    "risk",
    "score",
    "url"
  ]);
  assert.equal(dto.analysisSnapshot.findings.length, 1);
  assert.equal(
    dto.analysisSnapshot.findings[0].type,
    "suspicious_keyword"
  );
  assert.deepEqual(dto.assignedTo, {
    name: "Assigned IT",
    role: "staff"
  });
  assert.deepEqual(dto.reviewedBy, {
    name: "Reviewing Admin",
    role: "admin"
  });
  assert.equal(Object.hasOwn(dto, "user"), false);
  assert.equal(Object.hasOwn(dto, "reporter"), false);

  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes("assigned@test.invalid"), false);
  assert.equal(serialized.includes("reviewer@test.invalid"), false);
  assert.equal(serialized.includes("test-password-hash"), false);
  assert.equal(serialized.includes("isActive"), false);
  assert.equal(serialized.includes("forged-finding"), false);
});

test("student DTO safely handles null assignment and reviewer references", () => {
  const dto = toStudentReportDto(
    createReportFixture({
      assignedTo: null,
      reviewedBy: null
    })
  );

  assert.equal(dto.assignedTo, null);
  assert.equal(dto.reviewedBy, null);
});

test("IT Review DTO exposes only approved reporter, assignment, and reviewer data", () => {
  const assignedTo = createUser({
    name: "Assigned IT",
    email: "assigned@test.invalid",
    role: "staff"
  });
  const reviewedBy = createUser({
    name: "Reviewing Admin",
    email: "reviewer@test.invalid",
    role: "admin"
  });
  const reporter = createUser({
    name: "Reporter",
    email: "reporter@test.invalid",
    role: "user",
    isActive: false
  });
  const report = createReportFixture({
    assignedTo,
    reviewedBy,
    user: reporter
  });

  const dto = toITReviewReportDto(report);

  assert.deepEqual(Object.keys(dto).sort(), [
    "analysisId",
    "analysisSnapshot",
    "assessment",
    "assignedTo",
    "createdAt",
    "details",
    "id",
    "priority",
    "reason",
    "reporter",
    "reviewedAt",
    "reviewedBy",
    "reviewerNote",
    "status",
    "ticketNumber",
    "updatedAt"
  ]);
  assert.deepEqual(dto.reporter, {
    id: reporter._id.toString(),
    name: "Reporter",
    email: "reporter@test.invalid"
  });
  assert.deepEqual(Object.keys(dto.assignedTo).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);
  assert.deepEqual(Object.keys(dto.reviewedBy).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);

  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes("test-password-hash"), false);
  assert.equal(serialized.includes("isActive"), false);
  assert.equal(serialized.includes("trainingRecords"), false);
  assert.equal(serialized.includes("token"), false);
});

test("student and IT message DTOs differ only by permitted sender ID", () => {
  const sender = createUser({
    name: "IT Reviewer",
    email: "reviewer@test.invalid",
    role: "user",
    password: "message-test-hash"
  });
  const message = {
    _id: createObjectId(),
    message: "Please provide more context.",
    sender,
    senderRole: "staff",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    senderEmail: "should-not-be-returned@test.invalid"
  };

  const studentDto = toStudentReportMessageDto(message);
  const itDto = toITReviewReportMessageDto(message);

  assert.deepEqual(Object.keys(studentDto).sort(), [
    "createdAt",
    "id",
    "message",
    "sender"
  ]);
  assert.deepEqual(studentDto.sender, {
    name: "IT Reviewer",
    role: "staff"
  });
  assert.deepEqual(Object.keys(itDto.sender).sort(), [
    "id",
    "name",
    "role"
  ]);
  assert.equal(itDto.sender.id, sender._id.toString());
  assert.equal(itDto.sender.role, "staff");
  assert.equal(JSON.stringify(studentDto).includes("email"), false);
  assert.equal(JSON.stringify(itDto).includes("email"), false);
  assert.equal(
    JSON.stringify(studentDto).includes("message-test-hash"),
    false
  );
});

test("message DTO uses the stored sender role snapshot", () => {
  const sender = createUser({
    name: "Current User",
    role: "user"
  });
  const message = {
    _id: createObjectId(),
    message: "Context",
    sender,
    senderRole: "admin",
    createdAt: new Date()
  };

  assert.equal(
    toStudentReportMessageDto(message).sender.role,
    "admin"
  );
  assert.equal(
    toITReviewReportMessageDto(message).sender.role,
    "admin"
  );
});

test("assignee candidate DTO contains only id, name, email, and role", () => {
  const candidate = createUser({
    name: "Eligible Reviewer",
    email: "eligible@test.invalid",
    role: "staff",
    isActive: true
  });

  const dto = toAssigneeCandidateDto(candidate);

  assert.deepEqual(Object.keys(dto).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);
  assert.deepEqual(dto, {
    id: candidate._id.toString(),
    name: "Eligible Reviewer",
    email: "eligible@test.invalid",
    role: "staff"
  });
  assert.equal(JSON.stringify(dto).includes("isActive"), false);
  assert.equal(JSON.stringify(dto).includes("password"), false);
  assert.equal(toAssigneeCandidateDto(null), null);
});

test("findings are reconstructed from snapshot indicators and malformed indicators are not invented", () => {
  const indicators = [
    "URL uses an IP address instead of a domain name",
    "Unknown legacy indicator",
    "URL uses a non-standard port: 443",
    null,
    { type: "ip_address" }
  ];

  const snapshotDto = toAnalysisSnapshotDto({
    url: "https://example.com",
    risk: "medium",
    score: 25,
    indicators,
    findings: [
      {
        type: "forged-finding"
      }
    ]
  });

  assert.deepEqual(snapshotDto.indicators, indicators);
  assert.equal(snapshotDto.findings.length, 1);
  assert.equal(snapshotDto.findings[0].type, "ip_address");
  assert.equal(
    snapshotDto.findings.some(
      (finding) => finding.type === "forged-finding"
    ),
    false
  );
});

test("Report DTOs do not require a source Analysis document", () => {
  const report = createReportFixture({
    analysis: createObjectId(),
    assignedTo: null,
    reviewedBy: null
  });

  const studentDto = toStudentReportDto(report);
  const itDto = toITReviewReportDto(report);

  assert.equal(typeof studentDto.analysisId, "string");
  assert.equal(typeof itDto.analysisId, "string");
  assert.equal(
    studentDto.analysisSnapshot.findings.length,
    1
  );
  assert.equal(itDto.analysisSnapshot.findings.length, 1);
});

test("DTO reference helpers safely handle null and plain objects", () => {
  assert.equal(toStudentUserReferenceDto(null), null);
  assert.equal(toITUserReferenceDto(null), null);
  assert.equal(toMinimalReporterDto(null), null);
  assert.deepEqual(
    toStudentUserReferenceDto({
      name: "Staff",
      role: "staff"
    }),
    {
      name: "Staff",
      role: "staff"
    }
  );

  const reporterId = createObjectId();

  assert.deepEqual(
    toMinimalReporterDto({
      _id: reporterId,
      name: "Reporter",
      email: "reporter@test.invalid",
      password: "private"
    }),
    {
      id: reporterId.toString(),
      name: "Reporter",
      email: "reporter@test.invalid"
    }
  );
});
