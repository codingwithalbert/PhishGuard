const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const integrationEnabled =
  process.env.REPORTING_INTEGRATION === "1";

if (!integrationEnabled) {
  test(
    "Reporting MongoDB integration verification is opt-in",
    { skip: true },
    () => {}
  );
} else {
  require("dotenv").config({ quiet: true });

  const crypto = require("node:crypto");
  const mongoose = require("mongoose");
  const bcrypt = require("bcrypt");

  // Prevent model initialization from creating or changing indexes. This test
  // only inspects indexes that already exist in the configured database.
  mongoose.set("autoIndex", false);

  const Analysis = require("../src/models/Analysis");
  const Report = require("../src/models/Report");
  const ReportMessage = require("../src/models/ReportMessage");
  const ReportTicketCounter = require("../src/models/ReportTicketCounter");
  const User = require("../src/models/User");
  const {
    COUNTER_ID,
    TICKET_NUMBER_PATTERN,
    allocateTicketNumber
  } = require("../src/services/reportingTicket.service");
  const {
    REPORTING_ERROR_CODES,
    assignReviewReport,
    claimReviewReport,
    completeReviewReport,
    createOwnReportMessage,
    createReport,
    createReviewReportMessage,
    getAssignmentCandidates,
    getOwnReport,
    getOwnReportMessages,
    getOwnReports,
    getReviewQueue,
    getReviewReport,
    getReviewReportMessages,
    startReviewReport,
    updateReviewReportPriority
  } = require("../src/services/reporting.service");

  const runMarker = crypto.randomUUID();
  const tracked = {
    users: new Set(),
    analyses: new Set(),
    reports: new Set(),
    messages: new Set()
  };

  let connectionOpened = false;
  let passwordHash;
  let reporter;
  let otherOwner;
  let staffA;
  let staffB;
  let adminReviewer;
  let normalTarget;
  let inactiveStaff;
  let primaryReport;
  let sourceReport;
  let claimReport;
  let sourceAnalysis;

  function track(setName, id) {
    tracked[setName].add(String(id));
  }

  function testEmail(label) {
    return `reporting-integration-${runMarker}-${label}@example.invalid`;
  }

  function testUrl(label) {
    return `https://reporting-integration-${runMarker}-${label}.example`;
  }

  function snapshotFor(analysis) {
    return {
      url: analysis.url,
      risk: analysis.risk,
      score: analysis.score,
      indicators: [...analysis.indicators]
    };
  }

  async function createTrackedUser({
    name,
    email,
    role,
    isActive = true
  }) {
    const userId = new mongoose.Types.ObjectId();
    track("users", userId);

    const user = await User.create({
      _id: userId,
      name,
      email,
      password: passwordHash,
      role,
      isActive
    });

    return user;
  }

  async function createTrackedAnalysis({
    user,
    label,
    url = testUrl(label),
    risk = "low",
    score = 0,
    indicators = []
  }) {
    const analysisId = new mongoose.Types.ObjectId();
    track("analyses", analysisId);

    const analysis = await Analysis.create({
      _id: analysisId,
      user: user._id,
      url,
      risk,
      score,
      indicators,
      status: "active"
    });

    return analysis;
  }

  async function createReportThroughService({
    user,
    analysis,
    reason = "suspected_phishing",
    details = null
  }) {
    const dto = await createReport({
      userId: user._id,
      analysisId: analysis._id,
      reason,
      details
    });

    track("reports", dto.id);
    const stored = await Report.findById(dto.id).lean();
    return { dto, stored };
  }

  async function createReportFixture({
    user,
    analysis,
    status = "submitted",
    priority = "normal",
    assignedTo = null,
    assessment = "pending",
    reviewedBy = null,
    reviewedAt = null,
    createdAt = new Date()
  }) {
    const reportId = new mongoose.Types.ObjectId();
    track("reports", reportId);

    const ticketNumber = await allocateTicketNumber({ createdAt });
    const report = await Report.create({
      _id: reportId,
      ticketNumber,
      user: user._id,
      analysis: analysis._id,
      analysisSnapshot: snapshotFor(analysis),
      reason: "suspected_phishing",
      details: null,
      status,
      priority,
      assignedTo,
      assessment,
      reviewerNote:
        status === "completed" ? "Integration final note" : null,
      reviewedBy,
      reviewedAt
    });

    await Report.collection.updateOne(
      { _id: report._id },
      { $set: { createdAt } }
    );

    return report;
  }

  async function createMessageThroughService({
    report,
    sender,
    actorRole,
    message,
    createdAt
  }) {
    const dto =
      actorRole === "user"
        ? await createOwnReportMessage({
            userId: sender._id,
            reportId: report._id,
            message,
            actorRole
          })
        : await createReviewReportMessage({
            reportId: report._id,
            actorId: sender._id,
            actorRole,
            message
          });

    track("messages", dto.id);
    await ReportMessage.collection.updateOne(
      { _id: dto.id },
      { $set: { createdAt } }
    );

    return dto;
  }

  function sameIndexKey(actual, expected) {
    const actualEntries = Object.entries(actual || {}).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    const expectedEntries = Object.entries(expected).sort(
      ([left], [right]) => left.localeCompare(right)
    );

    return (
      actualEntries.length === expectedEntries.length &&
      actualEntries.every(
        ([field, direction], index) =>
          field === expectedEntries[index][0] &&
          direction === expectedEntries[index][1]
      )
    );
  }

  function requireIndex(indexes, expectedKey, expectedUnique, label) {
    const matchingIndexes = indexes.filter((candidate) =>
      sameIndexKey(candidate.key, expectedKey)
    );
    const index = matchingIndexes.find(
      (candidate) =>
        expectedUnique === undefined ||
        Boolean(candidate.unique) === expectedUnique
    );

    assert.ok(
      index,
      `Required existing MongoDB index missing or incompatible: ${label}`
    );

    if (expectedUnique !== undefined) {
      assert.equal(
        Boolean(index.unique),
        expectedUnique,
        `Existing MongoDB index has incompatible uniqueness: ${label}`
      );
    }

    return index;
  }

  async function readExistingIndexes(model, label) {
    try {
      return await model.collection.indexes();
    } catch {
      throw new Error(
        `Unable to inspect existing MongoDB indexes for ${label}; required Reporting indexes must already exist.`
      );
    }
  }

  async function assertExistingReportingIndexes() {
    const [reportIndexes, messageIndexes, counterIndexes] =
      await Promise.all([
        readExistingIndexes(Report, "reports"),
        readExistingIndexes(ReportMessage, "reportMessages"),
        readExistingIndexes(
          ReportTicketCounter,
          "reportTicketCounters"
        )
      ]);

    requireIndex(
      reportIndexes,
      { ticketNumber: 1 },
      true,
      "reports.ticketNumber unique"
    );
    requireIndex(
      reportIndexes,
      { user: 1, analysis: 1 },
      true,
      "reports user+analysis unique"
    );
    requireIndex(
      reportIndexes,
      { user: 1, createdAt: -1, _id: -1 },
      false,
      "reports owner history"
    );
    requireIndex(
      reportIndexes,
      { status: 1, priority: -1, createdAt: 1, _id: 1 },
      false,
      "reports review queue"
    );
    requireIndex(
      reportIndexes,
      { analysis: 1 },
      false,
      "reports analysis reference"
    );
    requireIndex(
      messageIndexes,
      { report: 1, createdAt: 1, _id: 1 },
      false,
      "reportMessages chronological thread"
    );
    requireIndex(
      counterIndexes,
      { _id: 1 },
      undefined,
      "reportTicketCounters singleton identity"
    );
  }

  async function assertServiceError(promise, code, status) {
    await assert.rejects(
      promise,
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      }
    );
  }

  function assertNoSensitiveFields(value) {
    const serialized = JSON.stringify(value);

    for (const forbidden of [
      "password",
      "passwordHash",
      "token",
      "isActive",
      "__v"
    ]) {
      assert.equal(
        serialized.includes(`"${forbidden}"`),
        false,
        `DTO leaked ${forbidden}`
      );
    }
  }

  async function cleanupTrackedData() {
    const reportIds = [...tracked.reports];
    const messageIds = [...tracked.messages];
    const analysisIds = [...tracked.analyses];
    const userIds = [...tracked.users];
    const cleanupErrors = [];

    async function attempt(label, operation) {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`);
      }
    }

    if (messageIds.length > 0) {
      await attempt("ReportMessage cleanup", () =>
        ReportMessage.deleteMany({
          _id: { $in: messageIds }
        })
      );
    }

    if (reportIds.length > 0) {
      await attempt("Report cleanup", () =>
        Report.deleteMany({
          _id: { $in: reportIds }
        })
      );
    }

    if (analysisIds.length > 0) {
      await attempt("Analysis cleanup", () =>
        Analysis.deleteMany({
          _id: { $in: analysisIds }
        })
      );
    }

    if (userIds.length > 0) {
      await attempt("User cleanup", () =>
        User.deleteMany({
          _id: { $in: userIds }
        })
      );
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `Tracked integration-test cleanup failed: ${cleanupErrors.join(
          "; "
        )}`
      );
    }
  }

  before(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not configured");
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        autoIndex: false
      });
    } catch {
      throw new Error("MongoDB integration connection failed");
    }

    connectionOpened = true;

    await assertExistingReportingIndexes();

    const randomPassword = crypto.randomBytes(32).toString("hex");
    passwordHash = await bcrypt.hash(randomPassword, 12);

    reporter = await createTrackedUser({
      name: "Reporting Integration Reporter",
      email: testEmail("reporter"),
      role: "user"
    });
    otherOwner = await createTrackedUser({
      name: "Reporting Integration Other Owner",
      email: testEmail("other-owner"),
      role: "user"
    });
    staffA = await createTrackedUser({
      name: "Reporting Integration Staff A",
      email: testEmail("staff-a"),
      role: "staff"
    });
    staffB = await createTrackedUser({
      name: "Reporting Integration Staff B",
      email: testEmail("staff-b"),
      role: "staff"
    });
    adminReviewer = await createTrackedUser({
      name: "Reporting Integration Admin",
      email: testEmail("admin"),
      role: "admin"
    });
    normalTarget = await createTrackedUser({
      name: "Reporting Integration Normal Target",
      email: testEmail("normal-target"),
      role: "user"
    });
    inactiveStaff = await createTrackedUser({
      name: "Reporting Integration Inactive Staff",
      email: testEmail("inactive-staff"),
      role: "staff",
      isActive: false
    });
  });

  after(async () => {
    try {
      await cleanupTrackedData();
    } finally {
      if (
        connectionOpened &&
        mongoose.connection.readyState !== 0
      ) {
        await mongoose.disconnect();
      }
    }
  });

  test(
    "Reporting V1 works against real MongoDB and Mongoose behavior",
    async (t) => {
      await t.test(
        "real schemas and existing indexes are usable",
        async () => {
          assert.equal(Report.collection.collectionName, "reports");
          assert.equal(
            ReportMessage.collection.collectionName,
            "reportMessages"
          );
          assert.equal(
            ReportTicketCounter.collection.collectionName,
            "reportTicketCounters"
          );

          const validReport = new Report({
            ticketNumber: "PG-2026-999999",
            user: reporter._id,
            analysis: (
              await createTrackedAnalysis({
                user: reporter,
                label: "schema-report",
                risk: "low",
                score: 0,
                indicators: []
              })
            )._id,
            analysisSnapshot: {
              url: "https://schema.example",
              risk: "low",
              score: 0,
              indicators: []
            },
            reason: "other"
          });

          await validReport.validate();

          const invalidWorkflow = new Report({
            ticketNumber: "PG-2026-999998",
            user: reporter._id,
            analysis: validReport.analysis,
            analysisSnapshot: validReport.analysisSnapshot,
            reason: "other",
            status: "submitted",
            assessment: "phishing"
          });

          await assert.rejects(
            () => invalidWorkflow.validate(),
            /pending assessment/
          );

          const validMessage = new ReportMessage({
            report: validReport._id,
            sender: reporter._id,
            senderRole: "user",
            message: "Schema validation message"
          });

          await validMessage.validate();

          const counterShape = new ReportTicketCounter({
            _id: COUNTER_ID,
            sequence: 1
          });

          await counterShape.validate();
          await assertExistingReportingIndexes();
        }
      );

      await t.test(
        "real atomic ticket allocation is unique and correctly formatted",
        async () => {
          const beforeCounter =
            await ReportTicketCounter.findById(COUNTER_ID).lean();
          const createdAt = new Date("2026-12-31T23:59:59.999Z");

          const tickets = await Promise.all(
            Array.from({ length: 5 }, () =>
              allocateTicketNumber({ createdAt })
            )
          );

          assert.equal(new Set(tickets).size, tickets.length);
          assert.equal(
            tickets.every((ticket) =>
              TICKET_NUMBER_PATTERN.test(ticket)
            ),
            true
          );
          assert.equal(
            tickets.every((ticket) =>
              ticket.startsWith("PG-2026-")
            ),
            true
          );

          const afterCounter =
            await ReportTicketCounter.findById(COUNTER_ID).lean();
          const beforeSequence = beforeCounter?.sequence ?? 0;
          const allocatedMinimum = beforeSequence + tickets.length;

          assert.ok(
            afterCounter &&
              Number.isInteger(afterCounter.sequence) &&
              afterCounter.sequence >= allocatedMinimum
          );
        }
      );

      await t.test(
        "real Report creation persists the owned snapshot and unique constraint",
        async () => {
          const analysis = await createTrackedAnalysis({
            user: reporter,
            label: "primary",
            risk: "medium",
            score: 25,
            indicators: [
              "URL uses an IP address instead of a domain name"
            ]
          });
          const created = await createReportThroughService({
            user: reporter,
            analysis,
            reason: "suspected_phishing",
            details: "  Integration context  "
          });
          primaryReport = created.stored;

          assert.ok(primaryReport);
          assert.equal(
            primaryReport.ticketNumber,
            created.dto.ticketNumber
          );
          assert.deepEqual(
            primaryReport.analysisSnapshot,
            {
              url: analysis.url,
              risk: analysis.risk,
              score: analysis.score,
              indicators: analysis.indicators
            }
          );
          assert.equal(
            Object.hasOwn(
              primaryReport.analysisSnapshot,
              "findings"
            ),
            false
          );
          assert.equal(
            created.dto.analysisSnapshot.findings[0].type,
            "ip_address"
          );
          assert.equal(primaryReport.status, "submitted");
          assert.equal(primaryReport.priority, "normal");
          assert.equal(primaryReport.assignedTo, null);
          assert.equal(primaryReport.assessment, "pending");
          assert.equal(primaryReport.details, "Integration context");
          assert.equal(created.dto.details, "Integration context");
          assert.equal(
            await ReportMessage.countDocuments({
              report: primaryReport._id
            }),
            0
          );

          await assertServiceError(
            createReport({
              userId: reporter._id,
              analysisId: analysis._id,
              reason: "other"
            }),
            REPORTING_ERROR_CODES.DUPLICATE_REPORT,
            409
          );

          const duplicateTicket = await allocateTicketNumber({
            createdAt: new Date()
          });
          const duplicateReportId = new mongoose.Types.ObjectId();
          track("reports", duplicateReportId);

          await assert.rejects(
            () =>
              Report.create({
                _id: duplicateReportId,
                ticketNumber: duplicateTicket,
                user: reporter._id,
                analysis: analysis._id,
                analysisSnapshot: snapshotFor(analysis),
                reason: "other"
              }),
            (error) => {
              assert.equal(error.code, 11000);
              return true;
            }
          );

          assert.equal(
            await Report.countDocuments({
              user: reporter._id,
              analysis: analysis._id
            }),
            1
          );
        }
      );

      await t.test(
        "real ownership, population, messages, and safe DTOs work",
        async () => {
          const ownReports = await getOwnReports(reporter._id);
          assert.ok(
            ownReports.some(
              (report) => report.id === primaryReport._id.toString()
            )
          );

          const ownReport = await getOwnReport(
            reporter._id,
            primaryReport._id
          );
          assert.equal(ownReport.id, primaryReport._id.toString());
          assert.equal(ownReport.assignedTo, null);
          assertNoSensitiveFields(ownReport);

          await assertServiceError(
            getOwnReport(otherOwner._id, primaryReport._id),
            REPORTING_ERROR_CODES.NOT_FOUND,
            404
          );

          const firstMessage = await createMessageThroughService({
            report: primaryReport,
            sender: reporter,
            actorRole: "user",
            message: "First integration message",
            createdAt: new Date("2026-02-01T00:00:00.000Z")
          });
          const secondMessage = await createMessageThroughService({
            report: primaryReport,
            sender: staffA,
            actorRole: "staff",
            message: "Second integration message",
            createdAt: new Date("2026-02-02T00:00:00.000Z")
          });

          assert.equal(firstMessage.sender.role, "user");
          assert.equal(secondMessage.sender.role, "staff");

          const messages = await getOwnReportMessages(
            reporter._id,
            primaryReport._id
          );
          assert.deepEqual(
            messages.map((message) => message.id),
            [
              firstMessage.id,
              secondMessage.id
            ]
          );
          assertNoSensitiveFields(messages);

          const reviewMessages =
            await getReviewReportMessages(primaryReport._id);
          assert.equal(reviewMessages.length, 2);
          assert.equal(
            reviewMessages[1].sender.id,
            staffA._id.toString()
          );
          assertNoSensitiveFields(reviewMessages);
        }
      );

      await t.test(
        "real source Analysis deletion leaves the Report snapshot usable",
        async () => {
          const analysis = await createTrackedAnalysis({
            user: reporter,
            label: "source-deletion",
            risk: "high",
            score: 50,
            indicators: [
              "Connection does not use HTTPS"
            ]
          });
          sourceAnalysis = analysis;
          const created = await createReportThroughService({
            user: reporter,
            analysis,
            reason: "other"
          });
          sourceReport = created.stored;
          await createMessageThroughService({
            report: sourceReport,
            sender: reporter,
            actorRole: "user",
            message: "Source deletion thread message",
            createdAt: new Date("2026-02-03T00:00:00.000Z")
          });

          const deletion = await Analysis.deleteOne({
            _id: analysis._id,
            user: reporter._id
          });
          assert.equal(deletion.deletedCount, 1);
          assert.equal(
            await Analysis.exists({ _id: sourceAnalysis._id }),
            null
          );

          const survivingMessages = await getOwnReportMessages(
            reporter._id,
            sourceReport._id
          );
          assert.equal(survivingMessages.length, 1);
          assert.equal(
            survivingMessages[0].message,
            "Source deletion thread message"
          );

          const studentView = await getOwnReport(
            reporter._id,
            sourceReport._id
          );
          const itView = await getReviewReport(sourceReport._id);

          assert.equal(
            studentView.analysisSnapshot.url,
            analysis.url
          );
          assert.equal(
            studentView.analysisSnapshot.findings[0].type,
            "no_https"
          );
          assert.equal(itView.analysisSnapshot.score, 50);
          assertNoSensitiveFields(studentView);
          assertNoSensitiveFields(itView);
        }
      );

      await t.test(
        "real queue aggregation preserves semantic priority and tie ordering",
        async () => {
          const unfinishedQueueStatus = "under_review";
          const highAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "queue-high"
          });
          const normalAAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "queue-normal-a",
            url: "https://queue-normal-shared.example"
          });
          const normalBAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "queue-normal-b",
            url: "https://queue-normal-shared.example"
          });
          const normalCreatedAtOlderAnalysis =
            await createTrackedAnalysis({
              user: reporter,
              label: "queue-normal-created-at-older",
              url: "https://queue-normal-created-at-older.example"
            });
          const normalCreatedAtNewerAnalysis =
            await createTrackedAnalysis({
              user: reporter,
              label: "queue-normal-created-at-newer",
              url: "https://queue-normal-created-at-newer.example"
            });
          const lowAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "queue-low"
          });
          const completedAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "queue-completed"
          });

          const highReport = await createReportFixture({
            user: reporter,
            analysis: highAnalysis,
            status: unfinishedQueueStatus,
            priority: "high",
            createdAt: new Date("2026-03-05T00:00:00.000Z")
          });
          const normalAReport = await createReportFixture({
            user: reporter,
            analysis: normalAAnalysis,
            status: unfinishedQueueStatus,
            priority: "normal",
            createdAt: new Date("2026-03-03T00:00:00.000Z")
          });
          const normalBReport = await createReportFixture({
            user: reporter,
            analysis: normalBAnalysis,
            status: unfinishedQueueStatus,
            priority: "normal",
            createdAt: new Date("2026-03-03T00:00:00.000Z")
          });
          const normalCreatedAtOlderReport =
            await createReportFixture({
              user: reporter,
              analysis: normalCreatedAtOlderAnalysis,
              status: unfinishedQueueStatus,
              priority: "normal",
              createdAt: new Date("2026-03-01T00:00:00.000Z")
            });
          const normalCreatedAtNewerReport =
            await createReportFixture({
              user: reporter,
              analysis: normalCreatedAtNewerAnalysis,
              status: unfinishedQueueStatus,
              priority: "normal",
              createdAt: new Date("2026-03-02T00:00:00.000Z")
            });
          const lowReport = await createReportFixture({
            user: reporter,
            analysis: lowAnalysis,
            status: unfinishedQueueStatus,
            priority: "low",
            createdAt: new Date("2026-02-01T00:00:00.000Z")
          });
          const completedReport = await createReportFixture({
            user: reporter,
            analysis: completedAnalysis,
            status: "completed",
            priority: "normal",
            assignedTo: staffA._id,
            assessment: "phishing",
            reviewedBy: adminReviewer._id,
            reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z")
          });

          await assignReviewReport({
            reportId: highReport._id,
            assignedTo: staffA._id
          });

          const queue = await getReviewQueue();
          const testTickets = new Set([
            highReport.ticketNumber,
            normalAReport.ticketNumber,
            normalBReport.ticketNumber,
            normalCreatedAtOlderReport.ticketNumber,
            normalCreatedAtNewerReport.ticketNumber,
            lowReport.ticketNumber,
            completedReport.ticketNumber
          ]);
          const testQueue = queue.filter((report) =>
            testTickets.has(report.ticketNumber)
          );
          const expectedNormalTie = [
            normalAReport,
            normalBReport
          ].sort((left, right) =>
            left._id.toString().localeCompare(right._id.toString())
          );
          const createdAtTickets = new Set([
            normalCreatedAtOlderReport.ticketNumber,
            normalCreatedAtNewerReport.ticketNumber
          ]);
          const tieTickets = new Set([
            normalAReport.ticketNumber,
            normalBReport.ticketNumber
          ]);

          assert.deepEqual(
            testQueue
              .filter((report) =>
                createdAtTickets.has(report.ticketNumber)
              )
              .map((report) => report.ticketNumber),
            [
              normalCreatedAtOlderReport.ticketNumber,
              normalCreatedAtNewerReport.ticketNumber
            ]
          );
          assert.deepEqual(
            testQueue
              .filter((report) => tieTickets.has(report.ticketNumber))
              .map((report) => report.ticketNumber),
            expectedNormalTie.map(
              (report) => report.ticketNumber
            )
          );
          assert.deepEqual(
            testQueue.map((report) => report.ticketNumber),
            [
              highReport.ticketNumber,
              normalCreatedAtOlderReport.ticketNumber,
              normalCreatedAtNewerReport.ticketNumber,
              ...expectedNormalTie.map(
                (report) => report.ticketNumber
              ),
              lowReport.ticketNumber,
              completedReport.ticketNumber
            ]
          );
          assert.deepEqual(
            testQueue[0].assignedTo,
            {
              id: staffA._id.toString(),
              name: staffA.name,
              email: staffA.email,
              role: "staff"
            }
          );
          assert.deepEqual(
            testQueue.at(-1).reviewedBy,
            {
              id: adminReviewer._id.toString(),
              name: adminReviewer.name,
              email: adminReviewer.email,
              role: "admin"
            }
          );
          assertNoSensitiveFields(testQueue);
        }
      );

      await t.test(
        "real assignment, claims, workflow, and completion mutations are enforced",
        async () => {
          const claimAnalysis = await createTrackedAnalysis({
            user: reporter,
            label: "claim-completion"
          });
          const claimFixture = await createReportThroughService({
            user: reporter,
            analysis: claimAnalysis,
            reason: "other"
          });
          claimReport = claimFixture.stored;

          const claimResults = await Promise.allSettled([
            claimReviewReport({
              reportId: claimReport._id,
              actorId: staffA._id
            }),
            claimReviewReport({
              reportId: claimReport._id,
              actorId: staffB._id
            })
          ]);
          const successfulClaim = claimResults.find(
            (result) => result.status === "fulfilled"
          );
          const rejectedClaim = claimResults.find(
            (result) => result.status === "rejected"
          );

          assert.ok(successfulClaim);
          assert.ok(rejectedClaim);
          assert.equal(
            rejectedClaim.reason.code,
            REPORTING_ERROR_CODES.CONFLICT
          );

          const assignedReport = await assignReviewReport({
            reportId: primaryReport._id,
            assignedTo: staffA._id
          });
          assert.equal(
            assignedReport.assignedTo.id,
            staffA._id.toString()
          );

          const adminAssigned = await assignReviewReport({
            reportId: primaryReport._id,
            assignedTo: adminReviewer._id
          });
          assert.equal(
            adminAssigned.assignedTo.id,
            adminReviewer._id.toString()
          );

          await assertServiceError(
            assignReviewReport({
              reportId: primaryReport._id,
              assignedTo: normalTarget._id
            }),
            REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
            400
          );
          await assertServiceError(
            assignReviewReport({
              reportId: primaryReport._id,
              assignedTo: inactiveStaff._id
            }),
            REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
            400
          );
          await assertServiceError(
            assignReviewReport({
              reportId: primaryReport._id,
              assignedTo: new mongoose.Types.ObjectId()
            }),
            REPORTING_ERROR_CODES.NOT_FOUND,
            404
          );

          const priorityUpdated =
            await updateReviewReportPriority({
              reportId: primaryReport._id,
              priority: "high"
            });
          assert.equal(priorityUpdated.priority, "high");

          const started = await startReviewReport(primaryReport._id);
          assert.equal(started.status, "under_review");
          assert.equal(started.assessment, "pending");

          await assertServiceError(
            startReviewReport(primaryReport._id),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );

          const completed = await completeReviewReport({
            reportId: primaryReport._id,
            actorId: adminReviewer._id,
            actorRole: "admin",
            assessment: "phishing",
            reviewerNote: "Admin oversight completion"
          });
          assert.equal(completed.status, "completed");
          assert.equal(
            completed.reviewedBy.id,
            adminReviewer._id.toString()
          );
          assert.ok(completed.reviewedAt);

          await assertServiceError(
            updateReviewReportPriority({
              reportId: primaryReport._id,
              priority: "low"
            }),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );
          await assertServiceError(
            assignReviewReport({
              reportId: primaryReport._id,
              assignedTo: staffA._id
            }),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );
          await assertServiceError(
            startReviewReport(primaryReport._id),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );
          await assertServiceError(
            createOwnReportMessage({
              userId: reporter._id,
              reportId: primaryReport._id,
              message: "Late message",
              actorRole: "user"
            }),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );
          await assertServiceError(
            createReviewReportMessage({
              reportId: primaryReport._id,
              actorId: staffA._id,
              actorRole: "staff",
              message: "Late IT message"
            }),
            REPORTING_ERROR_CODES.CONFLICT,
            409
          );

          await assignReviewReport({
            reportId: sourceReport._id,
            assignedTo: staffA._id
          });
          const sourceCompleted = await completeReviewReport({
            reportId: sourceReport._id,
            actorId: adminReviewer._id,
            actorRole: "admin",
            assessment: "suspicious",
            reviewerNote: "  Oversight completion  "
          });
          assert.equal(sourceCompleted.status, "completed");
          assert.equal(
            sourceCompleted.reviewerNote,
            "Oversight completion"
          );
          assert.equal(
            sourceCompleted.analysisSnapshot.findings[0].type,
            "no_https"
          );
          const completedSourceMessages =
            await getOwnReportMessages(
              reporter._id,
              sourceReport._id
            );
          assert.equal(completedSourceMessages.length, 1);
          assert.equal(
            completedSourceMessages[0].message,
            "Source deletion thread message"
          );

          const winningClaim = await Report.findById(
            claimReport._id
          ).lean();
          const completionResults =
            await Promise.allSettled([
              completeReviewReport({
                reportId: claimReport._id,
                actorId: winningClaim.assignedTo,
                actorRole: "staff",
                assessment: "phishing"
              }),
              completeReviewReport({
                reportId: claimReport._id,
                actorId: winningClaim.assignedTo,
                actorRole: "staff",
                assessment: "suspicious"
              })
            ]);

          assert.equal(
            completionResults.filter(
              (result) => result.status === "fulfilled"
            ).length,
            1
          );
          assert.equal(
            completionResults.filter(
              (result) => result.status === "rejected"
            ).length,
            1
          );
          assert.equal(
            completionResults.find(
              (result) => result.status === "rejected"
            ).reason.code,
            REPORTING_ERROR_CODES.CONFLICT
          );

          const candidates = await getAssignmentCandidates();
          const testCandidateIds = new Set(
            [
              staffA._id,
              staffB._id,
              adminReviewer._id,
              normalTarget._id,
              inactiveStaff._id
            ].map((id) => id.toString())
          );
          const testCandidates = candidates.filter((candidate) =>
            testCandidateIds.has(candidate.id)
          );
          assert.deepEqual(
            testCandidates.map((candidate) => candidate.id).sort(),
            [
              staffA._id.toString(),
              staffB._id.toString(),
              adminReviewer._id.toString()
            ].sort()
          );
          assertNoSensitiveFields(testCandidates);
        }
      );
    }
  );
}
