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

// Mail configuration is validated at this boundary only, so unrelated
// development and test environments are not required to define mail settings.
function resolveMailConfig(env = process.env) {
  const apiKey = readEnvValue(env, MAIL_ENV_NAMES.apiKey);
  const fromEmail = readEnvValue(env, MAIL_ENV_NAMES.fromEmail);
  const fromName = readEnvValue(env, MAIL_ENV_NAMES.fromName);

  if (apiKey.length === 0) {
    throw notConfigured();
  }

  if (
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

function escapeHtml(value) {
  return String(value)
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("'")
    .join("&#39;");
}

function buildPasswordResetEmailBody(resetUrl) {
  const safeUrl = escapeHtml(resetUrl);
  const expiryMinutes = RESET_TOKEN_TTL_MINUTES;

  const htmlContent = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<body>",
    '<h2 style="font-family:Arial,Helvetica,sans-serif;">PhishGuard password reset</h2>',
    "<p>A password reset was requested for your PhishGuard account.</p>",
    `<p><a href="${safeUrl}" style="font-family:Arial,Helvetica,sans-serif;">Choose a new password</a></p>`,
    `<p>Or paste this link into your browser:<br><a href="${safeUrl}">${safeUrl}</a></p>`,
    `<p>This link expires in ${expiryMinutes} minutes and can only be used once.</p>`,
    "<p>If you did not request a PhishGuard password reset, you can ignore this email. Your current password stays unchanged until you complete a reset.</p>",
    '<p style="color:#616e7c;font-size:12px;">Automated message from PhishGuard. Please do not reply.</p>',
    "</body>",
    "</html>"
  ].join("");

  const textContent = [
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

  return { htmlContent, textContent };
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

// Only the documented Brevo success status counts as delivered. The provider
// response body is intentionally not read, so provider data can never reach a
// caller, a log line, or an HTTP response.
async function sendPasswordResetEmail({
  recipient,
  resetUrl,
  config = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = MAIL_REQUEST_TIMEOUT_MS
} = {}) {
  assertSendInput({ recipient, resetUrl });

  if (typeof fetchImpl !== "function") {
    throw notConfigured();
  }

  const { apiKey, fromEmail, fromName } = resolveMailConfig(config);
  const { htmlContent, textContent } =
    buildPasswordResetEmailBody(resetUrl);

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
        htmlContent,
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
  buildPasswordResetEmailBody,
  resolveMailConfig,
  sendPasswordResetEmail
};
