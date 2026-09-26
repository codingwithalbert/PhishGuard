const express = require("express");

const {
  createPasswordResetController
} = require("../controllers/passwordReset.controller");
const {
  forgotPasswordLimiter
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
  forgotPasswordWorkflow = null,
  forgotPasswordRateLimiter = forgotPasswordLimiter
} = {}) {
  const router = express.Router();
  const controller = createPasswordResetController({
    service,
    forgotPasswordWorkflow
  });

  // reset-password is fully functional in Stage 3: it needs no mail delivery.
  router.post(
    "/reset-password",
    validateResetPasswordRequest,
    controller.resetPassword
  );

  // forgot-password is intentionally NOT registered here. Stage 3 has no
  // transactional mail sender, and wiring it now would create reset state
  // whose raw token is never delivered (spec 8). Stage 4 supplies the mail
  // workflow, and the route below then appears with the dedicated limiter.
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

// Production wiring registers /reset-password only.
const router = createPasswordResetRouter();

module.exports = router;
module.exports.createPasswordResetRouter = createPasswordResetRouter;
