const mongoose = require("mongoose");

const Analysis = require("../models/Analysis");
const Report = require("../models/Report");
const ReportMessage = require("../models/ReportMessage");
const User = require("../models/User");
const {
  allocateTicketNumber
} = require("./reportingTicket.service");
const {
  toAssigneeCandidateDto,
  toITReviewReportDto,
  toITReviewReportMessageDto,
  toStudentReportDto,
  toStudentReportMessageDto
} = require("./reporting.dto");

const UNFINISHED_STATUSES = ["submitted", "under_review"];
const FINAL_ASSESSMENTS = new Set([
  "phishing",
  "suspicious",
  "no_threat_identified"
]);
const REVIEWER_ROLES = new Set(["staff", "admin"]);
const MESSAGE_ROLES = new Set(["user", "staff", "admin"]);
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const REPORTING_ERROR_CODES = Object.freeze({
  NOT_FOUND: "REPORTING_NOT_FOUND",
  DUPLICATE_REPORT: "REPORTING_DUPLICATE_REPORT",
  CONFLICT: "REPORTING_CONFLICT",
  INVALID_ASSIGNEE: "REPORTING_INVALID_ASSIGNEE",
  FORBIDDEN: "REPORTING_FORBIDDEN",
  INVALID_ACTOR: "REPORTING_INVALID_ACTOR",
  INVALID_ASSESSMENT: "REPORTING_INVALID_ASSESSMENT"
});

class ReportingServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ReportingServiceError";
    this.code = code;
    this.status = status;
  }
}

function createServiceError(code, message, status) {
  return new ReportingServiceError(code, message, status);
}

function notFound(message) {
  return createServiceError(
    REPORTING_ERROR_CODES.NOT_FOUND,
    message,
    404
  );
}

function duplicateReport() {
  return createServiceError(
    REPORTING_ERROR_CODES.DUPLICATE_REPORT,
    "A report already exists for this analysis",
    409
  );
}

function conflict(message) {
  return createServiceError(
    REPORTING_ERROR_CODES.CONFLICT,
    message,
    409
  );
}

function invalidAssignee(message) {
  return createServiceError(
    REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
    message,
    400
  );
}

function forbidden(message) {
  return createServiceError(
    REPORTING_ERROR_CODES.FORBIDDEN,
    message,
    403
  );
}

function invalidActor() {
  return createServiceError(
    REPORTING_ERROR_CODES.INVALID_ACTOR,
    "Authenticated reporting actor is invalid",
    403
  );
}

function invalidAssessment() {
  return createServiceError(
    REPORTING_ERROR_CODES.INVALID_ASSESSMENT,
    "A final human assessment is required",
    400
  );
}

function isObjectIdLike(value) {
  if (value && typeof value.toHexString === "function") {
    return true;
  }

  return (
    typeof value === "string" &&
    OBJECT_ID_PATTERN.test(value) &&
    mongoose.Types.ObjectId.isValid(value)
  );
}

function idsEqual(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }

  return String(left) === String(right);
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function isReportDuplicateKeyError(error) {
  const keyPattern = error?.keyPattern;

  if (!keyPattern) {
    return true;
  }

  return Boolean(
    keyPattern.user ||
    keyPattern.analysis
  );
}

function resolveDependencies(options = {}) {
  const models = options.models || {};

  return {
    Analysis: models.Analysis || options.Analysis || Analysis,
    Report: models.Report || options.Report || Report,
    ReportMessage:
      models.ReportMessage ||
      options.ReportMessage ||
      ReportMessage,
    User: models.User || options.User || User,
    allocateTicketNumber:
      options.allocateTicketNumber ||
      options.ticketAllocator ||
      allocateTicketNumber
  };
}

function applySort(query, sort) {
  return query && typeof query.sort === "function"
    ? query.sort(sort)
    : query;
}

function applySelect(query, projection) {
  return query && typeof query.select === "function"
    ? query.select(projection)
    : query;
}

function applyPopulate(query, populations) {
  let populatedQuery = query;

  for (const [path, fields] of populations) {
    if (
      populatedQuery &&
      typeof populatedQuery.populate === "function"
    ) {
      populatedQuery = populatedQuery.populate(path, fields);
    }
  }

  return populatedQuery;
}

function applyLean(query) {
  return query && typeof query.lean === "function"
    ? query.lean()
    : query;
}

const REPORT_PROJECTION = {
  _id: 1,
  ticketNumber: 1,
  analysis: 1,
  analysisSnapshot: 1,
  reason: 1,
  details: 1,
  status: 1,
  priority: 1,
  assignedTo: 1,
  assessment: 1,
  reviewerNote: 1,
  reviewedBy: 1,
  reviewedAt: 1,
  createdAt: 1,
  updatedAt: 1
};

const IT_REPORT_PROJECTION = {
  ...REPORT_PROJECTION,
  user: 1
};

const STUDENT_REPORT_POPULATIONS = [
  ["assignedTo", "name role"],
  ["reviewedBy", "name role"]
];

const IT_REPORT_POPULATIONS = [
  ["user", "name email"],
  ["assignedTo", "name email role"],
  ["reviewedBy", "name email role"]
];

const MESSAGE_PROJECTION = {
  _id: 1,
  report: 1,
  sender: 1,
  senderRole: 1,
  message: 1,
  createdAt: 1
};

const MESSAGE_POPULATIONS = [["sender", "name"]];

function toAnalysisSnapshot(analysis) {
  const indicators = Array.isArray(analysis?.indicators)
    ? [...analysis.indicators]
    : [];

  return {
    url: analysis?.url,
    risk: analysis?.risk,
    score: analysis?.score,
    indicators
  };
}

async function findOwnedAnalysis(deps, analysisId, userId) {
  const query = deps.Analysis.findOne({
    _id: analysisId,
    user: userId
  });

  return applyLean(
    applySelect(query, {
      _id: 1,
      url: 1,
      risk: 1,
      score: 1,
      indicators: 1
    })
  );
}

async function findExistingReport(deps, userId, analysisId) {
  const query = deps.Report.findOne({
    user: userId,
    analysis: analysisId
  });

  return applyLean(applySelect(query, { _id: 1 }));
}

async function findOwnedReport(deps, reportId, userId) {
  const query = deps.Report.findOne({
    _id: reportId,
    user: userId
  });

  return applyLean(
    applyPopulate(
      applySelect(query, REPORT_PROJECTION),
      STUDENT_REPORT_POPULATIONS
    )
  );
}

async function findOwnedReportState(deps, reportId, userId) {
  const query = deps.Report.findOne({
    _id: reportId,
    user: userId
  });

  return applyLean(
    applySelect(query, {
      _id: 1,
      status: 1,
      assignedTo: 1
    })
  );
}

async function findReportState(deps, reportId) {
  const query = deps.Report.findById(reportId);

  return applyLean(
    applySelect(query, {
      _id: 1,
      status: 1,
      assignedTo: 1
    })
  );
}

async function findITReport(deps, reportId) {
  const query = deps.Report.findById(reportId);

  return applyLean(
    applyPopulate(
      applySelect(query, IT_REPORT_PROJECTION),
      IT_REPORT_POPULATIONS
    )
  );
}

async function findMessages(deps, reportId) {
  let query = deps.ReportMessage.find({ report: reportId });
  query = applySort(query, { createdAt: 1, _id: 1 });
  query = applySelect(query, MESSAGE_PROJECTION);

  return applyLean(
    applyPopulate(query, MESSAGE_POPULATIONS)
  );
}

async function findMessageById(deps, messageId) {
  const query = deps.ReportMessage.findById(messageId);
  const selectedQuery = applySelect(query, MESSAGE_PROJECTION);

  return applyLean(
    applyPopulate(selectedQuery, MESSAGE_POPULATIONS)
  );
}

async function getPopulatedMessage(deps, message) {
  const messageId = message?._id ?? message?.id;

  if (messageId) {
    const populated = await findMessageById(deps, messageId);

    if (populated) {
      return populated;
    }
  }

  return message;
}

async function findAssignmentTarget(deps, assignedTo) {
  if (!isObjectIdLike(assignedTo)) {
    throw notFound("Assignment target not found");
  }

  let target;

  try {
    const query = deps.User.findById(assignedTo);
    target = await applyLean(
      applySelect(query, {
        _id: 1,
        name: 1,
        email: 1,
        role: 1,
        isActive: 1
      })
    );
  } catch (error) {
    if (error?.name === "CastError") {
      throw notFound("Assignment target not found");
    }

    throw error;
  }

  if (!target) {
    throw notFound("Assignment target not found");
  }

  if (!target.isActive || !REVIEWER_ROLES.has(target.role)) {
    throw invalidAssignee(
      "Assignment target must be an active staff or admin account"
    );
  }

  return target;
}

function assertMessageActorRole(actorRole) {
  if (!MESSAGE_ROLES.has(actorRole)) {
    throw invalidActor();
  }
}

async function classifyConditionalMutationFailure(
  deps,
  reportId,
  message
) {
  const existing = await findReportState(deps, reportId);

  if (!existing) {
    throw notFound("Report not found");
  }

  throw conflict(message);
}

async function runConditionalReportUpdate(
  deps,
  {
    reportId,
    filter,
    update,
    conflictMessage
  }
) {
  const query = deps.Report.findOneAndUpdate(
    filter,
    update,
    {
      new: true,
      runValidators: true
    }
  );

  const updated = await applyLean(
    applyPopulate(
      applySelect(query, IT_REPORT_PROJECTION),
      IT_REPORT_POPULATIONS
    )
  );

  if (updated) {
    return updated;
  }

  await classifyConditionalMutationFailure(
    deps,
    reportId,
    conflictMessage
  );
}

function buildReviewQueuePipeline(userCollectionName = "users") {
  const userProjection = {
    $project: {
      _id: 1,
      name: 1,
      email: 1,
      role: 1
    }
  };

  return [
    {
      $set: {
        reportingWorkflowRank: {
          $cond: [
            { $eq: ["$status", "completed"] },
            1,
            0
          ]
        },
        reportingPriorityRank: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$priority", "high"] },
                then: 0
              },
              {
                case: { $eq: ["$priority", "normal"] },
                then: 1
              },
              {
                case: { $eq: ["$priority", "low"] },
                then: 2
              }
            ],
            default: 3
          }
        }
      }
    },
    {
      $sort: {
        reportingWorkflowRank: 1,
        reportingPriorityRank: 1,
        createdAt: 1,
        _id: 1
      }
    },
    {
      $lookup: {
        from: userCollectionName,
        localField: "user",
        foreignField: "_id",
        as: "reporterDocuments",
        pipeline: [userProjection]
      }
    },
    {
      $lookup: {
        from: userCollectionName,
        localField: "assignedTo",
        foreignField: "_id",
        as: "assignedToDocuments",
        pipeline: [userProjection]
      }
    },
    {
      $lookup: {
        from: userCollectionName,
        localField: "reviewedBy",
        foreignField: "_id",
        as: "reviewedByDocuments",
        pipeline: [userProjection]
      }
    },
    {
      $set: {
        reporter: {
          $arrayElemAt: ["$reporterDocuments", 0]
        },
        assignedTo: {
          $arrayElemAt: ["$assignedToDocuments", 0]
        },
        reviewedBy: {
          $arrayElemAt: ["$reviewedByDocuments", 0]
        }
      }
    },
    {
      $project: {
        _id: 1,
        ticketNumber: 1,
        analysis: 1,
        analysisSnapshot: 1,
        reason: 1,
        details: 1,
        status: 1,
        priority: 1,
        assessment: 1,
        reviewerNote: 1,
        reviewedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        reporter: 1,
        assignedTo: 1,
        reviewedBy: 1
      }
    }
  ];
}

async function createReport(
  {
    userId,
    analysisId,
    reason,
    details,
    models: inlineModels,
    allocateTicketNumber: inlineAllocateTicketNumber,
    ticketAllocator: inlineTicketAllocator,
    ...inlineOptions
  } = {},
  options = {}
) {
  const deps = resolveDependencies({
    ...inlineOptions,
    ...options,
    models: options.models || inlineModels,
    allocateTicketNumber:
      options.allocateTicketNumber ||
      inlineAllocateTicketNumber ||
      inlineTicketAllocator
  });
  const analysis = await findOwnedAnalysis(
    deps,
    analysisId,
    userId
  );

  if (!analysis) {
    throw notFound("Analysis not found");
  }

  const existingReport = await findExistingReport(
    deps,
    userId,
    analysisId
  );

  if (existingReport) {
    throw duplicateReport();
  }

  const createdAt = new Date();
  const ticketNumber = await deps.allocateTicketNumber({
    createdAt
  });

  try {
    const report = await deps.Report.create({
      ticketNumber,
      user: userId,
      analysis: analysisId,
      analysisSnapshot: toAnalysisSnapshot(analysis),
      reason,
      details: details ?? null,
      status: "submitted",
      priority: "normal",
      assignedTo: null,
      assessment: "pending",
      reviewerNote: null,
      reviewedBy: null,
      reviewedAt: null
    });

    return toStudentReportDto(report);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      if (isReportDuplicateKeyError(error)) {
        throw duplicateReport();
      }

      throw conflict(
        "Report could not be created because a unique value was already in use"
      );
    }

    throw error;
  }
}

async function getOwnReports(userId, options = {}) {
  const deps = resolveDependencies(options);
  let query = deps.Report.find({ user: userId });

  query = applySort(query, {
    createdAt: -1,
    _id: -1
  });

  query = applySelect(query, REPORT_PROJECTION);
  query = applyPopulate(query, STUDENT_REPORT_POPULATIONS);
  const reports = await applyLean(query);

  return reports.map(toStudentReportDto);
}

async function getOwnReport(
  userId,
  reportId,
  options = {}
) {
  const deps = resolveDependencies(options);
  const report = await findOwnedReport(
    deps,
    reportId,
    userId
  );

  if (!report) {
    throw notFound("Report not found");
  }

  return toStudentReportDto(report);
}

async function getOwnReportMessages(
  userId,
  reportId,
  options = {}
) {
  const deps = resolveDependencies(options);
  const report = await findOwnedReportState(
    deps,
    reportId,
    userId
  );

  if (!report) {
    throw notFound("Report not found");
  }

  const messages = await findMessages(deps, reportId);

  return messages.map(toStudentReportMessageDto);
}

async function createOwnReportMessage(
  {
    userId,
    reportId,
    message,
    actorRole
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);
  assertMessageActorRole(actorRole);

  const report = await findOwnedReportState(
    deps,
    reportId,
    userId
  );

  if (!report) {
    throw notFound("Report not found");
  }

  if (!UNFINISHED_STATUSES.includes(report.status)) {
    throw conflict("Messages cannot be added after completion");
  }

  const createdMessage = await deps.ReportMessage.create({
    report: reportId,
    sender: userId,
    senderRole: actorRole,
    message
  });

  const populatedMessage = await getPopulatedMessage(
    deps,
    createdMessage
  );

  return toStudentReportMessageDto(populatedMessage);
}

async function getReviewQueue(options = {}) {
  const deps = resolveDependencies(options);
  const userCollectionName =
    options.userCollectionName ||
    deps.User.collection?.name ||
    "users";
  const pipeline = buildReviewQueuePipeline(
    userCollectionName
  );
  const reports = await deps.Report.aggregate(pipeline);

  return reports.map(toITReviewReportDto);
}

async function getReviewReport(reportId, options = {}) {
  const deps = resolveDependencies(options);
  const report = await findITReport(deps, reportId);

  if (!report) {
    throw notFound("Report not found");
  }

  return toITReviewReportDto(report);
}

async function getReviewReportMessages(
  reportId,
  options = {}
) {
  const deps = resolveDependencies(options);
  const report = await findReportState(deps, reportId);

  if (!report) {
    throw notFound("Report not found");
  }

  const messages = await findMessages(deps, reportId);

  return messages.map(toITReviewReportMessageDto);
}

async function createReviewReportMessage(
  {
    reportId,
    actorId,
    actorRole,
    message
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);
  assertMessageActorRole(actorRole);

  const report = await findReportState(deps, reportId);

  if (!report) {
    throw notFound("Report not found");
  }

  if (!UNFINISHED_STATUSES.includes(report.status)) {
    throw conflict("Messages cannot be added after completion");
  }

  const createdMessage = await deps.ReportMessage.create({
    report: reportId,
    sender: actorId,
    senderRole: actorRole,
    message
  });

  const populatedMessage = await getPopulatedMessage(
    deps,
    createdMessage
  );

  return toITReviewReportMessageDto(populatedMessage);
}

async function claimReviewReport(
  {
    reportId,
    actorId
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);
  const updatedReport = await runConditionalReportUpdate(deps, {
    reportId,
    filter: {
      _id: reportId,
      status: { $in: UNFINISHED_STATUSES },
      assignedTo: null
    },
    update: {
      $set: {
        assignedTo: actorId
      }
    },
    conflictMessage: "Report is already assigned or completed"
  });

  return toITReviewReportDto(updatedReport);
}

async function assignReviewReport(
  {
    reportId,
    assignedTo
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);
  const report = await findReportState(deps, reportId);

  if (!report) {
    throw notFound("Report not found");
  }

  if (!UNFINISHED_STATUSES.includes(report.status)) {
    throw conflict("Report assignment is not allowed after completion");
  }

  await findAssignmentTarget(deps, assignedTo);

  const updatedReport = await runConditionalReportUpdate(deps, {
    reportId,
    filter: {
      _id: reportId,
      status: { $in: UNFINISHED_STATUSES }
    },
    update: {
      $set: {
        assignedTo
      }
    },
    conflictMessage: "Report is already completed"
  });

  return toITReviewReportDto(updatedReport);
}

async function getAssignmentCandidates(options = {}) {
  const deps = resolveDependencies(options);
  let query = deps.User.find({
    isActive: true,
    role: { $in: ["staff", "admin"] }
  });

  query = applySort(query, {
    name: 1,
    email: 1,
    _id: 1
  });
  query = applySelect(query, {
    _id: 1,
    name: 1,
    email: 1,
    role: 1
  });

  const users = await applyLean(query);

  return users.map(toAssigneeCandidateDto);
}

async function updateReviewReportPriority(
  {
    reportId,
    priority
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);
  const updatedReport = await runConditionalReportUpdate(deps, {
    reportId,
    filter: {
      _id: reportId,
      status: { $in: UNFINISHED_STATUSES }
    },
    update: {
      $set: {
        priority
      }
    },
    conflictMessage: "Report priority cannot be changed after completion"
  });

  return toITReviewReportDto(updatedReport);
}

async function startReviewReport(reportId, options = {}) {
  const deps = resolveDependencies(options);
  const updatedReport = await runConditionalReportUpdate(deps, {
    reportId,
    filter: {
      _id: reportId,
      status: "submitted"
    },
    update: {
      $set: {
        status: "under_review"
      }
    },
    conflictMessage: "Report is already under review or completed"
  });

  return toITReviewReportDto(updatedReport);
}

async function completeReviewReport(
  {
    reportId,
    actorId,
    actorRole,
    assessment,
    reviewerNote
  } = {},
  options = {}
) {
  const deps = resolveDependencies(options);

  if (!REVIEWER_ROLES.has(actorRole)) {
    throw forbidden("Only staff or admin may complete a report");
  }

  if (!FINAL_ASSESSMENTS.has(assessment)) {
    throw invalidAssessment();
  }

  const report = await findReportState(deps, reportId);

  if (!report) {
    throw notFound("Report not found");
  }

  if (!UNFINISHED_STATUSES.includes(report.status)) {
    throw conflict("Report is already completed");
  }

  if (!report.assignedTo) {
    throw conflict("Report must be assigned before completion");
  }

  if (
    actorRole === "staff" &&
    !idsEqual(report.assignedTo, actorId)
  ) {
    throw forbidden(
      "Only the assigned staff member may complete this report"
    );
  }

  const filter = {
    _id: reportId,
    status: { $in: UNFINISHED_STATUSES },
    assignedTo: { $ne: null }
  };

  if (actorRole === "staff") {
    filter.assignedTo = actorId;
  }

  const updatedReport = await runConditionalReportUpdate(deps, {
    reportId,
    filter,
    update: {
      $set: {
        status: "completed",
        assessment,
        reviewerNote: reviewerNote ?? null,
        reviewedBy: actorId,
        reviewedAt: new Date()
      }
    },
    conflictMessage: "Report is already completed"
  });

  return toITReviewReportDto(updatedReport);
}

module.exports = {
  REPORTING_ERROR_CODES,
  ReportingServiceError,
  buildReviewQueuePipeline,
  createReport,
  getOwnReports,
  getOwnReport,
  getOwnReportMessages,
  createOwnReportMessage,
  getReviewQueue,
  getReviewReport,
  getReviewReportMessages,
  createReviewReportMessage,
  claimReviewReport,
  assignReviewReport,
  getAssignmentCandidates,
  updateReviewReportPriority,
  startReviewReport,
  completeReviewReport
};
