const bcrypt = require("bcrypt");

const User = require("../models/User");
const {
  PASSWORD_HASH_COST,
  PASSWORD_POLICY
} = require("./passwordReset.service");

// Profile & Change Password V1 self-service account layer
// (specs/profile-change-password-v1.md, sections 3 to 7).
//
// Both operations are strictly self-service: the target account is identified
// only by the authenticated user id supplied by the caller (ultimately
// `req.user.userId`). No function here accepts a target account from client
// input, and no function performs mass assignment.
//
// The service intentionally performs no logging and returns only safe values,
// so the HTTP layer can emit audit events later without ever having access to a
// plaintext password, a password hash, or password-reset state.

// The User model and the registration validator both restrict the display name
// to 2 to 50 characters. No shared exported constant exists, so the rule is
// restated once here and reused by the service and the request validation.
const PROFILE_NAME_MIN_LENGTH = 2;
const PROFILE_NAME_MAX_LENGTH = 50;

const ACCOUNT_ERROR_CODES = Object.freeze({
  NOT_FOUND: "ACCOUNT_NOT_FOUND",
  INVALID_NAME: "ACCOUNT_INVALID_NAME",
  INVALID_CURRENT_PASSWORD: "ACCOUNT_INVALID_CURRENT_PASSWORD",
  INCORRECT_CURRENT_PASSWORD: "ACCOUNT_INCORRECT_CURRENT_PASSWORD",
  INVALID_NEW_PASSWORD: "ACCOUNT_INVALID_NEW_PASSWORD",
  UNCHANGED_PASSWORD: "ACCOUNT_UNCHANGED_PASSWORD",
  INVALID_STORED_PASSWORD: "ACCOUNT_INVALID_STORED_PASSWORD"
});

class AccountServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "AccountServiceError";
    this.code = code;
    this.status = status;
  }
}

function createServiceError(code, message, status) {
  return new AccountServiceError(code, message, status);
}

function accountNotFound() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.NOT_FOUND,
    "Account not found",
    404
  );
}

function invalidName() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.INVALID_NAME,
    `Name must be between ${PROFILE_NAME_MIN_LENGTH} and ${PROFILE_NAME_MAX_LENGTH} characters`,
    400
  );
}

function invalidCurrentPassword() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.INVALID_CURRENT_PASSWORD,
    "Current password is required",
    400
  );
}

function incorrectCurrentPassword() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD,
    "Current password is incorrect",
    401
  );
}

function invalidNewPassword() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.INVALID_NEW_PASSWORD,
    `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`,
    400
  );
}

function unchangedPassword() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.UNCHANGED_PASSWORD,
    "New password must be different from the current password",
    400
  );
}

// Unexpected corrupt account state. Guarding here prevents bcrypt's own error,
// which can embed the invalid value it received, from reaching a log line.
function invalidStoredPassword() {
  return createServiceError(
    ACCOUNT_ERROR_CODES.INVALID_STORED_PASSWORD,
    "Account password state is unavailable",
    500
  );
}

// Spec 3: the account is only ever identified by the authenticated user id. A
// missing identifier cannot resolve an account and is reported as not found
// rather than as a server fault.
function requireAuthenticatedUserId(userId) {
  if (userId === undefined || userId === null || userId === "") {
    throw accountNotFound();
  }
}

// Spec 4.3: the display name is trimmed before validation and persistence, and
// must satisfy the existing registration length rule.
function normalizeDisplayName(name) {
  if (typeof name !== "string") {
    throw invalidName();
  }

  const trimmedName = name.trim();

  if (
    trimmedName.length < PROFILE_NAME_MIN_LENGTH ||
    trimmedName.length > PROFILE_NAME_MAX_LENGTH
  ) {
    throw invalidName();
  }

  return trimmedName;
}

function invalidNewPasswordValue(newPassword) {
  if (
    typeof newPassword !== "string" ||
    newPassword.length < PASSWORD_POLICY.minLength ||
    newPassword.length > PASSWORD_POLICY.maxLength
  ) {
    throw invalidNewPassword();
  }
}

function invalidCurrentPasswordValue(currentPassword) {
  if (
    typeof currentPassword !== "string" ||
    currentPassword.length === 0
  ) {
    throw invalidCurrentPassword();
  }
}

// The only representation of an account that leaves this layer. It matches the
// safe profile shape already returned by registration, login, and /api/auth/me.
function toSafeProfile({ id, name, email, role }) {
  return {
    id,
    name,
    email,
    role
  };
}

async function findOwnAccount(userId, userModel) {
  const user = await userModel.findById(userId);

  // A missing or inactive account is reported identically, matching the
  // existing /api/auth/me behavior.
  if (!user || user.isActive !== true) {
    throw accountNotFound();
  }

  return user;
}

// The write is conditioned on the account still being active, so a change made
// between the read and the write cannot be applied. A write that matches
// nothing is reported with the same safe 404 as a missing account.
async function applyActiveAccountUpdate({
  userId,
  update,
  userModel
}) {
  const result = await userModel.updateOne(
    { _id: userId, isActive: true },
    update
  );

  if (!result || result.matchedCount !== 1) {
    throw accountNotFound();
  }

  return result;
}

// Spec 4: rename the authenticated account's own display name. Only `name` is
// written; email, role, isActive, password, reset state, and timestamps are
// never touched.
async function updateOwnProfileName({
  userId,
  name,
  userModel = User
} = {}) {
  requireAuthenticatedUserId(userId);

  const normalizedName = normalizeDisplayName(name);
  const user = await findOwnAccount(userId, userModel);

  await applyActiveAccountUpdate({
    userId,
    userModel,
    update: {
      $set: {
        name: normalizedName
      }
    }
  });

  return toSafeProfile({
    id: user._id,
    name: normalizedName,
    email: user.email,
    role: user.role
  });
}

// Spec 5.3: verify the current password, reject an unchanged replacement, then
// store a new hash and clear password-reset state in the same update. A failed
// change performs no write at all, so outstanding reset state is preserved.
async function changeOwnPassword({
  userId,
  currentPassword,
  newPassword,
  userModel = User
} = {}) {
  requireAuthenticatedUserId(userId);
  invalidCurrentPasswordValue(currentPassword);
  invalidNewPasswordValue(newPassword);

  // The password field uses `select: false`, so it is selected explicitly for
  // this internal verification and is never returned.
  const user = await userModel
    .findById(userId)
    .select("+password");

  if (!user || user.isActive !== true) {
    throw accountNotFound();
  }

  if (
    typeof user.password !== "string" ||
    user.password.length === 0
  ) {
    throw invalidStoredPassword();
  }

  const currentPasswordMatches = await bcrypt.compare(
    currentPassword,
    user.password
  );

  if (!currentPasswordMatches) {
    throw incorrectCurrentPassword();
  }

  const newPasswordMatchesCurrent = await bcrypt.compare(
    newPassword,
    user.password
  );

  if (newPasswordMatchesCurrent) {
    throw unchangedPassword();
  }

  const newPasswordHash = await bcrypt.hash(
    newPassword,
    PASSWORD_HASH_COST
  );

  // Password replacement and reset-state clearing stay in one atomic $set. If
  // the account is no longer active at write time, nothing is written and the
  // operation reports the same safe 404, so the generated hash and the reset
  // state are never applied or exposed.
  await applyActiveAccountUpdate({
    userId,
    userModel,
    update: {
      $set: {
        password: newPasswordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    }
  });

  // Spec 7: no token is issued, revoked, or returned here. The controller
  // reports success with a static message.
  return {
    userId: String(user._id ?? userId)
  };
}

module.exports = {
  ACCOUNT_ERROR_CODES,
  AccountServiceError,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH,
  changeOwnPassword,
  toSafeProfile,
  updateOwnProfileName
};
