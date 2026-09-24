const mongoose = require("mongoose");

const REPORT_REASONS = new Set([
  "suspected_phishing",
  "credential_request",
  "impersonation",
  "other"
]);

const REPORT_PRIORITIES = new Set(["low", "normal", "high"]);
const FINAL_REPORT_ASSESSMENTS = new Set([
  "phishing",
  "suspicious",
  "no_threat_identified"
]);

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function isValidMongoObjectId(value) {
  return (
    typeof value === "string" &&
    OBJECT_ID_PATTERN.test(value) &&
    mongoose.Types.ObjectId.isValid(value)
  );
}

function isBodyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasField(body, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function sendValidationError(res, error) {
  return res.status(400).json({
    success: false,
    error
  });
}

function validateBodyObject(req, res) {
  if (!isBodyObject(req.body)) {
    sendValidationError(res, "Request body must be an object");
    return false;
  }

  return true;
}

function rejectUnexpectedFields(body, allowedFields, res) {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field)
  );

  if (unexpectedFields.length > 0) {
    sendValidationError(
      res,
      `Only ${allowedFields.join(", ")} may be submitted`
    );
    return false;
  }

  return true;
}

function validateReportSubmission(req, res, next) {
  if (!validateBodyObject(req, res)) {
    return;
  }

  const allowedFields = ["analysisId", "reason", "details"];

  if (!rejectUnexpectedFields(req.body, allowedFields, res)) {
    return;
  }

  if (!hasField(req.body, "analysisId")) {
    return sendValidationError(res, "analysisId is required");
  }

  if (!isValidMongoObjectId(req.body.analysisId)) {
    return sendValidationError(
      res,
      "analysisId must be a valid ObjectId"
    );
  }

  if (!hasField(req.body, "reason")) {
    return sendValidationError(res, "reason is required");
  }

  if (
    typeof req.body.reason !== "string" ||
    !REPORT_REASONS.has(req.body.reason)
  ) {
    return sendValidationError(
      res,
      "reason must be suspected_phishing, credential_request, impersonation, or other"
    );
  }

  if (hasField(req.body, "details")) {
    if (typeof req.body.details !== "string") {
      return sendValidationError(
        res,
        "details must be a string when provided"
      );
    }

    const normalizedDetails = req.body.details.trim();

    if (normalizedDetails.length > 500) {
      return sendValidationError(
        res,
        "details must not exceed 500 characters"
      );
    }

    req.body.details =
      normalizedDetails.length > 0 ? normalizedDetails : null;
  } else {
    req.body.details = null;
  }

  return next();
}

function validateReportMessage(req, res, next) {
  if (!validateBodyObject(req, res)) {
    return;
  }

  if (!rejectUnexpectedFields(req.body, ["message"], res)) {
    return;
  }

  if (!hasField(req.body, "message")) {
    return sendValidationError(res, "message is required");
  }

  if (typeof req.body.message !== "string") {
    return sendValidationError(res, "message must be a string");
  }

  const normalizedMessage = req.body.message.trim();

  if (normalizedMessage.length === 0) {
    return sendValidationError(
      res,
      "message cannot be empty"
    );
  }

  if (normalizedMessage.length > 1000) {
    return sendValidationError(
      res,
      "message must not exceed 1000 characters"
    );
  }

  req.body.message = normalizedMessage;

  return next();
}

function validateReportPriority(req, res, next) {
  if (!validateBodyObject(req, res)) {
    return;
  }

  if (!rejectUnexpectedFields(req.body, ["priority"], res)) {
    return;
  }

  if (!hasField(req.body, "priority")) {
    return sendValidationError(res, "priority is required");
  }

  if (
    typeof req.body.priority !== "string" ||
    !REPORT_PRIORITIES.has(req.body.priority)
  ) {
    return sendValidationError(
      res,
      "priority must be low, normal, or high"
    );
  }

  return next();
}

function validateReportAssignment(req, res, next) {
  if (!validateBodyObject(req, res)) {
    return;
  }

  if (!rejectUnexpectedFields(req.body, ["assignedTo"], res)) {
    return;
  }

  if (!hasField(req.body, "assignedTo")) {
    return sendValidationError(res, "assignedTo is required");
  }

  if (!isValidMongoObjectId(req.body.assignedTo)) {
    return sendValidationError(
      res,
      "assignedTo must be a valid ObjectId"
    );
  }

  return next();
}

function validateStartReview(req, res, next) {
  if (req.body === undefined) {
    return next();
  }

  if (!isBodyObject(req.body) || Object.keys(req.body).length > 0) {
    return sendValidationError(
      res,
      "Request body must be empty"
    );
  }

  return next();
}

function validateReportCompletion(req, res, next) {
  if (!validateBodyObject(req, res)) {
    return;
  }

  const allowedFields = ["assessment", "reviewerNote"];

  if (!rejectUnexpectedFields(req.body, allowedFields, res)) {
    return;
  }

  if (!hasField(req.body, "assessment")) {
    return sendValidationError(res, "assessment is required");
  }

  if (
    typeof req.body.assessment !== "string" ||
    !FINAL_REPORT_ASSESSMENTS.has(req.body.assessment)
  ) {
    return sendValidationError(
      res,
      "assessment must be phishing, suspicious, or no_threat_identified"
    );
  }

  if (hasField(req.body, "reviewerNote")) {
    if (typeof req.body.reviewerNote !== "string") {
      return sendValidationError(
        res,
        "reviewerNote must be a string when provided"
      );
    }

    const normalizedReviewerNote = req.body.reviewerNote.trim();

    if (normalizedReviewerNote.length > 1000) {
      return sendValidationError(
        res,
        "reviewerNote must not exceed 1000 characters"
      );
    }

    req.body.reviewerNote =
      normalizedReviewerNote.length > 0
        ? normalizedReviewerNote
        : null;
  } else {
    req.body.reviewerNote = null;
  }

  return next();
}

function validateRouteObjectId(req, res, next, parameterName, errorMessage) {
  const value = req.params?.[parameterName];

  if (!isValidMongoObjectId(value)) {
    return sendValidationError(res, errorMessage);
  }

  return next();
}

function validateReportId(req, res, next) {
  return validateRouteObjectId(
    req,
    res,
    next,
    "reportId",
    "Invalid report ID"
  );
}

function validateAnalysisId(req, res, next) {
  return validateRouteObjectId(
    req,
    res,
    next,
    "analysisId",
    "Invalid analysis ID"
  );
}

module.exports = {
  validateReportSubmission,
  validateReportMessage,
  validateReportPriority,
  validateReportAssignment,
  validateStartReview,
  validateReportCompletion,
  validateReportId,
  validateAnalysisId
};
