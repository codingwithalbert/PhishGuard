const mongoose = require("mongoose");

const AuditLog = require("../models/AuditLog");

// Persistent audit-writing service (foundation).
//
// WHY THIS EXISTS: `AuditLog` defines the durable shape of an audit event, and
// `middleware/audit.middleware.js` still only prints to the console. This service
// is the single, reusable, create-only entry point for recording an event through
// the model. It is intentionally HTTP-independent: it takes a plain event object
// and knows nothing about `req`, `res`, sessions, or headers, so request handling
// stays in the controllers/middleware that will call it later.
//
// SECURITY POSTURE:
//
//   - Only the fields declared by the AuditLog schema are accepted. The field set
//     is a closed allowlist; any other key (a request body, a password, a token,
//     a `metadata` blob) is rejected outright rather than being handed to Mongoose
//     and stripped silently by `strict: true`.
//   - Inputs are validated before any persistence is attempted, so an invalid
//     event never reaches the database.
//   - The service exposes recording only. There is deliberately no update,
//     delete, or upsert operation for an audit record.
//   - Errors are sanitized: a persistence failure is re-thrown as a fixed-message
//     error that carries no driver text, query, connection string, or document.
//     The original error is never logged here, so raw database output that might
//     contain sensitive values cannot escape through this path.
//   - Caller-controlled text never appears in an error message. A rejected event
//     reports a fixed, generic reason; the offending field names and values are
//     not echoed back.
//
// OPTIONAL SESSION SUPPORT: a caller may pass `{ session }` as a second argument
// so an audit write can join an existing MongoDB transaction (for example an
// administrative role change). The session is kept entirely separate from the
// event fields: it is never merged into the document, and the only persistence
// option ever forwarded to the model is `{ session }`. Arbitrary Mongoose
// options cannot be injected through this path.
//
// Testability: the model is injected. Supplying a fake `auditModel` lets the whole
// service run offline with no MongoDB connection.

const REQUIRED_AUDIT_FIELDS = Object.freeze([
  "category",
  "action",
  "outcome"
]);

const OPTIONAL_AUDIT_FIELDS = Object.freeze([
  "actor",
  "actorRole",
  "targetUser",
  "resourceType",
  "resourceId"
]);

// The complete, closed set of fields a caller may supply. Anything outside it is
// rejected. `createdAt` and `_id` are intentionally absent: they are
// server-generated and must never be caller-controlled.
const ALLOWED_AUDIT_FIELDS = Object.freeze([
  ...REQUIRED_AUDIT_FIELDS,
  ...OPTIONAL_AUDIT_FIELDS
]);

const ACTION_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ACTION_MAX_LENGTH = 64;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// The only persistence option the recorder will ever forward to the model. Any
// other option key is rejected so a caller cannot inject arbitrary Mongoose
// behavior (write concern, upsert, projections, and so on).
const ALLOWED_RECORD_OPTIONS = Object.freeze(["session"]);

const UNSUPPORTED_FIELDS_MESSAGE =
  "Audit event contains unsupported fields";

const AUDIT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "AUDIT_INVALID_INPUT",
  PERSISTENCE_FAILED: "AUDIT_PERSISTENCE_FAILED"
});

class AuditServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuditServiceError";
    this.code = code;
  }
}

function invalidInput(message) {
  return new AuditServiceError(AUDIT_ERROR_CODES.INVALID_INPUT, message);
}

function persistenceFailed() {
  return new AuditServiceError(
    AUDIT_ERROR_CODES.PERSISTENCE_FAILED,
    "Failed to persist audit event"
  );
}

// Reads the closed enum straight off the schema so the accepted values can never
// drift from the model's own validation.
function enumValues(schema, field) {
  const path = schema.path(field);

  return path && Array.isArray(path.enumValues) ? path.enumValues : [];
}

function isObjectIdLike(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return true;
  }

  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

// A plain object is a literal `{}` or an object with a null prototype. Arrays,
// dates, maps, buffers, regular expressions, and class instances are not plain
// objects and are rejected as event containers.
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

// A MongoDB/Mongoose session exposes `endSession()`. Requiring that shape keeps a
// stray object from being treated as a transaction session.
function isSessionLike(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.endSession === "function"
  );
}

function normalizeAction(value) {
  return value.trim().toUpperCase();
}

// Validates and normalizes a raw event into the exact set of fields the model
// will persist. Throws a sanitized AuditServiceError on any problem. Messages
// name the offending field but never echo its value, so a rejected event cannot
// leak the data it was rejected for. The unexpected-field case is deliberately
// fixed-text: caller-chosen key names are never repeated back.
function validateAuditEvent(input, schema) {
  if (!isPlainObject(input)) {
    throw invalidInput("Audit event must be a plain object");
  }

  const unexpectedFields = Object.keys(input).filter(
    (field) => !ALLOWED_AUDIT_FIELDS.includes(field)
  );

  if (unexpectedFields.length > 0) {
    throw invalidInput(UNSUPPORTED_FIELDS_MESSAGE);
  }

  for (const field of REQUIRED_AUDIT_FIELDS) {
    if (typeof input[field] !== "string" || input[field].trim().length === 0) {
      throw invalidInput(`"${field}" is required`);
    }
  }

  const category = input.category.trim();

  if (!enumValues(schema, "category").includes(category)) {
    throw invalidInput('"category" is not a supported audit category');
  }

  const outcome = input.outcome.trim();

  if (!enumValues(schema, "outcome").includes(outcome)) {
    throw invalidInput('"outcome" must be "success" or "failure"');
  }

  const action = normalizeAction(input.action);

  if (action.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(action)) {
    throw invalidInput(
      '"action" must be an upper-case letter, digit, and underscore token'
    );
  }

  // Build the persistence payload from the allowlist only, so even a caller that
  // somehow slipped a key past the check above cannot have it forwarded.
  const event = { category, action, outcome };

  for (const field of ["actor", "targetUser", "resourceId"]) {
    const value = input[field];

    if (value === undefined || value === null) {
      continue;
    }

    if (!isObjectIdLike(value)) {
      throw invalidInput(`"${field}" must be a valid identifier`);
    }

    event[field] = value;
  }

  const actorRole = input.actorRole;

  if (actorRole !== undefined && actorRole !== null) {
    if (!enumValues(schema, "actorRole").includes(actorRole)) {
      throw invalidInput('"actorRole" is not a supported role');
    }

    if (event.actor === undefined) {
      throw invalidInput('"actorRole" requires an "actor"');
    }

    event.actorRole = actorRole;
  }

  const resourceType = input.resourceType;

  if (resourceType !== undefined && resourceType !== null) {
    if (!enumValues(schema, "resourceType").includes(resourceType)) {
      throw invalidInput('"resourceType" is not a supported resource type');
    }

    event.resourceType = resourceType;
  }

  const hasResourceType = event.resourceType !== undefined;
  const hasResourceId = event.resourceId !== undefined;

  if (hasResourceType !== hasResourceId) {
    throw invalidInput(
      '"resourceType" and "resourceId" must be provided together'
    );
  }

  return event;
}

// Resolves the optional transaction session from the recorder's second argument.
// Returns `undefined` when no session is requested. Rejects anything that is not
// a plain options object, any option other than `session`, and any `session`
// value that is not a plausible database session.
function resolveSession(options) {
  if (options === undefined || options === null) {
    return undefined;
  }

  if (!isPlainObject(options)) {
    throw invalidInput("Audit options must be a plain object");
  }

  const unexpectedOptions = Object.keys(options).filter(
    (key) => !ALLOWED_RECORD_OPTIONS.includes(key)
  );

  if (unexpectedOptions.length > 0) {
    throw invalidInput("Audit options contain unsupported fields");
  }

  const session = options.session;

  if (session === undefined || session === null) {
    return undefined;
  }

  if (!isSessionLike(session)) {
    throw invalidInput("Audit session is not a valid database session");
  }

  return session;
}

// Builds a create-only recorder bound to a model. Injecting the model keeps the
// service testable without a live database.
function createAuditService({ auditModel = AuditLog } = {}) {
  if (!auditModel || typeof auditModel.create !== "function") {
    throw new TypeError(
      "createAuditService requires an audit model exposing create()"
    );
  }

  const schema = auditModel.schema || AuditLog.schema;

  return async function recordAuditEvent(input, options) {
    const event = validateAuditEvent(input, schema);
    const session = resolveSession(options);

    try {
      // The session is forwarded as a fixed `{ session }` option object; no
      // caller-supplied option is ever spread in.
      //
      // Mongoose only forwards options to `save()` when the first argument to
      // `create()` is an array. `create(doc, { session })` is read as two
      // documents: the option object becomes a second, empty document and the
      // session is silently dropped, so the write escapes the transaction it was
      // meant to join. The documented form is an array of documents with the
      // options object second, so a single-element array is passed and its one
      // result is unwrapped to keep the public return shape a single record.
      if (session !== undefined) {
        const [record] = await auditModel.create([event], { session });
        return record;
      }

      return await auditModel.create(event);
    } catch (error) {
      // A validation or cast failure means the event was rejected by the model,
      // not that the database failed. Either way the caller gets a sanitized
      // error; the underlying cause is never attached or logged, because it can
      // carry document contents, driver text, or connection details.
      if (
        error &&
        (error.name === "ValidationError" || error.name === "CastError")
      ) {
        throw invalidInput("Audit event failed validation");
      }

      throw persistenceFailed();
    }
  };
}

const recordAuditEvent = createAuditService();

module.exports = {
  createAuditService,
  recordAuditEvent,
  AuditServiceError,
  AUDIT_ERROR_CODES,
  ALLOWED_AUDIT_FIELDS
};
