const crypto = require("crypto");

// Password Reset V1 reset-token contract (specs/password-reset-v1.md).
//
// Reset tokens are high-entropy random values, so a fast one-way SHA-256
// hash is used for storage instead of the slower password-hash policy.
// Only the hash is ever persisted; the raw token exists solely inside the
// reset URL that is delivered to the account owner.
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MINUTES = 15;
const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

function toValidDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid date`);
  }

  return date;
}

function generateResetToken() {
  return crypto
    .randomBytes(RESET_TOKEN_BYTES)
    .toString("hex");
}

function hashResetToken(rawToken) {
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    throw new TypeError("A nonempty reset token string is required");
  }

  return crypto
    .createHash("sha256")
    .update(rawToken, "utf8")
    .digest("hex");
}

function getResetTokenExpiresAt(now = new Date()) {
  const issuedAt = toValidDate(now, "Reset token issue time");

  return new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS);
}

function createResetTokenState({ now = new Date() } = {}) {
  const rawToken = generateResetToken();

  return {
    rawToken,
    tokenHash: hashResetToken(rawToken),
    expiresAt: getResetTokenExpiresAt(now)
  };
}

function isResetTokenExpired(expiresAt, now = new Date()) {
  if (
    !(expiresAt instanceof Date) ||
    Number.isNaN(expiresAt.getTime())
  ) {
    return true;
  }

  const reference = toValidDate(now, "Reset token check time");

  return expiresAt.getTime() <= reference.getTime();
}

module.exports = {
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MINUTES,
  RESET_TOKEN_TTL_MS,
  createResetTokenState,
  generateResetToken,
  getResetTokenExpiresAt,
  hashResetToken,
  isResetTokenExpired
};
