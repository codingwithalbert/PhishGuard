const bcrypt = require("bcrypt");

const User = require("../models/User");
const {
  createResetTokenState,
  hashResetToken
} = require("./passwordResetToken.service");

// Password Reset V1 database-backed workflow (specs/password-reset-v1.md).
//
// This service owns the server-authoritative reset state. It never logs and
// never includes raw reset tokens, token hashes, or passwords in returned
// errors. The only raw token exposure is the transient in-memory value handed
// to the later mail stage for reset-link construction.
//
// Reset state always lives in the two server-controlled User fields created in
// Stage 1. Because both fields use `select: false`, every reset-state decision
// here is expressed as a database filter instead of a read of the hidden
// fields, so no query can accidentally leak reset state to a response.

// Existing PhishGuard password policy, mirroring the registration policy in
// middleware/auth.validate.middleware.js. Password Reset V1 must not weaken or
// diverge from it (spec 9.4).
const PASSWORD_POLICY = Object.freeze({
  minLength: 8,
  maxLength: 128
});

// Existing PhishGuard bcrypt cost factor (spec 9.4 and 15).
const PASSWORD_HASH_COST = 12;

// Matches the existing authentication email normalization and User schema
// limits (lowercase, trimmed, maximum 254 characters).
const MAX_EMAIL_LENGTH = 254;

// Existing PhishGuard email format policy, identical to the pattern enforced
// by validateRegistration in middleware/auth.validate.middleware.js. Password
// Reset V1 must not accept a request shape that registration would reject
// (spec 7.3).
const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bounds token input so malformed input cannot be used to push large values
// through hashing. Reset tokens are 64 hexadecimal characters (Stage 1).
const MAX_RESET_TOKEN_LENGTH = 512;

const PASSWORD_RESET_ERROR_CODES = Object.freeze({
  INVALID_EMAIL: "PASSWORD_RESET_INVALID_EMAIL",
  INVALID_TOKEN: "PASSWORD_RESET_INVALID_TOKEN",
  INVALID_PASSWORD: "PASSWORD_RESET_INVALID_PASSWORD"
});

class PasswordResetServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "PasswordResetServiceError";
    this.code = code;
    this.status = status;
  }
}

function createServiceError(code, message, status) {
  return new PasswordResetServiceError(code, message, status);
}

// One generic failure for malformed, unknown, expired, superseded, and
// already-used reset tokens (spec 9.3 and 10). The message and code are
// identical in every case, so no response can reveal whether an account or an
// outstanding reset request exists.
function invalidResetToken() {
  return createServiceError(
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
    "The password reset link is invalid or has expired",
    400
  );
}

function invalidEmail() {
  return createServiceError(
    PASSWORD_RESET_ERROR_CODES.INVALID_EMAIL,
    "A valid email address is required",
    400
  );
}

function invalidPassword() {
  return createServiceError(
    PASSWORD_RESET_ERROR_CODES.INVALID_PASSWORD,
    `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`,
    400
  );
}

function resolveUserModel(userModel) {
  if (
    !userModel ||
    typeof userModel.findOne !== "function" ||
    typeof userModel.updateOne !== "function"
  ) {
    throw new TypeError(
      "A user model with findOne and updateOne is required"
    );
  }

  return userModel;
}

function normalizeResetEmail(email) {
  if (typeof email !== "string") {
    throw invalidEmail();
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > MAX_EMAIL_LENGTH ||
    !EMAIL_FORMAT_PATTERN.test(normalizedEmail)
  ) {
    throw invalidEmail();
  }

  return normalizedEmail;
}

function assertResetTokenInput(token) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_RESET_TOKEN_LENGTH
  ) {
    throw invalidResetToken();
  }
}

function assertPasswordPolicy(password) {
  if (
    typeof password !== "string" ||
    password.length < PASSWORD_POLICY.minLength ||
    password.length > PASSWORD_POLICY.maxLength
  ) {
    throw invalidPassword();
  }
}

// Spec 7.5 and 7.6. Creates reset state for an existing account and returns
// the minimum internal data the mail stage needs, including the raw token as
// transient in-memory data only. Returns null when no matching account exists
// so the HTTP stage can answer existing and nonexistent accounts identically
// without creating state or inventing a user.
async function preparePasswordReset({
  email,
  now = new Date(),
  userModel = User
} = {}) {
  const users = resolveUserModel(userModel);
  const normalizedEmail = normalizeResetEmail(email);

  const user = await users.findOne({ email: normalizedEmail });

  if (!user) {
    return null;
  }

  const { rawToken, tokenHash, expiresAt } = createResetTokenState({
    now
  });

  // Spec 5.2 and 5.5: store only the hash and the server-generated expiration.
  // A newer request replaces the previous outstanding reset state, which makes
  // every earlier reset link invalid.
  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt
      }
    }
  );

  return {
    userId: user._id,
    email: user.email,
    resetToken: rawToken,
    resetTokenHash: tokenHash
  };
}

// Spec 8. Clears reset state only while the stored hash still belongs to this
// exact request, so a concurrent newer reset request is never invalidated by a
// failed delivery of an older request. Returns true only when this request's
// state was the state that got cleared.
async function clearPasswordResetStateIfCurrent({
  userId,
  resetTokenHash,
  userModel = User
} = {}) {
  const users = resolveUserModel(userModel);

  if (
    typeof resetTokenHash !== "string" ||
    resetTokenHash.length === 0
  ) {
    throw new TypeError("A reset token hash is required");
  }

  if (userId === null || userId === undefined) {
    throw new TypeError("A user id is required");
  }

  const result = await users.updateOne(
    {
      _id: userId,
      passwordResetTokenHash: resetTokenHash
    },
    {
      $set: {
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    }
  );

  return result.matchedCount === 1;
}

// Spec 9. Verifies the supplied token, stores the new password with the
// existing bcrypt policy, and consumes the reset state in a single conditional
// update. The conditional filter still requires this exact outstanding token
// and an unexpired state, so competing attempts with the same token cannot both
// succeed and a token can never be reused (spec 5.4). Role and isActive are
// never written, so a password reset cannot reactivate an account (spec 16)
// and the user is not logged in automatically.
async function completePasswordReset({
  token,
  newPassword,
  now = new Date(),
  userModel = User
} = {}) {
  const users = resolveUserModel(userModel);

  assertResetTokenInput(token);
  assertPasswordPolicy(newPassword);

  const tokenHash = hashResetToken(token);

  const user = await users.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: now }
  });

  if (!user) {
    throw invalidResetToken();
  }

  const passwordHash = await bcrypt.hash(
    newPassword,
    PASSWORD_HASH_COST
  );

  const result = await users.updateOne(
    {
      _id: user._id,
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now }
    },
    {
      $set: {
        password: passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    }
  );

  if (result.matchedCount !== 1) {
    throw invalidResetToken();
  }

  return { userId: user._id };
}

module.exports = {
  MAX_EMAIL_LENGTH,
  MAX_RESET_TOKEN_LENGTH,
  PASSWORD_HASH_COST,
  PASSWORD_POLICY,
  PASSWORD_RESET_ERROR_CODES,
  PasswordResetServiceError,
  clearPasswordResetStateIfCurrent,
  completePasswordReset,
  normalizeResetEmail,
  preparePasswordReset
};
