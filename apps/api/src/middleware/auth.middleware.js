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
    } catch {
      // An unexpected database failure must not leak database detail or
      // account state, so it is reported as the same safe 403.
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