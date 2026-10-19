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

// Reset-token submission limiter. It sits on POST /reset-password ahead of
// validation so a blocked caller never reaches the token lookup or the bcrypt
// re-hash, and it is deliberately a separate instance so reset submissions can
// never consume or reset the forgot-password email budget (mirrors the
// established per-endpoint instance rule used by every other limiter here).
// Like all pre-authentication limiters it is keyed on the client IP observed by
// the single trusted proxy hop, and it is deliberately more generous than the
// forgot-password limiter (10 per 15 minutes) because a legitimate submission
// can be retried after a mistyped or expired link.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many password reset attempts. Please try again later."
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
// STORE LIMITATION, unchanged and unaddressed by this module: every limiter uses
// the default in-memory store. Counters therefore live in the Node process, so
// they reset on restart and are not shared between instances. This is adequate
// for the single-instance deployment the application is designed for and is
// sufficient against the abuse these limits target, because the buckets are
// keyed on a server-authoritative account id rather than on a forwarding
// header. Before any horizontal scale-out a shared store becomes mandatory,
// otherwise the effective limit is multiplied by the instance count. Nothing in
// this module detects or prevents that.
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

// Report creation limiter. Each accepted submission writes a Report document
// and a concurrency-safe ticket-counter allocation, and the only structural
// bound is one Report per owned Analysis, so an authenticated account could
// otherwise generate unbounded storage and database writes. Ten per hour is
// well above realistic student reporting while fixing a per-account ceiling on
// report writes. Its own instance keeps report creation from consuming or
// resetting any message quota.
const reportCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

// Logout limiter. Each accepted call performs one tokenVersion increment, so a
// compromised or malfunctioning client session cannot churn unbounded database
// writes under a valid bearer token. Ten per fifteen minutes is far above
// realistic logout activity. It is its own instance so logout traffic never
// consumes, resets, or shares a quota with credential changes.
const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

// URL analysis limiter. Every accepted analysis performs a deterministic,
// purely local lexical evaluation and then one Analysis document write. There
// is no outbound network call and no email, so this primitive is far cheaper
// than a report submission and the budget is correspondingly more generous,
// but the write amplification is real: without a ceiling a single account could
// grow the `analyses` collection without bound.
//
// Sixty per fifteen minutes is one request every fifteen seconds sustained, and
// is far above realistic student use. Analysis is an interactive, deliberate
// action - a student checks a link or two at a time before acting on it - so the
// limit is set to catch automated abuse rather than to pace a human.
//
// It uses its own instance so analysis traffic never consumes, resets, or
// shares a quota with report creation or messaging.
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

// Student report message limiter. Each accepted message writes a ReportMessage
// document for a report the sender owns; unlike the reviewer path it sends no
// outbound email. The window and limit deliberately mirror
// `reviewerMessageLimiter` so both sides of the same conversation carry an
// equally generous, already-justified budget, while a separate instance keeps
// student and reviewer counters fully independent.
const studentMessageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: AUTHENTICATED_LIMIT_MESSAGE
});

module.exports = {
  AUTHENTICATED_LIMIT_MESSAGE,
  analyzeLimiter,
  authenticatedUserKey,
  credentialChangeLimiter,
  forgotPasswordLimiter,
  loginLimiter,
  logoutLimiter,
  registerLimiter,
  reportCreateLimiter,
  requireAuthenticatedIdentity,
  resetPasswordLimiter,
  reviewerMessageLimiter,
  studentMessageLimiter
};