const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuditLog = require("../src/models/AuditLog");
const { createAuditService } = require("../src/services/audit.service");

// Offline regression coverage for the session path of `recordAuditEvent`.
//
// The fake-model tests in `audit.service.test.js` assert the *shape* of the call
// the service makes, but a fake `create()` accepts any argument shape, so it
// cannot catch a wrong call into Mongoose's real `Model.create()`. These tests
// therefore drive the REAL AuditLog model and patch only its internal `$save`
// (the method `Model.create()` calls to dispatch a document). A real save would
// need a connection; the patch captures the dispatch instead, so nothing here
// opens a connection, loads an environment file, or writes a record.
//
// This is the regression guard for the defect where `create(doc, { session })`
// made Mongoose treat the options object as a second document and drop the
// session: that form dispatched TWO documents and escaped the transaction.

const EVENT = {
  category: "administration",
  action: "USER_ROLE_CHANGED",
  outcome: "success"
};

// A session-like stand-in. The service only requires `endSession()`; a real
// Mongoose ClientSession would need a live connection and is out of scope here.
function fakeSession() {
  return {
    id: "offline-session",
    async endSession() {}
  };
}

// Wraps `AuditLog.create` to capture its raw arguments and shadows the model's
// `$save` (inherited from the base model, so not an own property) to capture the
// documents that reach dispatch. Both are restored exactly, including removing
// the shadowing own properties.
function instrument() {
  const createArgs = [];
  const dispatched = [];

  const hadOwnCreate = Object.prototype.hasOwnProperty.call(AuditLog, "create");
  const originalCreate = AuditLog.create;
  const hadOwnSave = Object.prototype.hasOwnProperty.call(
    AuditLog.prototype,
    "$save"
  );
  const originalSave = AuditLog.prototype.$save;

  AuditLog.create = async function create(...args) {
    createArgs.push(args);
    return originalCreate.apply(this, args);
  };

  AuditLog.prototype.$save = function $save(options) {
    dispatched.push({ document: this, options });
    return Promise.resolve(this);
  };

  return {
    createArgs,
    dispatched,
    restore() {
      if (hadOwnCreate) {
        AuditLog.create = originalCreate;
      } else {
        delete AuditLog.create;
      }

      if (hadOwnSave) {
        AuditLog.prototype.$save = originalSave;
      } else {
        delete AuditLog.prototype.$save;
      }
    }
  };
}

test("a session record uses the array form, dispatches one document, and returns a single record", async () => {
  const spy = instrument();

  try {
    const service = createAuditService({ auditModel: AuditLog });
    const session = fakeSession();

    const result = await service(EVENT, { session });

    // The correction: options are honored only when the first argument is an
    // array. A non-array first argument is read as a second document.
    assert.equal(spy.createArgs.length, 1, "create() must be called exactly once");
    assert.equal(
      spy.createArgs[0].length,
      2,
      "create() must receive the document array and the options"
    );
    assert.equal(
      Array.isArray(spy.createArgs[0][0]),
      true,
      "the first argument must be an array"
    );
    assert.equal(
      spy.createArgs[0][0].length,
      1,
      "the array must hold exactly one document"
    );
    assert.equal(
      spy.createArgs[0][1].session,
      session,
      "the session must be forwarded as the only option"
    );

    // Exactly one document reaches dispatch: the options object must never be
    // inserted as a second (empty) document.
    assert.equal(
      spy.dispatched.length,
      1,
      "exactly one document must be dispatched"
    );
    const saved = spy.dispatched[0];
    assert.ok(
      saved.document instanceof AuditLog,
      "the dispatched document must be a real AuditLog document"
    );
    assert.equal(saved.document.action, "USER_ROLE_CHANGED");
    assert.equal(
      saved.options.session,
      session,
      "the session must reach the underlying save()"
    );

    // The public return shape is a single record, not an array.
    assert.equal(
      Array.isArray(result),
      false,
      "the recorder must return one record, not an array"
    );
    assert.equal(result, saved.document);

    assert.equal(
      mongoose.connection.readyState,
      0,
      "no database connection may be opened"
    );
  } finally {
    spy.restore();
  }
});

test("a record without a session passes one document and no options object", async () => {
  const spy = instrument();

  try {
    const service = createAuditService({ auditModel: AuditLog });

    const result = await service(EVENT);

    assert.equal(spy.createArgs.length, 1);
    assert.equal(
      spy.createArgs[0].length,
      1,
      "create() must receive the document alone when there is no session"
    );
    assert.equal(
      Array.isArray(spy.createArgs[0][0]),
      false,
      "no document array (and therefore no options) is used without a session"
    );
    assert.equal(spy.createArgs[0][0].action, "USER_ROLE_CHANGED");
    assert.equal(
      spy.dispatched.length,
      1,
      "exactly one document must be dispatched"
    );
    assert.equal(spy.dispatched[0].options.session, undefined);
    assert.equal(Array.isArray(result), false);
    assert.equal(result.action, "USER_ROLE_CHANGED");
    assert.equal(
      mongoose.connection.readyState,
      0,
      "no database connection may be opened"
    );
  } finally {
    spy.restore();
  }
});
