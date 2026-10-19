const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const accountService = require("../services/account.service");
const { auditLog } = require("../middleware/audit.middleware");
const {
  recordAuditEvent: defaultRecordAuditEvent
} = require("../services/audit.service");
const {
  createBoundedAuditWriter,
  AUDIT_RECORD_TIMEOUT_MS
} = require("../services/auditRecorder");

const VALID_TOKEN_VERSION_FILTER = {
  $or: [
    { tokenVersion: { $exists: false } },
    { tokenVersion: { $type: "number" } }
  ]
};

function isValidTokenVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Persistent registration audit integration.
//
// Mirrors the login controller: the existing behavior and response are
// untouched, and a best-effort, bounded audit event is recorded for the two
// terminal outcomes. `register` is built through a factory so the audit write
// can be faked offline, exactly like `createLoginController`.
//
// The success event references the newly created account; the duplicate-email
// rejection carries NO actor, email, password, submitted identity, or resource
// reference, so the audit store never becomes a record of probed emails.
function createRegistrationController({
  userModel = User,
  recordAuditEvent = defaultRecordAuditEvent,
  auditRecordTimeoutMs = AUDIT_RECORD_TIMEOUT_MS
} = {}) {
  const persistAuditEvent = createBoundedAuditWriter({
    recordAuditEvent,
    auditRecordTimeoutMs
  });

  async function register(req, res, next) {
    try {
      const { name, email, password } = req.body;

      const existingUser = await userModel.findOne({ email });

      if (existingUser) {
        await persistAuditEvent({
          category: AUDIT_CATEGORY_ACCOUNT,
          action: AUDIT_ACTION_REGISTRATION_FAILED,
          outcome: AUDIT_OUTCOME_FAILURE
        });

        return res.status(409).json({
          success: false,
          error: "An account with this email already exists"
        });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      // The client can never supply the role: only these three fields are
      // forwarded, and the User model assigns the default `user` role.
      const user = await userModel.create({
        name,
        email,
        password: hashedPassword
      });

      await persistAuditEvent({
        category: AUDIT_CATEGORY_ACCOUNT,
        action: AUDIT_ACTION_REGISTRATION_SUCCESS,
        outcome: AUDIT_OUTCOME_SUCCESS,
        actor: user._id.toString(),
        actorRole: user.role,
        resourceType: "user",
        resourceId: user._id.toString()
      });

      return res.status(201).json({
        success: true,
        message: "Registration successful",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      // Unexpected failures (including database errors) are NOT audited here:
      // a durable write through the same failing dependency would be
      // unreliable, and the existing sanitized error handling is preserved.
      next(error);
    }
  }

  return { register };
}

// Persistent authentication audit integration.
//
// The existing console audit call is preserved for every login outcome, and the
// same outcome is then also written durably through the shared bounded audit
// writer (`services/auditRecorder.js`). That write is best-effort: a persistence
// failure is swallowed only after emitting a fixed diagnostic code, so a
// database problem can never change a response or leak driver text, credentials,
// or payloads. The bounded waiting and the single diagnostic live in the shared
// module so the login, registration, and password-reset controllers cannot
// diverge.
//
// Failed logins and duplicate registrations deliberately carry NO actor,
// target, or submitted identity. The attempt is recorded without the email or
// password that was submitted.
const AUDIT_CATEGORY_AUTHENTICATION = "authentication";
const AUDIT_CATEGORY_ACCOUNT = "account";
const AUDIT_ACTION_LOGIN_SUCCESS = "LOGIN_SUCCESS";
const AUDIT_ACTION_LOGIN_FAILED = "LOGIN_FAILED";
const AUDIT_ACTION_REGISTRATION_SUCCESS = "REGISTRATION_SUCCESS";
const AUDIT_ACTION_REGISTRATION_FAILED = "REGISTRATION_FAILED";
const AUDIT_OUTCOME_SUCCESS = "success";
const AUDIT_OUTCOME_FAILURE = "failure";
const LOGIN_FAILED_REASON = "invalid_credentials";

// Builds the login handler with injectable dependencies so the audit write can be
// faked offline. `getMe` is intentionally left outside this factory and is
// unchanged.
function createLoginController({
  userModel = User,
  recordAuditEvent = defaultRecordAuditEvent,
  auditRecordTimeoutMs = AUDIT_RECORD_TIMEOUT_MS
} = {}) {
  const persistLoginEvent = createBoundedAuditWriter({
    recordAuditEvent,
    auditRecordTimeoutMs
  });

  // Single failure funnel: exactly one console event and exactly one persistent
  // event per failed request, whichever check rejected the login.
  async function respondLoginFailure(req, res) {
    auditLog(AUDIT_ACTION_LOGIN_FAILED, req, {
      reason: LOGIN_FAILED_REASON
    });

    await persistLoginEvent({
      category: AUDIT_CATEGORY_AUTHENTICATION,
      action: AUDIT_ACTION_LOGIN_FAILED,
      outcome: AUDIT_OUTCOME_FAILURE
    });

    return res.status(401).json({
      success: false,
      error: "Invalid email or password"
    });
  }

  async function login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await userModel
        .findOne({
          email,
          ...VALID_TOKEN_VERSION_FILTER
        })
        .select("+password");

      if (
        !user ||
        !user.isActive ||
        !isValidTokenVersion(user.tokenVersion)
      ) {
        return await respondLoginFailure(req, res);
      }

      const passwordMatches = await bcrypt.compare(password, user.password);

      if (!passwordMatches) {
        return await respondLoginFailure(req, res);
      }

      const token = jwt.sign(
        {
          userId: user._id.toString(),
          role: user.role,
          tokenVersion: user.tokenVersion
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "1h"
        }
      );

      auditLog(AUDIT_ACTION_LOGIN_SUCCESS, req, {
        userId: user._id.toString(),
        role: user.role
      });

      await persistLoginEvent({
        category: AUDIT_CATEGORY_AUTHENTICATION,
        action: AUDIT_ACTION_LOGIN_SUCCESS,
        outcome: AUDIT_OUTCOME_SUCCESS,
        actor: user._id.toString(),
        actorRole: user.role
      });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }

  return { login };
}

// Server-side logout (Phase 0 security hardening).
//
// Factory-built like login and registration so the service call and the
// persistent audit write can both be faked offline. The account-wide
// revocation itself lives in account.service.revokeOwnTokens; this boundary
// maps its two resolved outcomes onto two distinct static messages:
//
//   - { revoked: true }  → "Logged out successfully." The tokenVersion bump
//                          was confirmed by the database, so claiming the
//                          server-side revocation is truthful.
//   - { revoked: false } → "You have been signed out." The write resolved but
//                          matched no account, so the session was already
//                          unauthenticatable and no server-side revocation
//                          occurred. The message deliberately does NOT claim
//                          one.
//
// A database failure or an unconfirmed write forwards to the global error
// handler as a generic 500; the caller is told nothing about revocation.
// Every handled outcome records exactly one console event and one bounded
// persistent event, carrying only the authenticated actor, in the same
// identity policy as login.
const AUDIT_ACTION_LOGOUT = "LOGOUT";

const LOGGED_OUT_MESSAGE = "Logged out successfully.";
const SIGNED_OUT_MESSAGE = "You have been signed out.";

function applyNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function createLogoutController({
  accountService: injectedAccountService = accountService,
  recordAuditEvent = defaultRecordAuditEvent,
  auditRecordTimeoutMs = AUDIT_RECORD_TIMEOUT_MS
} = {}) {
  const persistLogoutEvent = createBoundedAuditWriter({
    recordAuditEvent,
    auditRecordTimeoutMs
  });

  async function logout(req, res, next) {
    applyNoStore(res);

    try {
      const { revoked } = await injectedAccountService.revokeOwnTokens({
        userId: req.user.userId
      });

      auditLog(AUDIT_ACTION_LOGOUT, req, {
        userId: req.user.userId,
        role: req.user.role
      });

      await persistLogoutEvent({
        category: AUDIT_CATEGORY_AUTHENTICATION,
        action: AUDIT_ACTION_LOGOUT,
        outcome: AUDIT_OUTCOME_SUCCESS,
        actor: req.user.userId,
        actorRole: req.user.role
      });

      return res.status(200).json({
        success: true,
        message: revoked ? LOGGED_OUT_MESSAGE : SIGNED_OUT_MESSAGE
      });
    } catch (error) {
      // An unconfirmed or failed revocation is never reported as a successful
      // logout by this boundary: the generic sanitized 500 tells the caller
      // the server could not complete the operation. The client-side session
      // cleanup remains the caller's responsibility and happens regardless.
      return next(error);
    }
  }

  return { logout };
}

const defaultLoginController = createLoginController();
const defaultRegistrationController = createRegistrationController();
const defaultLogoutController = createLogoutController();

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.userId);

    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register: defaultRegistrationController.register,
  login: defaultLoginController.login,
  logout: defaultLogoutController.logout,
  getMe,
  createLoginController,
  createRegistrationController,
  createLogoutController,
  LOGGED_OUT_MESSAGE,
  SIGNED_OUT_MESSAGE,
  AUDIT_RECORD_TIMEOUT_MS
};
