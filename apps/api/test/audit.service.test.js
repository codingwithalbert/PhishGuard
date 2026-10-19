const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createAuditService,
  recordAuditEvent,
  AuditServiceError,
  AUDIT_ERROR_CODES,
  ALLOWED_AUDIT_FIELDS
} = require("../src/services/audit.service");

// Offline tests for the persistent audit-writing service.
//
// The model is injected as a fake in every test, so nothing here connects to
// MongoDB or any external service, loads an environment file, or writes a real
// record. Requiring the service module only registers the AuditLog schema; it
// does not open a connection.

const ACTOR_ID = "64b7f8e2a1b2c3d4e5f6a7b8";
const TARGET_ID = "64b7f8e2a1b2c3d4e5f6a7b9";
const RESOURCE_ID = "64b7f8e2a1b2c3d4e5f6a7c0";

function validEvent(overrides = {}) {
  return {
    category: "authentication",
    action: "LOGIN_SUCCESS",
    outcome: "success",
    ...overrides
  };
}

// A stand-in for the AuditLog model that records every create() call, including
// any second (options) argument, and can be told to fail. It deliberately exposes
// no schema, so validation falls back to the real AuditLog schema.
//
// `create()` also mirrors Mongoose's own argument handling: a non-array first
// argument is a single document, an array first argument is a batch. `calls`
// records the unwrapped documents, while `args` records the raw call arguments
// so a test can assert the exact `create([doc], { session })` shape.
function createFakeAuditModel({ error = null } = {}) {
  const calls = [];
  const options = [];
  const args = [];

  return {
    calls,
    options,
    args,
    async create(...createArgs) {
      const [document, createOptions] = createArgs;
      const documents = Array.isArray(document) ? document : [document];

      for (const doc of documents) {
        calls.push(doc);
      }
      options.push(createOptions);
      args.push(createArgs);

      if (error) {
        throw error;
      }

      const created = documents.map((doc) => ({
        _id: "audit-record-1",
        ...doc
      }));

      return Array.isArray(document) ? created : created[0];
    }
  };
}

// A stand-in MongoDB session. Only `endSession()` is required by the service.
function createFakeSession(id = "fake-session") {
  return {
    id,
    async endSession() {}
  };
}

function serviceWith(model) {
  return createAuditService({ auditModel: model });
}

function rejectsWithCode(code) {
  return (error) => {
    assert.ok(
      error instanceof AuditServiceError,
      `expected an AuditServiceError, got ${error && error.name}`
    );
    assert.equal(error.code, code);
    return true;
  };
}

test("a valid event is persisted and returned", async () => {
  const model = createFakeAuditModel();
  const created = await serviceWith(model)(validEvent());

  assert.equal(created.category, "authentication");
  assert.equal(created.action, "LOGIN_SUCCESS");
  assert.equal(created.outcome, "success");
  assert.equal(model.calls.length, 1);
});

test("only allowlisted fields are forwarded to the model", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  await service(
    validEvent({
      actor: ACTOR_ID,
      actorRole: "user",
      targetUser: TARGET_ID,
      resourceType: "report",
      resourceId: RESOURCE_ID
    })
  );

  assert.deepEqual(Object.keys(model.calls[0]).sort(), [
    "action",
    "actor",
    "actorRole",
    "category",
    "outcome",
    "resourceId",
    "resourceType",
    "targetUser"
  ]);
});

test("the action is normalized to an upper-case token", async () => {
  const model = createFakeAuditModel();
  const created = await serviceWith(model)(
    validEvent({ action: "  password_changed  " })
  );

  assert.equal(created.action, "PASSWORD_CHANGED");
  assert.equal(model.calls[0].action, "PASSWORD_CHANGED");
});

test("the exported default recorder is a function", () => {
  assert.equal(typeof recordAuditEvent, "function");
});

test("a non-object event is rejected", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  for (const input of [null, undefined, "LOGIN_SUCCESS", 42, []]) {
    await assert.rejects(
      () => service(input),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0, "no invalid input may reach the model");
});

test("missing required fields are rejected before persistence", async () => {
  const service = serviceWith(createFakeAuditModel());

  for (const input of [
    {},
    { category: "authentication" },
    { category: "authentication", action: "LOGIN_SUCCESS" },
    { action: "LOGIN_SUCCESS", outcome: "success" },
    { category: "   ", action: "LOGIN_SUCCESS", outcome: "success" }
  ]) {
    await assert.rejects(
      () => service(input),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }
});

test("an invalid category is rejected", async () => {
  const model = createFakeAuditModel();

  await assert.rejects(
    () => serviceWith(model)(validEvent({ category: "not-a-category" })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("every configured category is accepted", async () => {
  for (const category of [
    "authentication",
    "account",
    "password_reset",
    "reporting",
    "authorization",
    "analysis",
    "training",
    "administration"
  ]) {
    const model = createFakeAuditModel();
    const created = await serviceWith(model)(validEvent({ category }));

    assert.equal(created.category, category);
  }
});

test("an invalid outcome is rejected", async () => {
  const model = createFakeAuditModel();

  await assert.rejects(
    () => serviceWith(model)(validEvent({ outcome: "maybe" })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("an invalid action token is rejected", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  for (const action of [
    "LOGIN SUCCESS",
    "LOGIN-SUCCESS",
    "1LOGIN",
    "LOGIN.SUCCESS",
    `A${"B".repeat(64)}`
  ]) {
    await assert.rejects(
      () => service(validEvent({ action })),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0);
});

test("unexpected fields are rejected, not silently dropped", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  for (const extra of [
    { password: "super-secret" },
    { token: "jwt-token-value" },
    { metadata: { anything: true } },
    { body: { email: "a@b.test" } },
    { createdAt: new Date() },
    { _id: "64b7f8e2a1b2c3d4e5f6a7ff" }
  ]) {
    await assert.rejects(
      () => service(validEvent(extra)),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(
    model.calls.length,
    0,
    "an event with an unexpected field must never reach the model"
  );
});

test("the unexpected-field message is fixed and echoes no caller text", async () => {
  const service = serviceWith(createFakeAuditModel());

  const error = await service(
    validEvent({ password: "super-secret", token: "jwt-token-value" })
  ).then(
    () => null,
    (rejection) => rejection
  );

  assert.ok(error instanceof AuditServiceError);
  assert.equal(error.code, AUDIT_ERROR_CODES.INVALID_INPUT);
  assert.equal(error.message, "Audit event contains unsupported fields");
  // Neither the offending key names nor their values may appear.
  for (const leaked of ["password", "token", "super-secret", "jwt-token-value"]) {
    assert.equal(error.message.includes(leaked), false);
  }
});

test("non-plain event containers are rejected", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  class CustomEvent {
    constructor() {
      Object.assign(this, validEvent());
    }
  }

  const inputs = [
    new Date(),
    new Map([["category", "authentication"]]),
    new Set(["authentication"]),
    Buffer.from("authentication"),
    /authentication/,
    new CustomEvent(),
    Object.assign(Object.create({ inherited: true }), validEvent())
  ];

  for (const input of inputs) {
    await assert.rejects(
      () => service(input),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0);
});

test("a null-prototype event object is accepted", async () => {
  const model = createFakeAuditModel();
  const event = Object.assign(Object.create(null), validEvent());

  const created = await serviceWith(model)(event);

  assert.equal(created.action, "LOGIN_SUCCESS");
  assert.equal(model.calls.length, 1);
});

test("a session is passed to the model with the array form and the session as the only option", async () => {
  const session = createFakeSession();
  const model = createFakeAuditModel();

  const created = await serviceWith(model)(validEvent(), { session });

  // Mongoose only forwards options when the first argument is an array; a
  // non-array first argument would be read as a second document.
  assert.equal(model.args.length, 1);
  assert.equal(model.args[0].length, 2);
  assert.equal(
    Array.isArray(model.args[0][0]),
    true,
    "the event must be passed as an array so Mongoose forwards the options"
  );
  assert.equal(model.args[0][0].length, 1);
  assert.equal(model.args[0][0][0], model.calls[0]);
  assert.deepEqual(model.args[0][1], { session });
  assert.equal(model.args[0][1].session, session);
  // A session call still returns a single record, not an array.
  assert.equal(Array.isArray(created), false);
  // The session is never merged into the audit document.
  assert.equal(Object.hasOwn(model.calls[0], "session"), false);
});

test("no session means the model is called with the event alone", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  await service(validEvent());
  await service(validEvent(), {});
  await service(validEvent(), { session: null });
  await service(validEvent(), { session: undefined });

  for (const callArgs of model.args) {
    assert.equal(callArgs.length, 1, "create() must receive no options object");
    assert.equal(callArgs[1], undefined);
  }

  assert.equal(model.options.every((value) => value === undefined), true);
});

test("arbitrary persistence options are rejected", async () => {
  const session = createFakeSession();
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  const optionSets = [
    { writeConcern: { w: 1 } },
    { upsert: true },
    { new: true },
    { session, writeConcern: { w: 1 } },
    { session, upsert: true }
  ];

  for (const options of optionSets) {
    await assert.rejects(
      () => service(validEvent(), options),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0);
});

test("non-plain option objects are rejected", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  for (const options of [[], "session", 42, new Date(), new Map()]) {
    await assert.rejects(
      () => service(validEvent(), options),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0);
});

test("an invalid session value is rejected", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  for (const session of [
    {},
    { endSession: "not-a-function" },
    "session-id",
    42,
    [],
    () => {}
  ]) {
    await assert.rejects(
      () => service(validEvent(), { session }),
      rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
    );
  }

  assert.equal(model.calls.length, 0);
});

test("a session cannot be smuggled in as an event field", async () => {
  const model = createFakeAuditModel();

  await assert.rejects(
    () => serviceWith(model)(validEvent({ session: createFakeSession() })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("the allowlist contains only schema-backed fields", () => {
  assert.deepEqual([...ALLOWED_AUDIT_FIELDS].sort(), [
    "action",
    "actor",
    "actorRole",
    "category",
    "outcome",
    "resourceId",
    "resourceType",
    "targetUser"
  ]);
});

test("invalid actor and target identifiers are rejected", async () => {
  const service = serviceWith(createFakeAuditModel());

  for (const field of ["actor", "targetUser", "resourceId"]) {
    for (const value of ["not-an-id", "12345", 42, {}]) {
      await assert.rejects(
        () => service(validEvent({ [field]: value })),
        rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
      );
    }
  }
});

test("valid actor and target references are accepted", async () => {
  const model = createFakeAuditModel();
  const created = await serviceWith(model)(
    validEvent({
      actor: ACTOR_ID,
      actorRole: "admin",
      targetUser: TARGET_ID
    })
  );

  assert.equal(created.actor, ACTOR_ID);
  assert.equal(created.actorRole, "admin");
  assert.equal(created.targetUser, TARGET_ID);
});

test("an actorRole without an actor is rejected", async () => {
  const model = createFakeAuditModel();

  await assert.rejects(
    () => serviceWith(model)(validEvent({ actor: null, actorRole: "admin" })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("an unsupported actorRole is rejected", async () => {
  const model = createFakeAuditModel();

  await assert.rejects(
    () =>
      serviceWith(model)(
        validEvent({ actor: ACTOR_ID, actorRole: "superuser" })
      ),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("resourceType and resourceId must travel together", async () => {
  const model = createFakeAuditModel();
  const service = serviceWith(model);

  await assert.rejects(
    () => service(validEvent({ resourceType: "report" })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );
  await assert.rejects(
    () => service(validEvent({ resourceId: RESOURCE_ID })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );
  await assert.rejects(
    () => service(validEvent({ resourceType: "not-a-resource", resourceId: RESOURCE_ID })),
    rejectsWithCode(AUDIT_ERROR_CODES.INVALID_INPUT)
  );

  assert.equal(model.calls.length, 0);
});

test("a paired resource reference is accepted", async () => {
  const model = createFakeAuditModel();
  const created = await serviceWith(model)(
    validEvent({ resourceType: "analysis", resourceId: RESOURCE_ID })
  );

  assert.equal(created.resourceType, "analysis");
  assert.equal(created.resourceId, RESOURCE_ID);
});

test("a database failure propagates as a sanitized error", async () => {
  const secret =
    "mongodb+srv://audit-user:hunter2@cluster.example/auditLogs timeout after 30000ms";
  const model = createFakeAuditModel({ error: new Error(secret) });
  const service = serviceWith(model);

  await assert.rejects(() => service(validEvent()), (error) => {
    assert.ok(error instanceof AuditServiceError);
    assert.equal(error.name, "AuditServiceError");
    assert.equal(error.code, AUDIT_ERROR_CODES.PERSISTENCE_FAILED);
    assert.equal(error.message, "Failed to persist audit event");

    const serialized = `${error.message}\n${error.stack}`;
    assert.equal(serialized.includes(secret), false, "no driver text may leak");
    assert.equal(serialized.includes("hunter2"), false, "no credential may leak");
    assert.equal(error.cause, undefined, "the raw cause must not be attached");

    return true;
  });

  // The failure was not swallowed: the model was still attempted exactly once.
  assert.equal(model.calls.length, 1);
});

test("a model validation error is reported as a sanitized input error", async () => {
  const validationError = new Error("Path `category` is invalid (secret-value)");
  validationError.name = "ValidationError";

  const model = createFakeAuditModel({ error: validationError });

  await assert.rejects(
    () => serviceWith(model)(validEvent()),
    (error) => {
      assert.ok(error instanceof AuditServiceError);
      assert.equal(error.code, AUDIT_ERROR_CODES.INVALID_INPUT);
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    }
  );
});

test("the service exposes no update, delete, or upsert operation", () => {
  const serviceModule = require("../src/services/audit.service");

  for (const key of Object.keys(serviceModule)) {
    assert.doesNotMatch(
      key,
      /update|delete|remove|edit|patch|replace|upsert/i,
      `unexpected mutating export: ${key}`
    );
  }

  const service = serviceWith(createFakeAuditModel());

  assert.equal(typeof service.update, "undefined");
  assert.equal(typeof service.delete, "undefined");
  assert.equal(typeof service.remove, "undefined");
  assert.equal(typeof service.upsert, "undefined");
});

test("recording requires no database connection", async () => {
  // readyState 0 is "disconnected". Nothing in this file ever connects, and the
  // recorder must run to completion with the fake model while staying that way.
  assert.equal(mongoose.connection.readyState, 0);

  const model = createFakeAuditModel();
  await serviceWith(model)(validEvent());

  assert.equal(mongoose.connection.readyState, 0);
});
