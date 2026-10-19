const express = require("express");

const {
  credentialChangeLimiter,
  loginLimiter,
  logoutLimiter,
  registerLimiter,
  requireAuthenticatedIdentity
} = require("../middleware/rateLimit.middleware");
const {
  register,
  login,
  logout,
  getMe
} = require("../controllers/auth.controller");
const {
  validateRegistration,
  validateLogin
} = require("../middleware/auth.validate.middleware");
const {
  authenticate
} = require("../middleware/auth.middleware");
const {
  authorizeRoles
} = require("../middleware/role.middleware");
const {
  changePassword,
  updateProfile
} = require("../controllers/account.controller");
const {
  validateChangePasswordRequest,
  validateProfileUpdateRequest
} = require("../middleware/account.validate.middleware");
const passwordResetRoutes = require("./passwordReset.routes");

// The production authentication router. The demonstration RBAC endpoints
// (`/staff-test`, `/admin-test` authorization probes that return a fixed
// string) are no longer registered in the production surface. They remain
// available to the automated authorization suite through the
// `includeDemoRoutes` option below, so the server-side role allow/deny matrix
// keeps its offline test coverage without shipping test scaffolding in
// production.
function createAuthRouter({ includeDemoRoutes = false } = {}) {
  const router = express.Router();

  // The registration limiter runs before validation so a blocked caller never
  // reaches the bcrypt hash or account creation.
  router.post(
    "/register",
    registerLimiter,
    validateRegistration,
    register
  );
  router.post("/login", loginLimiter, validateLogin, login);
  router.get("/me", authenticate, getMe);

  // Profile & Change Password V1. Both routes are self-service: the account is
  // always the authenticated caller, never a client-supplied identifier.
  router.patch(
    "/profile",
    authenticate,
    validateProfileUpdateRequest,
    updateProfile
  );

  // Authenticated-user abuse protection: authentication first, then the identity
  // guard, then the limiter, then the existing validation and controller.
  router.post(
    "/change-password",
    authenticate,
    requireAuthenticatedIdentity,
    credentialChangeLimiter,
    validateChangePasswordRequest,
    changePassword
  );

  // Server-side logout (Phase 0 security hardening). Same protection order as
  // change-password: authentication resolves the account, the identity guard
  // guarantees `req.user.userId` exists, and the limiter bounds tokenVersion
  // churn. The controller increments tokenVersion, which revokes every
  // outstanding bearer token for the account on every device.
  router.post(
    "/logout",
    authenticate,
    requireAuthenticatedIdentity,
    logoutLimiter,
    logout
  );

  if (includeDemoRoutes) {
    // AUTOMATED-TEST-ONLY RBAC demonstration routes. Never registered by the
    // production router (includeDemoRoutes defaults to false). They carry no
    // data and return a fixed string; their only purpose is to let the
    // offline authorization suite assert the server-side role allow/deny
    // matrix through the real middleware chain.
    router.get(
      "/staff-test",
      authenticate,
      authorizeRoles("admin", "staff"),
      (req, res) => {
        res.status(200).json({
          success: true,
          message: "Staff access granted"
        });
      }
    );

    router.get(
      "/admin-test",
      authenticate,
      authorizeRoles("admin"),
      (req, res) => {
        res.status(200).json({
          success: true,
          message: "Admin access granted"
        });
      }
    );
  }

  // Password Reset V1: the password-reset sub-router is mounted here, providing
  // POST /api/auth/forgot-password and POST /api/auth/reset-password with their
  // own rate limiting, validation, and controller.
  router.use(passwordResetRoutes);

  return router;
}

// Production wiring registers the logout route and the full authenticated
// surface, and does NOT register the demonstration RBAC routes.
const router = createAuthRouter();

module.exports = router;
module.exports.createAuthRouter = createAuthRouter;
