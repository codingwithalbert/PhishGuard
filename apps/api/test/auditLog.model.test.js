const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuditLog = require("../src/models/AuditLog");

// Offline tests for the persistent audit log schema.
//
// WHAT THESE PROVE: the schema declares the expected fields, enums, defaults,
// cross-field rules, immutability, and index declarations. Nothing here connects
// to MongoDB or any external service, loads an environment file, or touches an
// existing record.
//
// WHAT THESE DO NOT PROVE: that any index exists in a running database, that a
// query planner chooses one, or that any query got faster. Those are runtime
// facts, verifiable only against a real database. Do not cite these tests as
// evidence of them.
//
// Validation runs through async `Document.prototype.validate()`, not the
// deprecated `validateSync()`. Besides being the API Mongoose 10 keeps, only the
// async path runs the schema's `pre("validate")` cross-field hook, so the
// resource-pairing and actor-role rules cannot be checked synchronously.

const EXPECTED_CATEGORIES = [
  "authentication",
  "account",
  "password_reset",
  "reporting",
  "authorization",
  "analysis",
  "training",
  "administration"
];

const EXPECTED_OUTCOMES = ["success", "failure"];

const EXPECTED_ROLES = [null, "user", "staff", "admin"];

const EXPECTED_RESOURCE_TYPES = [
  null,
  "user",
  "analysis",
  "report",
  "report_message",
  "training_completion",
  "awareness_assessment",
  "phishing_identification_assessment"
];

const IMMUTABLE_FIELDS = [
  "category",
  "action",
  "outcome",
  "actor",
  "actorRole",
  "targetUser",
  "resourceType",
  "resourceId"
];

function createValidAuditLogData(overrides = {}) {
  return {
    category: "authentication",
    action: "LOGIN_SUCCESS",
    outcome: "success",
    ...overrides
  };
}

// Returns the ValidationError thrown by `validate()`, or null when the document
// is valid. Lets each test inspect `error.errors[field]` directly.
async function validationError(document) {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
}

function findNamedIndex(schema, name) {
  return schema.indexes().find(([, options]) => options?.name === name);
}

test("a minimal audit entry validates with null references by default", async () => {
  const document = new AuditLog(createValidAuditLogData());

  assert.equal(await validationError(document), null);
  assert.equal(document.actor, null);
  assert.equal(document.actorRole, null);
  assert.equal(document.targetUser, null);
  assert.equal(document.resourceType, null);
  assert.equal(document.resourceId, null);
});

test("a fully populated audit entry validates", async () => {
  const document = new AuditLog(
    createValidAuditLogData({
      category: "authorization",
      action: "ROLE_CHANGED",
      outcome: "success",
      actor: new mongoose.Types.ObjectId(),
      actorRole: "admin",
      targetUser: new mongoose.Types.ObjectId(),
      resourceType: "user",
      resourceId: new mongoose.Types.ObjectId()
    })
  );

  assert.equal(await validationError(document), null);
});

test("category, action, and outcome are required", async () => {
  const error = await validationError(new AuditLog({}));

  assert.ok(error, "an empty document must fail validation");
  assert.ok(error.errors.category, "category must be required");
  assert.ok(error.errors.action, "action must be required");
  assert.ok(error.errors.outcome, "outcome must be required");
});

test("the schema is closed to arbitrary or free-form metadata", async () => {
  const document = new AuditLog(
    createValidAuditLogData({
      // A caller attempting to smuggle sensitive or unstructured values into
      // the audit record. `strict: true` must drop all of these.
      password: "super-secret",
      token: "jwt-token-value",
      metadata: { anything: true },
      details: "some free text",
      body: { email: "a@b.test" }
    })
  );

  assert.equal(await validationError(document), null);

  for (const forbidden of [
    "password",
    "token",
    "metadata",
    "details",
    "body"
  ]) {
    assert.equal(
      Object.hasOwn(AuditLog.schema.paths, forbidden),
      false,
      `${forbidden} must not be a schema field`
    );
    assert.equal(
      document.get(forbidden),
      undefined,
      `${forbidden} must never be stored`
    );
  }
});

test("no schema path uses the Mixed type", () => {
  for (const [name, path] of Object.entries(AuditLog.schema.paths)) {
    assert.notEqual(
      path.instance,
      "Mixed",
      `${name} must not be an arbitrary Mixed value`
    );
  }
});

test("every audit field is immutable", () => {
  for (const field of IMMUTABLE_FIELDS) {
    assert.equal(
      AuditLog.schema.path(field).options.immutable,
      true,
      `${field} should be immutable so an entry cannot be rewritten`
    );
  }
});

test("the outcome enum is exactly success or failure", () => {
  assert.deepEqual(
    AuditLog.schema.path("outcome").enumValues,
    EXPECTED_OUTCOMES
  );
});

test("the category enum is the approved closed set", () => {
  assert.deepEqual(
    AuditLog.schema.path("category").enumValues,
    EXPECTED_CATEGORIES
  );
});

test("the actorRole enum is null or an existing role", () => {
  assert.deepEqual(
    AuditLog.schema.path("actorRole").enumValues,
    EXPECTED_ROLES
  );
});

test("the resourceType enum is the approved closed set", () => {
  assert.deepEqual(
    AuditLog.schema.path("resourceType").enumValues,
    EXPECTED_RESOURCE_TYPES
  );
});

test("an unknown enum value is rejected for each enumerated field", async () => {
  const cases = [
    ["category", "not-a-category"],
    ["outcome", "maybe"],
    ["actorRole", "superuser"],
    ["resourceType", "not-a-resource"]
  ];

  for (const [field, value] of cases) {
    const document = new AuditLog(
      createValidAuditLogData({ [field]: value })
    );
    const error = await validationError(document);

    assert.ok(
      error && error.errors[field],
      `${field} must reject the value "${value}"`
    );
  }
});

test("action is trimmed and upper-cased", () => {
  const document = new AuditLog(
    createValidAuditLogData({ action: "  login_success  " })
  );

  assert.equal(document.action, "LOGIN_SUCCESS");
});

test("action rejects values that are not upper-case tokens", async () => {
  for (const action of [
    "login success",
    "LOGIN-SUCCESS",
    "1LOGIN",
    "LOGIN.SUCCESS"
  ]) {
    const document = new AuditLog(createValidAuditLogData({ action }));
    const error = await validationError(document);

    assert.ok(
      error && error.errors.action,
      `action must reject "${action}"`
    );
  }
});

test("action is bounded to 64 characters", async () => {
  const atLimit = new AuditLog(
    createValidAuditLogData({ action: `A${"B".repeat(63)}` })
  );
  const overLimit = new AuditLog(
    createValidAuditLogData({ action: `A${"B".repeat(64)}` })
  );

  assert.equal(await validationError(atLimit), null);
  assert.ok((await validationError(overLimit)).errors.action);
});

test("actor and targetUser reference the User collection", () => {
  assert.equal(AuditLog.schema.path("actor").options.ref, "User");
  assert.equal(AuditLog.schema.path("targetUser").options.ref, "User");
});

test("resourceType and resourceId must be provided together", async () => {
  const onlyType = new AuditLog(
    createValidAuditLogData({ resourceType: "report" })
  );
  const onlyId = new AuditLog(
    createValidAuditLogData({ resourceId: new mongoose.Types.ObjectId() })
  );

  assert.ok(
    (await validationError(onlyType))?.errors.resourceId,
    "a resourceType without a resourceId must be rejected"
  );
  assert.ok(
    (await validationError(onlyId))?.errors.resourceId,
    "a resourceId without a resourceType must be rejected"
  );
});

test("a paired resourceType and resourceId validates", async () => {
  const document = new AuditLog(
    createValidAuditLogData({
      resourceType: "report",
      resourceId: new mongoose.Types.ObjectId()
    })
  );

  assert.equal(await validationError(document), null);
});

test("actorRole is rejected when no actor is present", async () => {
  const document = new AuditLog(
    createValidAuditLogData({ actor: null, actorRole: "admin" })
  );

  assert.ok(
    (await validationError(document))?.errors.actorRole,
    "an actorRole without an actor must be rejected"
  );
});

test("actorRole is accepted when an actor is present", async () => {
  const document = new AuditLog(
    createValidAuditLogData({
      actor: new mongoose.Types.ObjectId(),
      actorRole: "admin"
    })
  );

  assert.equal(await validationError(document), null);
});

test("the record is timestamped at creation only", () => {
  // `updatedAt` is deliberately absent: the entry is append-only and must never
  // appear to have been modified after it was written.
  assert.deepEqual(AuditLog.schema.options.timestamps, {
    createdAt: true,
    updatedAt: false
  });
  assert.ok(AuditLog.schema.paths.createdAt, "createdAt must be declared");
  assert.equal(
    Object.hasOwn(AuditLog.schema.paths, "updatedAt"),
    false,
    "updatedAt must not be declared"
  );
});

test("the schema is strict", () => {
  assert.equal(AuditLog.schema.options.strict, true);
});

test("the model targets the auditLogs collection", () => {
  assert.equal(AuditLog.collection.collectionName, "auditLogs");
});

test("the recent-audit index is declared with the approved shape and name", () => {
  const index = findNamedIndex(AuditLog.schema, "audit_log_recent");

  assert.ok(index, 'an index named "audit_log_recent" must be declared');

  const [fields, options] = index;

  assert.deepEqual(Object.keys(fields), ["createdAt", "_id"]);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);
  assert.notEqual(options.unique, true);
});

test("the actor-history index is declared with the approved shape and name", () => {
  const index = findNamedIndex(AuditLog.schema, "audit_log_actor_history");

  assert.ok(index, 'an index named "audit_log_actor_history" must be declared');

  const [fields, options] = index;

  assert.deepEqual(Object.keys(fields), ["actor", "createdAt", "_id"]);
  assert.equal(fields.actor, 1);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);
  assert.notEqual(options.unique, true);
});

test("the target-user-history index is declared with the approved shape and name", () => {
  const index = findNamedIndex(
    AuditLog.schema,
    "audit_log_target_user_history"
  );

  assert.ok(
    index,
    'an index named "audit_log_target_user_history" must be declared'
  );

  const [fields, options] = index;

  assert.deepEqual(Object.keys(fields), ["targetUser", "createdAt", "_id"]);
  assert.equal(fields.targetUser, 1);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);
  assert.notEqual(options.unique, true);
});

test("the category-outcome-history index is declared with the approved shape and name", () => {
  const index = findNamedIndex(
    AuditLog.schema,
    "audit_log_category_outcome_history"
  );

  assert.ok(
    index,
    'an index named "audit_log_category_outcome_history" must be declared'
  );

  const [fields, options] = index;

  assert.deepEqual(Object.keys(fields), [
    "category",
    "outcome",
    "createdAt",
    "_id"
  ]);
  assert.equal(fields.category, 1);
  assert.equal(fields.outcome, 1);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);
  assert.notEqual(options.unique, true);
});

test("AuditLog declares exactly the four approved indexes", () => {
  const indexes = AuditLog.schema.indexes();

  assert.deepEqual(
    indexes.map(([, options]) => options?.name).sort(),
    [
      "audit_log_actor_history",
      "audit_log_category_outcome_history",
      "audit_log_recent",
      "audit_log_target_user_history"
    ]
  );
});
