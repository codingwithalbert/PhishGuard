const express = require("express");

const {
  loginLimiter
} = require("../middleware/rateLimit.middleware");
const {
  register,
  login,
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

const router = express.Router();

router.post("/register", validateRegistration, register);
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

router.post(
  "/change-password",
  authenticate,
  validateChangePasswordRequest,
  changePassword
);

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

// Password Reset V1: the password-reset sub-router is mounted here, providing
// POST /api/auth/forgot-password and POST /api/auth/reset-password with their
// own rate limiting, validation, and controller.
router.use(passwordResetRoutes);

module.exports = router;