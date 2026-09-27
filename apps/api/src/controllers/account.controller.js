const accountService = require("../services/account.service");
const { auditLog } = require("../middleware/audit.middleware");

const {
  ACCOUNT_ERROR_CODES,
  AccountServiceError
} = accountService;

// Profile & Change Password V1 HTTP layer
// (specs/profile-change-password-v1.md, sections 4, 5, 7, and 8).
//
// The controller is intentionally thin. The authenticated identity comes only
// from `req.user.userId`, never from the request body, query, or path, and no
// target account can be selected by the client. Both endpoints answer with
// `Cache-Control: no-store` before any work begins, so every response from
// them, including validation and error responses, is uncacheable.
//
// Audit events carry the authenticated user id, the role, and at most a fixed
// reason code. Request bodies, submitted passwords, hashes, reset state, and
// authorization headers are never audited.
const PASSWORD_CHANGE_FAILED_REASON = "invalid_current_password";

function applyNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function auditActor(req) {
  return {
    userId: req.user?.userId ? String(req.user.userId) : null,
    role: req.user?.role || null
  };
}

function handleAccountError(error, res, next) {
  if (error instanceof AccountServiceError) {
    // Only expected public failures publish the service message. An internal
    // 5xx is forwarded so the existing global handler answers with the generic
    // safe response instead of exposing an internal description.
    if (error.status >= 500) {
      return next(error);
    }

    return res.status(error.status).json({
      success: false,
      error: error.message
    });
  }

  return next(error);
}

function createAccountController(service = accountService) {
  async function updateProfile(req, res, next) {
    applyNoStore(res);

    try {
      const user = await service.updateOwnProfileName({
        userId: req.user.userId,
        name: req.body.name
      });

      auditLog("PROFILE_UPDATED", req, auditActor(req));

      return res.status(200).json({
        success: true,
        user
      });
    } catch (error) {
      return handleAccountError(error, res, next);
    }
  }

  async function changePassword(req, res, next) {
    applyNoStore(res);

    try {
      await service.changeOwnPassword({
        userId: req.user.userId,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword
      });

      auditLog("PASSWORD_CHANGED", req, auditActor(req));

      // Spec 5.5 and 7: a static message, no token, no user payload, and the
      // current session is left untouched.
      return res.status(200).json({
        success: true,
        message: "Password changed successfully."
      });
    } catch (error) {
      if (
        error instanceof AccountServiceError &&
        error.code ===
          ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD
      ) {
        auditLog("PASSWORD_CHANGE_FAILED", req, {
          ...auditActor(req),
          reason: PASSWORD_CHANGE_FAILED_REASON
        });
      }

      return handleAccountError(error, res, next);
    }
  }

  return {
    changePassword,
    updateProfile
  };
}

const defaultController = createAccountController();

module.exports = {
  ...defaultController,
  PASSWORD_CHANGE_FAILED_REASON,
  createAccountController
};
