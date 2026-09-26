const { rateLimit } = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Please try again later."
  }
});

// Password Reset V1 forgot-password limiter (spec 11). It is deliberately
// separate from the login limiter so existing login throttling is unchanged
// and password-reset requests are limited more strictly.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error:
      "Too many password reset requests. Please try again later."
  }
});

module.exports = {
  forgotPasswordLimiter,
  loginLimiter
};