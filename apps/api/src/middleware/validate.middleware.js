const mongoose = require("mongoose");
const {
  AWARENESS_TOTAL_QUESTIONS,
  getAwarenessQuestionIds,
  getValidSelectedAnswers
} = require("../services/awareness.service");

const AWARENESS_QUESTION_IDS = new Set(getAwarenessQuestionIds());
const AWARENESS_SELECTED_ANSWERS = new Set(getValidSelectedAnswers());

function sendAwarenessValidationError(res, error) {
  return res.status(400).json({
    success: false,
    error
  });
}

function validateAwarenessSubmission(req, res, next) {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendAwarenessValidationError(
      res,
      "Request body must be an object containing answers"
    );
  }

  const bodyKeys = Object.keys(body);

  if (bodyKeys.length !== 1 || bodyKeys[0] !== "answers") {
    return sendAwarenessValidationError(
      res,
      "Only answers may be submitted"
    );
  }

  const { answers } = body;

  if (!Array.isArray(answers)) {
    return sendAwarenessValidationError(
      res,
      "Answers must be an array"
    );
  }

  if (answers.length !== AWARENESS_TOTAL_QUESTIONS) {
    return sendAwarenessValidationError(
      res,
      "Exactly 10 answers are required"
    );
  }

  const questionIds = new Set();

  for (const answer of answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      return sendAwarenessValidationError(
        res,
        "Each answer must be an object"
      );
    }

    const answerKeys = Object.keys(answer);

    if (
      answerKeys.length !== 2 ||
      !answerKeys.includes("questionId") ||
      !answerKeys.includes("selectedAnswer")
    ) {
      return sendAwarenessValidationError(
        res,
        "Each answer must contain only questionId and selectedAnswer"
      );
    }

    if (!Number.isInteger(answer.questionId)) {
      return sendAwarenessValidationError(
        res,
        "Question ID must be an integer"
      );
    }

    if (!AWARENESS_QUESTION_IDS.has(answer.questionId)) {
      return sendAwarenessValidationError(
        res,
        "Question ID is not recognized"
      );
    }

    if (questionIds.has(answer.questionId)) {
      return sendAwarenessValidationError(
        res,
        "Question IDs must be unique"
      );
    }

    if (
      typeof answer.selectedAnswer !== "string" ||
      !AWARENESS_SELECTED_ANSWERS.has(answer.selectedAnswer)
    ) {
      return sendAwarenessValidationError(
        res,
        "Selected answer must be A, B, C, or D"
      );
    }

    questionIds.add(answer.questionId);
  }

  if (questionIds.size !== AWARENESS_QUESTION_IDS.size) {
    return sendAwarenessValidationError(
      res,
      "All 10 question IDs are required"
    );
  }

  next();
}

function validateAnalyzeRequest(req, res, next) {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required"
    });
  }

  if (typeof url !== "string") {
    return res.status(400).json({
      success: false,
      error: "URL must be a string"
    });
  }

  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    return res.status(400).json({
      success: false,
      error: "URL cannot be empty"
    });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return res.status(400).json({
      success: false,
      error: "Invalid URL"
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return res.status(400).json({
      success: false,
      error: "URL must use HTTP or HTTPS"
    });
  }

  req.body.url = trimmedUrl;

  next();
}

function validateAnalysisStatus(req, res, next) {
  const { status } = req.body;

  const allowedStatuses = ["active", "reviewed", "archived"];

  if (
    typeof status !== "string" ||
    !allowedStatuses.includes(status)
  ) {
    return res.status(400).json({
      success: false,
      error: "Status must be active, reviewed, or archived"
    });
  }

  next();
}

function validateMongoId(req, res, next) {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      error: "Invalid analysis ID"
    });
  }

  next();
}

module.exports = {
  validateAwarenessSubmission,
  validateAnalyzeRequest,
  validateAnalysisStatus,
  validateMongoId
};