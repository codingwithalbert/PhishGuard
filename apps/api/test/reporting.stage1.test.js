const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Report = require("../src/models/Report");
const ReportMessage = require("../src/models/ReportMessage");
const ReportTicketCounter = require("../src/models/ReportTicketCounter");
const {
  COUNTER_ID,
  MAX_TICKET_SEQUENCE,
  TICKET_NUMBER_PATTERN,
  TicketNumberOverflowError,
  allocateTicketNumber,
  formatTicketNumber
} = require("../src/services/reportingTicket.service");

function createObjectId() {
  return new mongoose.Types.ObjectId();
}

function createValidReportData(overrides = {}) {
  return {
    ticketNumber: "PG-2026-000001",
    user: createObjectId(),
    analysis: createObjectId(),
    analysisSnapshot: {
      url: "https://example.com",
      risk: "low",
      score: 0,
      indicators: []
    },
    reason: "suspected_phishing",
    ...overrides
  };
}

function findIndex(schema, fields) {
  return schema.indexes().find(([indexFields]) => {
    return Object.keys(fields).every(
      (field) => indexFields[field] === fields[field]
    );
  });
}

async function assertValidationFails(document, field) {
  await assert.rejects(
    () => document.validate(),
    (error) => {
      assert.ok(error.errors[field]);
      return true;
    }
  );
}

function createAtomicCounterModel({
  initialSequence = 0,
  increment = 1,
  duplicateFirstAttempt = false
} = {}) {
  let sequence = initialSequence;
  let calls = 0;
  let operationQueue = Promise.resolve();

  return {
    get calls() {
      return calls;
    },

    get sequence() {
      return sequence;
    },

    findOneAndUpdate(filter, update) {
      calls += 1;

      const operation = operationQueue.then(() => {
        if (
          duplicateFirstAttempt &&
          calls === 1
        ) {
          const error = new Error(
            "duplicate counter initialization"
          );
          error.code = 11000;
          throw error;
        }

        sequence += increment;

        return { sequence };
      });

      operationQueue = operation.catch(() => undefined);

      return operation;
    }
  };
}

test("Report uses the approved collection and required fields", () => {
  assert.equal(Report.collection.collectionName, "reports");

  const report = new Report(createValidReportData());

  assert.equal(report.ticketNumber, "PG-2026-000001");
  assert.equal(report.status, "submitted");
  assert.equal(report.priority, "normal");
  assert.equal(report.assessment, "pending");
  assert.equal(report.assignedTo, null);
  assert.equal(report.reviewedBy, null);
  assert.equal(report.reviewedAt, null);
  assert.equal(report.details, null);
  assert.equal(report.reviewerNote, null);
});

test("Report rejects missing required creation fields", async () => {
  const report = new Report();

  await assert.rejects(
    () => report.validate(),
    (error) => {
      assert.ok(error.errors.ticketNumber);
      assert.ok(error.errors.user);
      assert.ok(error.errors.analysis);
      assert.ok(error.errors.analysisSnapshot);
      assert.ok(error.errors.reason);
      return true;
    }
  );
});

test("Report enforces controlled enums", async () => {
  const invalidReason = new Report(
    createValidReportData({ reason: "not-a-reason" })
  );
  const invalidStatus = new Report(
    createValidReportData({ status: "closed" })
  );
  const invalidPriority = new Report(
    createValidReportData({ priority: "urgent" })
  );
  const invalidAssessment = new Report(
    createValidReportData({ assessment: "safe" })
  );

  await assertValidationFails(invalidReason, "reason");
  await assertValidationFails(invalidStatus, "status");
  await assertValidationFails(invalidPriority, "priority");
  await assertValidationFails(invalidAssessment, "assessment");
});

test("Report normalizes optional text and limits it", async () => {
  const report = new Report(
    createValidReportData({
      details: "   ",
      reviewerNote: "  final note  "
    })
  );

  assert.equal(report.details, null);
  assert.equal(report.reviewerNote, "final note");

  const oversizedDetails = new Report(
    createValidReportData({ details: "a".repeat(501) })
  );
  const oversizedReviewerNote = new Report(
    createValidReportData({ reviewerNote: "a".repeat(1001) })
  );

  await assertValidationFails(oversizedDetails, "details");
  await assertValidationFails(
    oversizedReviewerNote,
    "reviewerNote"
  );
});

test("Report marks creation fields as immutable", () => {
  for (const field of [
    "ticketNumber",
    "user",
    "analysis",
    "analysisSnapshot",
    "reason",
    "details"
  ]) {
    assert.equal(
      Report.schema.path(field).options.immutable,
      true,
      `${field} should be immutable`
    );
  }

  const snapshotSchema = Report.schema.path("analysisSnapshot").schema;

  for (const field of [
    "url",
    "risk",
    "score",
    "indicators"
  ]) {
    assert.equal(
      snapshotSchema.path(field).options.immutable,
      true,
      `analysisSnapshot.${field} should be immutable`
    );
  }
});

test("Report stores no findings field in its analysis snapshot", () => {
  const snapshotSchema = Report.schema.path("analysisSnapshot").schema;

  assert.equal(
    Object.hasOwn(snapshotSchema.paths, "findings"),
    false
  );
});

test("Report enforces unfinished assessment consistency", async () => {
  const invalidSubmitted = new Report(
    createValidReportData({
      status: "submitted",
      assessment: "phishing"
    })
  );
  const invalidUnderReview = new Report(
    createValidReportData({
      status: "under_review",
      assessment: "suspicious"
    })
  );

  await assert.rejects(
    () => invalidSubmitted.validate(),
    /Unfinished reports must have a pending assessment/
  );
  await assert.rejects(
    () => invalidUnderReview.validate(),
    /Unfinished reports must have a pending assessment/
  );
});

test("Report enforces completed assessment and reviewer metadata", async () => {
  const invalidPending = new Report(
    createValidReportData({
      status: "completed",
      assessment: "pending"
    })
  );
  const missingMetadata = new Report(
    createValidReportData({
      status: "completed",
      assessment: "phishing"
    })
  );
  const validCompleted = new Report(
    createValidReportData({
      status: "completed",
      assessment: "phishing",
      reviewedBy: createObjectId(),
      reviewedAt: new Date("2026-01-01T00:00:00.000Z")
    })
  );

  await assert.rejects(
    () => invalidPending.validate(),
    /Completed reports must have a final human assessment/
  );
  await assert.rejects(
    () => missingMetadata.validate(),
    /Completed reports must have reviewer metadata/
  );
  await validCompleted.validate();
});

test("Report defines unique and query-supporting indexes", () => {
  const indexes = Report.schema.indexes();

  const ticketIndex = indexes.find(
    ([fields, options]) =>
      fields.ticketNumber === 1 && options.unique === true
  );
  const userAnalysisIndex = indexes.find(
    ([fields, options]) =>
      fields.user === 1 &&
      fields.analysis === 1 &&
      options.unique === true
  );
  const ownerHistoryIndex = indexes.find(
    ([fields]) =>
      fields.user === 1 &&
      fields.createdAt === -1 &&
      fields._id === -1
  );
  const reviewQueueIndex = indexes.find(
    ([fields]) =>
      fields.status === 1 &&
      fields.priority === -1 &&
      fields.createdAt === 1 &&
      fields._id === 1
  );

  assert.ok(ticketIndex);
  assert.ok(userAnalysisIndex);
  assert.ok(ownerHistoryIndex);
  assert.ok(reviewQueueIndex);
});

test("ReportMessage defines the approved fields and chronological index", async () => {
  assert.equal(
    ReportMessage.collection.collectionName,
    "reportMessages"
  );

  const message = new ReportMessage({
    report: createObjectId(),
    sender: createObjectId(),
    senderRole: "staff",
    message: "  Where did you receive this link?  "
  });

  assert.equal(
    message.message,
    "Where did you receive this link?"
  );
  await message.validate();

  const invalidRole = new ReportMessage({
    report: createObjectId(),
    sender: createObjectId(),
    senderRole: "owner",
    message: "Context"
  });
  const emptyMessage = new ReportMessage({
    report: createObjectId(),
    sender: createObjectId(),
    senderRole: "user",
    message: "   "
  });

  await assertValidationFails(invalidRole, "senderRole");
  await assertValidationFails(emptyMessage, "message");

  const threadIndex = findIndex(ReportMessage.schema, {
    report: 1,
    createdAt: 1,
    _id: 1
  });

  assert.ok(threadIndex);
});

test("ReportMessage marks identity and content fields as immutable", () => {
  for (const field of [
    "report",
    "sender",
    "senderRole",
    "message"
  ]) {
    assert.equal(
      ReportMessage.schema.path(field).options.immutable,
      true
    );
  }
});

test("ReportTicketCounter has the approved singleton structure", async () => {
  assert.equal(
    ReportTicketCounter.collection.collectionName,
    "reportTicketCounters"
  );
  assert.equal(
    ReportTicketCounter.schema.path("_id").instance,
    "String"
  );
  assert.equal(
    ReportTicketCounter.schema.path("sequence").options.default,
    0
  );
  assert.equal(
    ReportTicketCounter.schema.path("sequence").options.min,
    0
  );

  const invalidSequence = new ReportTicketCounter({
    _id: COUNTER_ID,
    sequence: 1.5
  });

  await assertValidationFails(invalidSequence, "sequence");
});

test("ticket formatting uses the exact six-digit format", () => {
  assert.equal(
    TICKET_NUMBER_PATTERN.toString(),
    "/^PG-\\d{4}-\\d{6}$/"
  );

  const ticketNumber = formatTicketNumber(
    1,
    new Date("2026-12-31T23:59:59.999Z")
  );

  assert.equal(ticketNumber, "PG-2026-000001");
  assert.equal(TICKET_NUMBER_PATTERN.test(ticketNumber), true);
  assert.equal(ticketNumber.includes("UTC"), false);
});

test("ticket formatting uses the UTC year at the year boundary", () => {
  assert.equal(
    formatTicketNumber(
      123,
      new Date("2026-12-31T23:59:59.999Z")
    ),
    "PG-2026-000123"
  );
  assert.equal(
    formatTicketNumber(
      124,
      new Date("2027-01-01T00:00:00.000Z")
    ),
    "PG-2027-000124"
  );
});

test("ticket allocation uses one global sequence across years", async () => {
  const counterModel = createAtomicCounterModel();

  const firstTicket = await allocateTicketNumber({
    counterModel,
    createdAt: new Date("2026-12-31T23:59:59.999Z")
  });
  const secondTicket = await allocateTicketNumber({
    counterModel,
    createdAt: new Date("2027-01-01T00:00:00.000Z")
  });

  assert.equal(firstTicket, "PG-2026-000001");
  assert.equal(secondTicket, "PG-2027-000002");
  assert.equal(counterModel.sequence, 2);
});

test("concurrent atomic allocations produce unique tickets", async () => {
  const counterModel = createAtomicCounterModel();
  const createdAt = new Date("2026-06-01T00:00:00.000Z");

  const tickets = await Promise.all(
    Array.from({ length: 25 }, () =>
      allocateTicketNumber({ counterModel, createdAt })
    )
  );

  assert.equal(new Set(tickets).size, tickets.length);
  assert.deepEqual(
    tickets.map((ticket) => Number(ticket.slice(-6))).sort(
      (left, right) => left - right
    ),
    Array.from({ length: 25 }, (_, index) => index + 1)
  );
  assert.equal(counterModel.sequence, 25);
  assert.equal(
    tickets.every((ticket) => TICKET_NUMBER_PATTERN.test(ticket)),
    true
  );
});

test("ticket allocation allows non-contiguous sequence gaps", async () => {
  const counterModel = createAtomicCounterModel({
    initialSequence: 1,
    increment: 2
  });

  const firstTicket = await allocateTicketNumber({
    counterModel,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const secondTicket = await allocateTicketNumber({
    counterModel,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(firstTicket, "PG-2026-000003");
  assert.equal(secondTicket, "PG-2026-000005");
  assert.equal(counterModel.sequence, 5);
});

test("ticket allocation retries an initial counter duplicate safely", async () => {
  const counterModel = createAtomicCounterModel({
    duplicateFirstAttempt: true
  });

  const ticketNumber = await allocateTicketNumber({
    counterModel,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(ticketNumber, "PG-2026-000001");
  assert.equal(counterModel.calls, 2);
});

test("ticket allocation fails safely above the six-digit limit", async () => {
  const counterModel = createAtomicCounterModel({
    initialSequence: MAX_TICKET_SEQUENCE
  });

  await assert.rejects(
    () =>
      allocateTicketNumber({
        counterModel,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }),
    (error) => {
      assert.ok(error instanceof TicketNumberOverflowError);
      assert.equal(
        error.code,
        "REPORT_TICKET_SEQUENCE_EXHAUSTED"
      );
      return true;
    }
  );

  assert.throws(
    () =>
      formatTicketNumber(
        MAX_TICKET_SEQUENCE + 1,
        new Date("2026-01-01T00:00:00.000Z")
      ),
    TicketNumberOverflowError
  );
});
