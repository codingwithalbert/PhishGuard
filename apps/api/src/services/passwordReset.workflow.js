const {
  clearPasswordResetStateIfCurrent,
  preparePasswordReset
} = require("./passwordReset.service");
const {
  resolveMailConfig,
  sendPasswordResetEmail
} = require("./mail.service");

// Password Reset V1 forgot-password workflow (spec 5, 7, and 8).
//
// The workflow is the only place where the raw reset token, the reset URL, and
// transactional mail meet. It never logs and never returns reset material, and
// it repeats none of the Stage 2 database logic: a failed delivery is followed
// by the Stage 2 conditional cleanup, which only clears state while the stored
// hash still belongs to that exact request.
const RESET_LINK_PATH = "/reset-password";
const CLIENT_URL_PATTERN = /^https?:\/\/[^\s/]+/i;

const PASSWORD_RESET_WORKFLOW_ERROR_CODES = Object.freeze({
  MAIL_CONFIGURATION: "PASSWORD_RESET_MAIL_CONFIGURATION",
  INVALID_LINK_CONFIGURATION:
    "PASSWORD_RESET_INVALID_LINK_CONFIGURATION",
  MAIL_DELIVERY_FAILED: "PASSWORD_RESET_MAIL_DELIVERY_FAILED"
});

class PasswordResetWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PasswordResetWorkflowError";
    this.code = code;
  }
}

function configurationError(code, message) {
  return new PasswordResetWorkflowError(code, message);
}

// The reset link is built from the configured client URL and the raw token. It
// is never logged, never persisted, and never placed in audit metadata.
function buildPasswordResetUrl({ clientUrl, resetToken } = {}) {
  if (
    typeof clientUrl !== "string" ||
    clientUrl.trim().length === 0
  ) {
    throw configurationError(
      PASSWORD_RESET_WORKFLOW_ERROR_CODES.INVALID_LINK_CONFIGURATION,
      "Password reset links are not configured"
    );
  }

  if (
    typeof resetToken !== "string" ||
    resetToken.length === 0
  ) {
    throw configurationError(
      PASSWORD_RESET_WORKFLOW_ERROR_CODES.INVALID_LINK_CONFIGURATION,
      "Password reset links are not configured"
    );
  }

  let parsed;

  try {
    parsed = new URL(clientUrl.trim());
  } catch {
    throw configurationError(
      PASSWORD_RESET_WORKFLOW_ERROR_CODES.INVALID_LINK_CONFIGURATION,
      "Password reset links are not configured"
    );
  }

  if (
    (parsed.protocol !== "http:" &&
      parsed.protocol !== "https:") ||
    !CLIENT_URL_PATTERN.test(parsed.origin)
  ) {
    throw configurationError(
      PASSWORD_RESET_WORKFLOW_ERROR_CODES.INVALID_LINK_CONFIGURATION,
      "Password reset links are not configured"
    );
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${basePath}${RESET_LINK_PATH}/${encodeURIComponent(resetToken)}`;
}

// Best-effort cleanup of this request's reset state after a delivery failure.
//
// The conditional contract is unchanged: only state whose stored hash still
// equals this request's hash is cleared, and there is no retry and no
// unconditional cleanup. If the database operation itself fails, the stored
// hash MAY still be present and usable until its normal 15-minute expiration
// expires it, so this state cannot be reported as cleared. The raw token was
// never delivered by this application, and the failure stays invisible to the
// caller: nothing here is logged, and the workflow still ends with the same
// sanitized error.
async function clearResetStateQuietly({
  prepared,
  clearResetStateIfCurrent
}) {
  try {
    await clearResetStateIfCurrent({
      userId: prepared.userId,
      resetTokenHash: prepared.resetTokenHash
    });
  } catch {
    // Intentionally ignored: the cleanup error may contain database detail,
    // and the caller already receives a sanitized workflow error.
  }
}

function createForgotPasswordWorkflow({
  prepareReset = preparePasswordReset,
  clearResetStateIfCurrent: clearResetState = clearPasswordResetStateIfCurrent,
  sendMail = sendPasswordResetEmail,
  resolveConfig = resolveMailConfig,
  buildResetUrl = buildPasswordResetUrl,
  env = process.env
} = {}) {
  return async function runForgotPasswordWorkflow({ email } = {}) {
    // Configuration is checked before any reset state exists, so a
    // misconfigured deployment can never create an undeliverable token.
    let mailConfig;

    try {
      mailConfig = resolveConfig(env);
    } catch {
      throw configurationError(
        PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_CONFIGURATION,
        "Password reset email delivery is unavailable"
      );
    }

    const prepared = await prepareReset({ email });

    // Spec 7.6: no account means no reset state, no mail send, and nothing that
    // could reveal account absence.
    if (!prepared) {
      return null;
    }

    try {
      const resetUrl = buildResetUrl({
        clientUrl: env.CLIENT_URL,
        resetToken: prepared.resetToken
      });

      await sendMail({
        recipient: prepared.email,
        resetUrl,
        config: mailConfig
      });
    } catch {
      // Spec 8: remove the state of the token the user never received, then
      // fail with a sanitized error. If that conditional cleanup itself
      // fails, the state may remain valid until its normal expiration; the
      // failure is never surfaced. The Stage 3 controller converts this into
      // the same generic public response used for every other accepted
      // request.
      await clearResetStateQuietly({
        prepared,
        clearResetStateIfCurrent: clearResetState
      });

      throw configurationError(
        PASSWORD_RESET_WORKFLOW_ERROR_CODES.MAIL_DELIVERY_FAILED,
        "Password reset email could not be delivered"
      );
    }

    // Spec 8: a delivered link leaves its reset state active. The return value
    // is identical for existing and nonexistent accounts on purpose.
    return null;
  };
}

// Production workflow used by POST /api/auth/forgot-password.
const forgotPasswordWorkflow = createForgotPasswordWorkflow();

module.exports = {
  PASSWORD_RESET_WORKFLOW_ERROR_CODES,
  PasswordResetWorkflowError,
  RESET_LINK_PATH,
  buildPasswordResetUrl,
  createForgotPasswordWorkflow,
  forgotPasswordWorkflow
};
