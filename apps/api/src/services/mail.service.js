const {
  RESET_TOKEN_TTL_MINUTES
} = require("./passwordResetToken.service");

// PhishGuard transactional mail service (Password Reset V1, spec 4).
//
// Mail is delivered through the Brevo transactional email API using the
// already-installed global fetch. This module never logs, never returns
// provider data, and converts every provider or configuration problem into a
// sanitized MailServiceError that carries no API key, recipient address, reset
// token, reset URL, or provider response body.

const BREVO_SMTP_EMAIL_ENDPOINT =
  "https://api.brevo.com/v3/smtp/email";
const PASSWORD_RESET_EMAIL_SUBJECT =
  "Reset your PhishGuard password";
const DEFAULT_MAIL_FROM_NAME = "PhishGuard";
const MAIL_REQUEST_TIMEOUT_MS = 10000;
const MAX_RECIPIENT_LENGTH = 254;
const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

const MAIL_ENV_NAMES = Object.freeze({
  apiKey: "BREVO_API_KEY",
  fromEmail: "MAIL_FROM_EMAIL",
  fromName: "MAIL_FROM_NAME"
});

const MAIL_ERROR_CODES = Object.freeze({
  NOT_CONFIGURED: "MAIL_NOT_CONFIGURED",
  DELIVERY_FAILED: "MAIL_DELIVERY_FAILED"
});

class MailServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MailServiceError";
    this.code = code;
  }
}

function notConfigured() {
  // The message never names the missing variable or any value, so it is safe
  // to surface in sanitized server-side handling.
  return new MailServiceError(
    MAIL_ERROR_CODES.NOT_CONFIGURED,
    "Transactional mail is not configured"
  );
}

function deliveryFailed() {
  return new MailServiceError(
    MAIL_ERROR_CODES.DELIVERY_FAILED,
    "Password reset email could not be delivered"
  );
}

function readEnvValue(env, name) {
  const value = env?.[name];

  return typeof value === "string" ? value.trim() : "";
}

// The single configuration boundary: environment-shaped input in, validated
// resolved configuration out. Callers resolve once and pass the result onward,
// so the environment is never interpreted twice. Validation stays here so
// unrelated development and test environments are not required to define mail
// settings.
function resolveMailConfig(env = process.env) {
  const apiKey = readEnvValue(env, MAIL_ENV_NAMES.apiKey);
  const fromEmail = readEnvValue(env, MAIL_ENV_NAMES.fromEmail);
  const fromName = readEnvValue(env, MAIL_ENV_NAMES.fromName);

  return assertResolvedMailConfig({ apiKey, fromEmail, fromName });
}

// Guards the resolved-configuration contract at the send boundary: the caller
// must hand over the object produced by resolveMailConfig, never a
// process.env-shaped object.
function assertResolvedMailConfig(config) {
  const apiKey =
    typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
  const fromEmail =
    typeof config?.fromEmail === "string" ? config.fromEmail.trim() : "";
  const fromName =
    typeof config?.fromName === "string" ? config.fromName.trim() : "";

  if (
    apiKey.length === 0 ||
    fromEmail.length === 0 ||
    fromEmail.length > MAX_RECIPIENT_LENGTH ||
    !EMAIL_SHAPE_PATTERN.test(fromEmail)
  ) {
    throw notConfigured();
  }

  return {
    apiKey,
    fromEmail,
    fromName: fromName.length > 0 ? fromName : DEFAULT_MAIL_FROM_NAME
  };
}

// The Brevo transactional send endpoint is used with a single body field. A
// direct diagnostic request that carried only `textContent` was accepted with
// HTTP 201, while a request carrying both `htmlContent` and `textContent` was
// rejected before any transactional log entry existed, so only the plain-text
// body is sent.
function buildPasswordResetEmailText(resetUrl) {
  const expiryMinutes = RESET_TOKEN_TTL_MINUTES;

  return [
    "PhishGuard password reset",
    "",
    "A password reset was requested for your PhishGuard account.",
    "",
    `Choose a new password: ${resetUrl}`,
    "",
    `This link expires in ${expiryMinutes} minutes and can only be used once.`,
    "",
    "If you did not request a PhishGuard password reset, you can ignore this email. Your current password stays unchanged until you complete a reset.",
    "",
    "Automated message from PhishGuard. Please do not reply."
  ].join("\n");
}

function assertSendInput({ recipient, resetUrl }) {
  if (
    typeof recipient !== "string" ||
    recipient.length === 0 ||
    recipient.length > MAX_RECIPIENT_LENGTH
  ) {
    throw notConfigured();
  }

  if (
    typeof resetUrl !== "string" ||
    resetUrl.length === 0 ||
    !CLIENT_URL_PATTERN.test(resetUrl)
  ) {
    throw notConfigured();
  }
}

// `config` is the resolved configuration produced by resolveMailConfig. The
// caller owns the environment lookup, so the environment is read exactly once
// and a resolved object is never reinterpreted as process.env here. Only the
// documented Brevo success status counts as delivered, and the provider
// response body is intentionally not read, so provider data can never reach a
// caller, a log line, or an HTTP response.
async function sendPasswordResetEmail({
  recipient,
  resetUrl,
  config,
  fetchImpl = globalThis.fetch,
  timeoutMs = MAIL_REQUEST_TIMEOUT_MS
} = {}) {
  assertSendInput({ recipient, resetUrl });

  if (typeof fetchImpl !== "function") {
    throw notConfigured();
  }

  const { apiKey, fromEmail, fromName } =
    assertResolvedMailConfig(config);
  const textContent = buildPasswordResetEmailText(resetUrl);

  let response;

  try {
    response = await fetchImpl(BREVO_SMTP_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: fromName,
          email: fromEmail
        },
        to: [{ email: recipient }],
        subject: PASSWORD_RESET_EMAIL_SUBJECT,
        textContent
      }),
      signal:
        typeof AbortSignal?.timeout === "function"
          ? AbortSignal.timeout(timeoutMs)
          : undefined
    });
  } catch {
    // Network failures, timeouts, and aborts are indistinguishable to callers.
    throw deliveryFailed();
  }

  if (!response || response.status !== 201) {
    throw deliveryFailed();
  }

  return { delivered: true };
}

module.exports = {
  BREVO_SMTP_EMAIL_ENDPOINT,
  MAIL_ENV_NAMES,
  MAIL_ERROR_CODES,
  MAIL_REQUEST_TIMEOUT_MS,
  MailServiceError,
  PASSWORD_RESET_EMAIL_SUBJECT,
  assertResolvedMailConfig,
  buildPasswordResetEmailText,
  resolveMailConfig,
  sendPasswordResetEmail
};
