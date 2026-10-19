const express = require("express");

const {
  createPasswordResetController
} = require("../controllers/passwordReset.controller");
const {
  forgotPasswordWorkflow: productionForgotPasswordWorkflow
} = require("../services/passwordReset.workflow");
const {
  forgotPasswordLimiter,
  resetPasswordLimiter
} = require("../middleware/rateLimit.middleware");
const {
  validateForgotPasswordRequest,
  validateResetPasswordRequest
} = require("../middleware/passwordReset.validate.middleware");

// Password Reset V1 routes (spec 7, 9, and 11).
//
// Neither endpoint requires authentication.
function createPasswordResetRouter({
  service,
  forgotPasswordWorkflow = productionForgotPasswordWorkflow,
  forgotPasswordRateLimiter = forgotPasswordLimiter,
  resetPasswordRateLimiter = resetPasswordLimiter,
  recordAuditEvent,
  auditRecordTimeoutMs
} = {}) {
  const router = express.Router();
  const controller = createPasswordResetController({
    service,
    forgotPasswordWorkflow,
    recordAuditEvent,
    auditRecordTimeoutMs
  });

  // The reset-submission limiter runs before validation so a blocked caller
  // never reaches the token lookup or the bcrypt re-hash. Only fixed text is
  // ever published, so no limiter state or identity information is exposed.
  router.post(
    "/reset-password",
    resetPasswordRateLimiter,
    validateResetPasswordRequest,
    controller.resetPassword
  );

  // Spec 7 and 11: dedicated limiter, strict validation, then the controller.
  // The default workflow prepares reset state and delivers the Brevo email. An
  // explicit `forgotPasswordWorkflow: null` removes the route instead of
  // exposing an endpoint that cannot deliver a reset link.
  if (typeof forgotPasswordWorkflow === "function") {
    router.post(
      "/forgot-password",
      forgotPasswordRateLimiter,
      validateForgotPasswordRequest,
      controller.forgotPassword
    );
  }

  return router;
}

// Production wiring registers both password-reset endpoints.
const router = createPasswordResetRouter();

module.exports = router;
module.exports.createPasswordResetRouter = createPasswordResetRouter;
