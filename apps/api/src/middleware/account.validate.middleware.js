const {
  PASSWORD_POLICY
} = require("../services/passwordReset.service");
const {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH
} = require("../services/account.service");

// Profile & Change Password V1 request validation
// (specs/profile-change-password-v1.md, sections 4 and 5).
//
// Validation is exact-field: a request body must contain precisely the
// documented keys. This is what makes it impossible for a client to submit
// email, role, isActive, password, password-reset state, timestamps, a user id,
// or any other server-owned field.
//
// Password rules reuse the exported PASSWORD_POLICY, so a second, conflicting
// password policy cannot exist.
const PROFILE_UPDATE_ALLOWED_FIELDS = ["name"];
const CHANGE_PASSWORD_ALLOWED_FIELDS = [
  "currentPassword",
  "newPassword"
];

const UNEXPECTED_PROFILE_FIELDS_MESSAGE =
  "Only name may be submitted";
const UNEXPECTED_CHANGE_PASSWORD_FIELDS_MESSAGE =
  "Only currentPassword and newPassword may be submitted";
const INVALID_NAME_MESSAGE = `Name must be between ${PROFILE_NAME_MIN_LENGTH} and ${PROFILE_NAME_MAX_LENGTH} characters`;
const INVALID_CURRENT_PASSWORD_MESSAGE =
  "Current password is required";
const INVALID_NEW_PASSWORD_MESSAGE = `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`;

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

function sendValidationError(res, error) {
  return res.status(400).json({
    success: false,
    error
  });
}

// Both endpoints respond with no-store, including validation failures.
function applyNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function validateProfileUpdateRequest(req, res, next) {
  applyNoStore(res);

  const body = req.body;

  if (
    !isRequestBodyObject(body) ||
    !hasExactFields(body, PROFILE_UPDATE_ALLOWED_FIELDS)
  ) {
    return sendValidationError(
      res,
      UNEXPECTED_PROFILE_FIELDS_MESSAGE
    );
  }

  if (typeof body.name !== "string") {
    return sendValidationError(res, INVALID_NAME_MESSAGE);
  }

  const normalizedName = body.name.trim();

  if (
    normalizedName.length < PROFILE_NAME_MIN_LENGTH ||
    normalizedName.length > PROFILE_NAME_MAX_LENGTH
  ) {
    return sendValidationError(res, INVALID_NAME_MESSAGE);
  }

  req.body.name = normalizedName;

  return next();
}

function validateChangePasswordRequest(req, res, next) {
  applyNoStore(res);

  const body = req.body;

  if (
    !isRequestBodyObject(body) ||
    !hasExactFields(body, CHANGE_PASSWORD_ALLOWED_FIELDS)
  ) {
    return sendValidationError(
      res,
      UNEXPECTED_CHANGE_PASSWORD_FIELDS_MESSAGE
    );
  }

  if (
    typeof body.currentPassword !== "string" ||
    body.currentPassword.length === 0
  ) {
    return sendValidationError(
      res,
      INVALID_CURRENT_PASSWORD_MESSAGE
    );
  }

  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.length < PASSWORD_POLICY.minLength ||
    body.newPassword.length > PASSWORD_POLICY.maxLength
  ) {
    return sendValidationError(
      res,
      INVALID_NEW_PASSWORD_MESSAGE
    );
  }

  return next();
}

module.exports = {
  validateChangePasswordRequest,
  validateProfileUpdateRequest
};
