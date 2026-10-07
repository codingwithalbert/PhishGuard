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

// Public registration limiter. It is deliberately separate from the login
// limiter so registration throttling can never consume or reset the login
// counter, and it uses a longer, higher window than login because legitimate
// school registration is a low-frequency, bursty activity rather than a
// repeated per-session one. Registration performs a bcrypt cost-12 hash per
// request, so an unauthenticated caller could otherwise force unbounded CPU
// work and mass-create accounts; this limiter bounds both from one client.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many registration attempts. Please try again later."
  }
});

module.exports = {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter
};