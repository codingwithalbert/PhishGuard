const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

// Server-authoritative authentication.
//
// A valid JWT proves only that a token was signed by this server. It does not
// prove that the account still exists, is still active, or still holds the
// role recorded when the token was issued. Role and account state are mutable
// server-side, so every protected request re-reads the current User record and
// authorizes from that record only. The token's `role` claim is deliberately
// never used.
//
// The projection is limited to the three fields required for authorization, so
// the password hash and the password-reset state (both `select: false` on the
// schema) can never enter `req.user`.
//
// No caching is applied: any memoized user state would reintroduce the stale
// authorization window this middleware exists to close.
const USER_STATE_PROJECTION = { _id: 1, role: 1, isActive: 1 };

// Same fixed diagnostic vocabulary the global error handler uses, so a thrown
// error is classified by `instanceof` rather than by its own `name`, which an
// upstream library or a crafted error controls.
const DIAGNOSTIC_ERROR_TYPES = [
  TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError, Error
];

// One sanitized line, emitted only when the current-user lookup throws. The
// client-facing response stays the same generic rejection as an invalid token,
// so this line is the only way an operator can tell an infrastructure failure
// apart from a credential problem.
//
// Only fixed metadata is logged. Error messages, stacks, names, codes, causes,
// connection strings, hosts, database names, filters, user identifiers, tokens,
// and request metadata must never be serialized here.
function logCurrentUserLookupFailure(err) {
  const errorType = DIAGNOSTIC_ERROR_TYPES.find(
    (ErrorType) => err instanceof ErrorType
  );

  console.error("[AUTH]", JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "AUTH_CURRENT_USER_LOOKUP_FAILED",
    category: "current_user_lookup_failure",
    errorType: errorType ? errorType.name : "Unknown",
    status: 403
  }));
}

// Matches the existing strict ObjectId pattern in
// middleware/reporting.validate.middleware.js. The hexadecimal shape test is
// required because mongoose `isValid` alone also accepts any 12-character
// string, which would let a malformed claim reach the driver as a CastError.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function isValidUserId(value) {
  return (
    typeof value === "string" &&
    OBJECT_ID_PATTERN.test(value) &&
    mongoose.Types.ObjectId.isValid(value)
  );
}

function createAuthenticate({ userModel = User } = {}) {
  return async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired token"
      });
    }

    // Missing or malformed id, nonexistent account, and inactive account all
    // answer with the same generic 403 so no response reveals whether an
    // account exists or is active.
    const rejectToken = () =>
      res.status(403).json({
        success: false,
        error: "Invalid or expired token"
      });

    if (!isValidUserId(decoded?.userId)) {
      return rejectToken();
    }

    let user;

    try {
      user = await userModel
        .findById(decoded.userId)
        .select(USER_STATE_PROJECTION);
    } catch (error) {
      // The generic rejection stays identical so no database or account state
      // reaches the client. Only fixed, sanitized metadata is logged so an
      // infrastructure failure is still visible to operators.
      logCurrentUserLookupFailure(error);

      return rejectToken();
    }

    if (!user || user.isActive !== true) {
      return rejectToken();
    }

    req.user = {
      userId: user._id.toString(),
      role: user.role
    };

    return next();
  };
}

// Production wiring keeps the existing single-middleware export so every
// current `authenticate` route import continues to work unchanged.
const authenticate = createAuthenticate();

module.exports = {
  authenticate,
  createAuthenticate
};