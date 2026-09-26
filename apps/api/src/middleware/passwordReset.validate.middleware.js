const {
  MAX_RESET_TOKEN_LENGTH,
  PASSWORD_POLICY,
  PasswordResetServiceError,
  normalizeResetEmail
} = require("../services/passwordReset.service");

// Password Reset V1 request validation (spec 7.2, 7.3, and 9.2).
//
// Only the documented fields are accepted, so unexpected or server-owned
// fields can never be smuggled into a reset request. Email normalization,
// email syntax, the 254-character email limit, the reset-token input bound,
// and the 8-128 character password policy all reuse the Stage 2 policy
// helpers, which mirror the existing registration policy.
const FORGOT_PASSWORD_ALLOWED_FIELDS = ["email"];
const RESET_PASSWORD_ALLOWED_FIELDS = ["token", "password"];

const INVALID_EMAIL_MESSAGE = "A valid email address is required";
const UNEXPECTED_FORGOT_FIELDS_MESSAGE =
  "Only email may be submitted";
const UNEXPECTED_RESET_FIELDS_MESSAGE =
  "Only token and password may be submitted";
const INVALID_TOKEN_MESSAGE = "A valid reset token is required";

function invalidPasswordMessage() {
  return `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`;
}

function isRequestBodyObject(body) {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    !Array.isArray(body)
  );
}

function hasExactFields(body, allowedFields) {
  const bodyKeys = Object.keys(body);

  return (
    bodyKeys.length === allowedFields.length &&
    allowedFields.every((field) => bodyKeys.includes(field))
  );
}

// Reset workflow responses must never be cached, including validation errors.
function applyNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function sendValidationError(res, error) {
  return res.status(400).json({
    success: false,
    error
  });
}

function validateForgotPasswordRequest(req, res, next) {
  applyNoStore(res);

  const body = req.body;

  if (
    !isRequestBodyObject(body) ||
    !hasExactFields(body, FORGOT_PASSWORD_ALLOWED_FIELDS)
  ) {
    return sendValidationError(
      res,
      UNEXPECTED_FORGOT_FIELDS_MESSAGE
    );
  }

  try {
    req.body.email = normalizeResetEmail(body.email);
  } catch (error) {
    if (error instanceof PasswordResetServiceError) {
      return sendValidationError(res, INVALID_EMAIL_MESSAGE);
    }

    return next(error);
  }

  return next();
}

function validateResetPasswordRequest(req, res, next) {
  applyNoStore(res);

  const body = req.body;

  if (
    !isRequestBodyObject(body) ||
    !hasExactFields(body, RESET_PASSWORD_ALLOWED_FIELDS)
  ) {
    return sendValidationError(
      res,
      UNEXPECTED_RESET_FIELDS_MESSAGE
    );
  }

  const { token, password } = body;

  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_RESET_TOKEN_LENGTH
  ) {
    return sendValidationError(res, INVALID_TOKEN_MESSAGE);
  }

  if (
    typeof password !== "string" ||
    password.length < PASSWORD_POLICY.minLength ||
    password.length > PASSWORD_POLICY.maxLength
  ) {
    return sendValidationError(
      res,
      invalidPasswordMessage()
    );
  }

  return next();
}

module.exports = {
  validateForgotPasswordRequest,
  validateResetPasswordRequest
};