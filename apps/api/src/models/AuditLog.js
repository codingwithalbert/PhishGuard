const mongoose = require("mongoose");

// Persistent audit logging foundation.
//
// WHY THIS MODEL EXISTS: audit events are currently emitted only to the process
// console (`middleware/audit.middleware.js`) and therefore have no durability,
// retention, or reviewability (security audit finding F-10). This model adds a
// persistence shape for those events. It deliberately does NOT change the
// middleware or any controller; wiring audit writes through it is a separate,
// later step.
//
// DESIGN CONSTRAINTS, ALL SERVER-CONTROLLED:
//
//   - The record is append-only. Every field is `immutable`, so an audit entry
//     cannot be edited to hide or rewrite what happened.
//   - There is NO free-form `metadata`, `details`, or `Mixed` field. Arbitrary
//     blobs are exactly how credentials, tokens, request bodies, or other
//     sensitive values leak into a log, so the schema instead exposes a small,
//     fixed set of enumerated categories, outcomes, and references. Fields not
//     declared here are stripped by `strict: true` and are never persisted.
//   - Enumerations are closed. A caller cannot invent a new category, outcome,
//     role, or resource type at runtime.
//   - Cross-field consistency is enforced in `pre("validate")`: a resource type
//     and its id travel together, and an actor role is only meaningful when an
//     actor is present.
//
// Scope note: this file declares a schema only. It does not connect to MongoDB,
// create an index, or prove anything about a running database. Whether an index
// is actually built, or chosen by a query planner, is a runtime fact verifiable
// only against a real database.

const AUDIT_EVENT_CATEGORIES = [
  "authentication",
  "account",
  "password_reset",
  "reporting",
  "authorization",
  "analysis",
  "training",
  "administration"
];

const AUDIT_OUTCOMES = ["success", "failure"];

const AUDIT_ACTOR_ROLES = ["user", "staff", "admin"];

const AUDIT_RESOURCE_TYPES = [
  "user",
  "analysis",
  "report",
  "report_message",
  "training_completion",
  "awareness_assessment",
  "phishing_identification_assessment"
];

const auditLogSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: AUDIT_EVENT_CATEGORIES,
      required: true,
      immutable: true
    },

    // The specific event name, e.g. "LOGIN_SUCCESS" or "PASSWORD_CHANGED".
    // Normalized to a trimmed, upper-case token so the same logical event
    // cannot be stored under several spellings. The pattern is intentionally
    // narrow: letters, digits, and underscores only.
    action: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
      match: /^[A-Z][A-Z0-9_]*$/,
      immutable: true
    },

    outcome: {
      type: String,
      enum: AUDIT_OUTCOMES,
      required: true,
      immutable: true
    },

    // The authenticated user who performed the action, when there was one.
    // Unauthenticated events (for example a failed login) leave this null.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true
    },

    // The role held at the time of the event. Stored alongside the actor so a
    // later role change cannot silently reinterpret historical entries.
    actorRole: {
      type: String,
      enum: [null, ...AUDIT_ACTOR_ROLES],
      default: null,
      immutable: true
    },

    // The user an action was taken against, distinct from the actor. For a
    // self-service change both point at the same user; for an administrative
    // action the actor targets someone else.
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true
    },

    // A typed, bounded reference to the affected record (an analysis, a report,
    // a training completion, and so on). `resourceType` names the collection
    // family; `resourceId` is the record's ObjectId. The pair is validated
    // together below so a half-reference cannot be stored.
    resourceType: {
      type: String,
      enum: [null, ...AUDIT_RESOURCE_TYPES],
      default: null,
      immutable: true
    },

    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      immutable: true
    }
  },
  {
    // Creation time only. An audit entry is append-only: it is never edited
    // after it is written, so a mutable `updatedAt` would be meaningless and
    // could imply a record was changed when it must not be.
    timestamps: { createdAt: true, updatedAt: false },
    collection: "auditLogs",
    strict: true
  }
);

auditLogSchema.pre("validate", function validateAuditReferences() {
  const hasResourceType = this.resourceType != null;
  const hasResourceId = this.resourceId != null;

  if (hasResourceType !== hasResourceId) {
    this.invalidate(
      "resourceId",
      "resourceType and resourceId must be provided together"
    );
  }

  if (this.actor == null && this.actorRole != null) {
    this.invalidate(
      "actorRole",
      "actorRole must be null when actor is not set"
    );
  }
});

// Indexes for the read shapes an audit review surface is expected to use.
//
// Each is the compound `{ <equality>, createdAt: -1, _id: -1 }` convention
// already used by `analysis_owner_history` and `report_owner_history`: the
// leading field is the equality filter, the descending `createdAt` serves the
// ordering, and the trailing `_id` is the deterministic tie-breaker for entries
// created in the same millisecond.
//
// These indexes are declarations. They prove nothing about any running
// database; index creation and query-plan selection are runtime facts.
auditLogSchema.index(
  { createdAt: -1, _id: -1 },
  {
    name: "audit_log_recent"
  }
);

auditLogSchema.index(
  { actor: 1, createdAt: -1, _id: -1 },
  {
    name: "audit_log_actor_history"
  }
);

auditLogSchema.index(
  { targetUser: 1, createdAt: -1, _id: -1 },
  {
    name: "audit_log_target_user_history"
  }
);

auditLogSchema.index(
  { category: 1, outcome: 1, createdAt: -1, _id: -1 },
  {
    name: "audit_log_category_outcome_history"
  }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLog;
