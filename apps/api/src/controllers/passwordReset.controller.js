const passwordResetService = require("../services/passwordReset.service");
const { auditLog } = require("../middleware/audit.middleware");
const {
  recordAuditEvent: defaultRecordAuditEvent
} = require("../services/audit.service");
const {
  createBoundedAuditWriter,
  AUDIT_RECORD_TIMEOUT_MS
} = require("../services/auditRecorder");

const { PasswordResetServiceError } = passwordResetService;

// Password Reset V1 HTTP boundary (spec 7, 8, 9, 10, 12, and 17).
//
// This controller never logs request bodies, passwords, raw reset tokens,
// token hashes, reset URLs, or authorization headers, and it never returns
// reset material of any kind. Audit events carry a fixed reason or the reset
// user id only.
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";
const RESET_PASSWORD_SUCCESS_MESSAGE =
  "Password reset successfully. You can now log in with your new password.";

// Persistent password-reset audit integration.
//
// Every handled terminal outcome records exactly one durable event through the
// shared bounded audit writer. The request and failure events carry NO identity,
// so the audit store can never be used to enumerate accounts; only the
// token-verified completion carries the reset user id. Emails, passwords, reset
// tokens, token hashes, reset URLs, request bodies, workflow return values, and
// error messages are never persisted. An unexpected system error is not audited:
// a durable write through the same failing dependency would be unreliable, and
// the existing sanitized error handling is preserved.
const AUDIT_CATEGORY_PASSWORD_RESET = "password_reset";
const AUDIT_ACTION_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED";
const AUDIT_ACTION_RESET_EMAIL_FAILED = "PASSWORD_RESET_EMAIL_FAILED";
const AUDIT_ACTION_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED";
const AUDIT_ACTION_RESET_FAILED = "PASSWORD_RESET_FAILED";
const AUDIT_OUTCOME_SUCCESS = "success";
const AUDIT_OUTCOME_FAILURE = "failure";
const AUDIT_RESOURCE_TYPE_USER = "user";

function applyNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function sendGenericForgotPasswordResponse(res) {
  return res.status(200).json({
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE
  });
}

function handlePasswordResetError(error, req, res, next) {
  if (error instanceof PasswordResetServiceError) {
    // `error.code` comes from the frozen Stage 2 code set, so the audit entry
    // cannot reveal whether an account exists.
    auditLog("PASSWORD_RESET_FAILED", req, {
      reason: error.code
    });

    return res.status(error.status).json({
      success: false,
      error: error.message
    });
  }

  return next(error);
}

// The Stage 4 mail workflow contract:
// receives the normalized email and the request, and is responsible for
// preparing reset state, building the reset URL, delivering the email, and
// clearing its own reset state through the Stage 2 conditional cleanup when
// delivery fails. Any rejection therefore means the reset email could not be
// delivered, and its return value is ignored so no raw token can reach a
// response.
function createPasswordResetController({
  service = passwordResetService,
  forgotPasswordWorkflow = null,
  recordAuditEvent = defaultRecordAuditEvent,
  auditRecordTimeoutMs = AUDIT_RECORD_TIMEOUT_MS
} = {}) {
  const persistAuditEvent = createBoundedAuditWriter({
    recordAuditEvent,
    auditRecordTimeoutMs
  });

  async function resetPassword(req, res, next) {
    applyNoStore(res);

    try {
      const { userId } = await service.completePasswordReset({
        token: req.body.token,
        newPassword: req.body.password
      });

      auditLog("PASSWORD_RESET_COMPLETED", req, {
        userId: userId ? String(userId) : null
      });

      // The token was verified and the password changed, so the returned id is
      // the only identity this outcome may carry. `actorRole` is intentionally
      // omitted: the reset flow never loads the user's role.
      const completedEvent = {
        category: AUDIT_CATEGORY_PASSWORD_RESET,
        action: AUDIT_ACTION_RESET_COMPLETED,
        outcome: AUDIT_OUTCOME_SUCCESS
      };

      if (userId) {
        const verifiedId = String(userId);

        completedEvent.actor = verifiedId;
        completedEvent.targetUser = verifiedId;
        completedEvent.resourceType = AUDIT_RESOURCE_TYPE_USER;
        completedEvent.resourceId = verifiedId;
      }

      await persistAuditEvent(completedEvent);

      // No JWT and no user payload: the user signs in with the new password.
      return res.status(200).json({
        success: true,
        message: RESET_PASSWORD_SUCCESS_MESSAGE
      });
    } catch (error) {
      // Only a recognized reset-service rejection is a handled terminal
      // outcome. An unexpected system error is NOT audited through an
      // additional database write: the same failing dependency makes that
      // write unreliable, and the existing sanitized error handling is
      // preserved.
      if (error instanceof PasswordResetServiceError) {
        await persistAuditEvent({
          category: AUDIT_CATEGORY_PASSWORD_RESET,
          action: AUDIT_ACTION_RESET_FAILED,
          outcome: AUDIT_OUTCOME_FAILURE
        });
      }

      return handlePasswordResetError(error, req, res, next);
    }
  }

  async function forgotPassword(req, res, next) {
    applyNoStore(res);

    if (typeof forgotPasswordWorkflow !== "function") {
      // Stage 3 has no transactional mail delivery. Refusing here guarantees
      // reset state is never created for a token that cannot be delivered.
      return res.status(503).json({
        success: false,
        error: "Password reset is temporarily unavailable"
      });
    }

    try {
      await forgotPasswordWorkflow({
        email: req.body.email,
        req
      });
    } catch {
      // Spec 8: a delivery failure must not become a distinguishable public
      // response, otherwise it would reveal that the account exists. The
      // workflow already cleared its own reset state, so this layer repeats
      // no database logic and logs only a sanitized event.
      auditLog("PASSWORD_RESET_EMAIL_FAILED", req, {
        reason: "delivery_failed"
      });

      await persistAuditEvent({
        category: AUDIT_CATEGORY_PASSWORD_RESET,
        action: AUDIT_ACTION_RESET_EMAIL_FAILED,
        outcome: AUDIT_OUTCOME_FAILURE
      });

      return sendGenericForgotPasswordResponse(res);
    }

    // Logged identically whether or not an account matched, so audit output
    // cannot be used to enumerate accounts. The persistent event is equally
    // identity-free: the workflow returns nothing that identifies the account.
    auditLog("PASSWORD_RESET_REQUESTED", req, {
      reason: "accepted"
    });

    await persistAuditEvent({
      category: AUDIT_CATEGORY_PASSWORD_RESET,
      action: AUDIT_ACTION_RESET_REQUESTED,
      outcome: AUDIT_OUTCOME_SUCCESS
    });

    return sendGenericForgotPasswordResponse(res);
  }

  return {
    forgotPassword,
    resetPassword
  };
}

const defaultController = createPasswordResetController();

module.exports = {
  ...defaultController,
  GENERIC_FORGOT_PASSWORD_MESSAGE,
  RESET_PASSWORD_SUCCESS_MESSAGE,
  createPasswordResetController
};
