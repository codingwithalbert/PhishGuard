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

const router = express.Router();

router.post("/register", validateRegistration, register);
router.post("/login", loginLimiter, validateLogin, login);
router.get("/me", authenticate, getMe);

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

module.exports = router;