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

// Authenticated-user rate limiting.
//
// These limiters bound expensive or outbound-side-effect work that an
// authenticated account can trigger. They are keyed exclusively by the
// server-authoritative `req.user.userId`, which `authenticate` resolves from
// the current User record. No network header is ever read: `req.ip`,
// `X-Forwarded-For`, `CF-Connecting-IP`, and `CF-Ray` are deliberately ignored,
// so a caller cannot create or move a bucket by supplying a forwarding header.
// This also means authenticated quotas are unaffected by shared NAT or by
// proxy topology, which the pre-authentication limiters remain subject to.
//
// These must stay separate from the login, registration, and forgot-password
// limiters: those are pre-authentication and IP-keyed, and coupling them would
// change existing public endpoint behavior.
//
// Each limiter must be mounted after `authenticate` and after
// `requireAuthenticatedIdentity` so `req.user` is populated first.

// Namespace so an authenticated key can never collide with another limiter's
// internal key space.
function authenticatedUserKey(req) {
  return `u:${req.user.userId}`;
}

// Fail-closed guard for a limiter reached without a resolved identity. A
// constant fallback key would create a single shared bucket that any caller
// could exhaust for everyone, so the request is refused instead. This mirrors
// the missing-identity response already used by the role middleware.
function requireAuthenticatedIdentity(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required"
    });
  }

  return next();
}

// Shared 429 body. Only fixed text is published; no limiter internals, counter
// values, window details, or identity information are exposed.
const AUTHENTICATED_LIMIT_MESSAGE = Object.freeze({
  success: false,
  error: "Too many requests. Please try again later."
});

// Password change limiter. Each accepted call performs three bcrypt cost-12
// operations (two comparisons and one hash), so an authenticated account could
// otherwise force unbounded CPU work. Five per fifteen minutes is far above
// legitimate use while still bounding the primitive cost.
const credentialChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

// Reviewer message limiter. Each accepted message triggers an outbound
// transactional email to the report owner, so a compromised or malfunctioning
// staff account could otherwise exhaust provider quota or damage the sending
// domain's reputation. Twenty per ten minutes is well above realistic reviewer
// activity and is shared across all reports the reviewer works on.
const reviewerMessageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

module.exports = {
  AUTHENTICATED_LIMIT_MESSAGE,
  authenticatedUserKey,
  credentialChangeLimiter,
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  requireAuthenticatedIdentity,
  reviewerMessageLimiter
};