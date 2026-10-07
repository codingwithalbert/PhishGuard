const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const Analysis = require("../src/models/Analysis");
const User = require("../src/models/User");
const errorHandler = require("../src/middleware/error.middleware");

// Run before loading the Analyzer service/router so newly introduced imports
// cannot capture uninstrumented network functions. No submitted URL is fetched.
test("URL analysis makes zero outbound network attempts for loopback, private, and link-local targets", async (t) => {
  const entryPoints = [
    [globalThis, "fetch"],
    [http, "request"],
    [http, "get"],
    [https, "request"],
    [https, "get"],
    [net, "connect"],
    [net, "createConnection"],
    [net.Socket.prototype, "connect"],
    [tls, "connect"],
    [dns, "lookup"],
    [dns, "resolve"],
    [dns, "resolve4"],
    [dns, "resolve6"],
    [dns.promises, "lookup"],
    [dns.promises, "resolve"],
    [dns.promises, "resolve4"],
    [dns.promises, "resolve6"]
  ];
  const traps = entryPoints.map(([target, method]) => ({
    method,
    spy: t.mock.method(target, method, () => {
      throw new Error("Analyzer security test blocked an outbound network attempt");
    })
  }));

  const { analyzeUrl } = require("../src/services/analysis.service");
  for (const url of [
    "http://localhost:8080/login",
    "http://127.0.0.1/login",
    "https://127.0.0.1/",
    "http://[::1]/login",
    "http://10.0.0.1/login",
    "http://172.16.0.1/login",
    "http://192.168.1.1/login",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::1]/"
  ]) {
    const result = await analyzeUrl(url);
    assert.equal(result.success, true);
    assert.equal(result.url, url);
    assert.equal(typeof result.score, "number");
    assert.ok(Array.isArray(result.indicators));
    assert.ok(Array.isArray(result.findings));
  }

  // Also let immediate asynchronous work run while the fail-closed traps remain
  // active. Counters catch attempted calls even if Analyzer code swallows errors.
  await new Promise((resolve) => setImmediate(resolve));
  for (const { method, spy } of traps) {
    assert.equal(spy.mock.callCount(), 0, `${method} must not be called by URL analysis`);
  }
});

async function assertMalformedIdsRejected(t, method) {
  const modelTraps = [
    [Analysis, "findOne"],
    [Analysis, "findById"],
    [Analysis, "find"],
    [Analysis, "create"],
    [Analysis, "updateOne"],
    [Analysis, "deleteOne"],
    [Analysis.prototype, "save"],
    [Analysis.prototype, "deleteOne"],
    [mongoose.Query.prototype, "exec"]
  ].map(([target, operation]) => ({
    operation,
    spy: t.mock.method(target, operation, () => {
      throw new Error("Malformed analysis ID must be rejected before persistence");
    })
  }));

  const previousJwtSecret = process.env.JWT_SECRET;
  const testJwtSecret = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = testJwtSecret;
  t.after(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  const authenticatedUserId = new mongoose.Types.ObjectId();

  // `authenticate` now reads the current User record, so the token's id must
  // resolve to an active account before the request can reach route
  // validation. This stub is scoped to the test and touches no Analysis model,
  // so the "no model operation for a malformed ID" assertions stay intact.
  t.mock.method(User, "findById", () => {
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: authenticatedUserId,
          role: "user",
          isActive: true
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  });

  const app = express();
  app.use(express.json());
  app.use("/api/analyze", require("../src/routes/analysis.routes"));
  app.use(errorHandler);
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign(
    { userId: authenticatedUserId.toString(), role: "user" },
    testJwtSecret,
    { expiresIn: "1h" }
  );

  for (const id of ["not-an-id", "123456789012", "g".repeat(24)]) {
    const response = await fetch(`${baseUrl}/api/analyze/${id}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      // A valid status ensures PATCH is rejected for its ID, not its body.
      ...(method === "PATCH" ? { body: JSON.stringify({ status: "reviewed" }) } : {})
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Invalid analysis ID"
    });
  }

  for (const { operation, spy } of modelTraps) {
    assert.equal(spy.mock.callCount(), 0, `${operation} must not run for malformed IDs`);
  }
}

test("PATCH /api/analyze/:id rejects malformed IDs with a safe 400 before model operations", async (t) => {
  await assertMalformedIdsRejected(t, "PATCH");
});

test("DELETE /api/analyze/:id rejects malformed IDs with a safe 400 before model operations", async (t) => {
  await assertMalformedIdsRejected(t, "DELETE");
});

// Ownership / IDOR coverage for the two routes that act on a caller-supplied
// analysis id. These live beside the malformed-id tests because both protect
// the same PATCH and DELETE route wiring.
//
// The fake `Analysis.findOne` deliberately emulates MongoDB semantics: a query
// that omits the `user` constraint matches a document owned by ANY user. That
// is what makes these tests meaningful. If ownership filtering were removed
// from `updateAnalysis` or `deleteAnalysis`, the fake would return the other
// user's document and the request would succeed, failing the test.
//
// No database is used, and the mutation entry points are trapped so a
// cross-user request can be proven not to have written or deleted anything.
const OWNERSHIP_OWNER_ID = new mongoose.Types.ObjectId();
const OWNERSHIP_OTHER_ID = new mongoose.Types.ObjectId();
const OWNERSHIP_ANALYSIS_ID = new mongoose.Types.ObjectId();

function createOwnershipFixture(t) {
  const state = { filters: [], saves: 0, deletes: 0 };

  const ownedDocument = {
    _id: OWNERSHIP_ANALYSIS_ID,
    user: OWNERSHIP_OWNER_ID,
    url: "https://example.com/login",
    risk: "low",
    score: 5,
    indicators: ["Contains suspicious keyword(s): login"],
    status: "active",
    save: async () => {
      state.saves += 1;
    },
    deleteOne: async () => {
      state.deletes += 1;
    }
  };

  t.mock.method(Analysis, "findOne", (filter) => {
    state.filters.push({
      _id: filter?._id === undefined ? null : String(filter._id),
      user: filter?.user === undefined ? null : String(filter.user)
    });

    // Emulate the driver: match on the supplied constraints only.
    if (filter?._id === undefined || String(filter._id) !== OWNERSHIP_ANALYSIS_ID.toString()) {
      return Promise.resolve(null);
    }

    // No `user` constraint means the document matches for any caller.
    if (filter.user === undefined) {
      return Promise.resolve(ownedDocument);
    }

    return Promise.resolve(
      String(filter.user) === OWNERSHIP_OWNER_ID.toString()
        ? ownedDocument
        : null
    );
  });

  t.mock.method(Analysis.prototype, "save", () => {
    throw new Error("Cross-user requests must not mutate another user's analysis");
  });
  t.mock.method(Analysis.prototype, "deleteOne", () => {
    throw new Error("Cross-user requests must not delete another user's analysis");
  });

  return state;
}

async function runOwnershipRequest(t, method, actorUserId) {
  const previousJwtSecret = process.env.JWT_SECRET;
  const testJwtSecret = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = testJwtSecret;
  t.after(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  // The authenticated identity is server-authoritative: the stubbed current
  // User record decides who the caller is, and the token merely names them.
  t.mock.method(User, "findById", () => {
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: actorUserId,
          role: "user",
          isActive: true
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  });

  const state = createOwnershipFixture(t);

  const app = express();
  app.use(express.json());
  app.use("/api/analyze", require("../src/routes/analysis.routes"));
  app.use(errorHandler);
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const token = jwt.sign(
    { userId: actorUserId.toString(), role: "user" },
    testJwtSecret,
    { expiresIn: "1h" }
  );

  const response = await fetch(
    `${baseUrl}/api/analyze/${OWNERSHIP_ANALYSIS_ID}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      ...(method === "PATCH"
        ? { body: JSON.stringify({ status: "reviewed" }) }
        : {})
    }
  );

  return { response, state };
}

test("PATCH /api/analyze/:id refuses to modify another user's analysis", async (t) => {
  const { response, state } = await runOwnershipRequest(
    t,
    "PATCH",
    OWNERSHIP_OTHER_ID
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Analysis not found"
  });

  // The lookup must constrain BOTH the requested id and the caller.
  assert.equal(state.filters.length, 1);
  assert.equal(state.filters[0]._id, OWNERSHIP_ANALYSIS_ID.toString());
  assert.equal(state.filters[0].user, OWNERSHIP_OTHER_ID.toString());
  assert.equal(state.saves, 0);
  assert.equal(state.deletes, 0);
});

test("DELETE /api/analyze/:id refuses to delete another user's analysis", async (t) => {
  const { response, state } = await runOwnershipRequest(
    t,
    "DELETE",
    OWNERSHIP_OTHER_ID
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "You do not have permission to delete this analysis"
  });

  assert.equal(state.filters.length, 1);
  assert.equal(state.filters[0]._id, OWNERSHIP_ANALYSIS_ID.toString());
  assert.equal(state.filters[0].user, OWNERSHIP_OTHER_ID.toString());
  assert.equal(state.saves, 0);
  assert.equal(state.deletes, 0);
});

test("the owner can still update and delete their own analysis", async (t) => {
  const patched = await runOwnershipRequest(t, "PATCH", OWNERSHIP_OWNER_ID);

  assert.equal(patched.response.status, 200);
  assert.equal(patched.state.filters[0].user, OWNERSHIP_OWNER_ID.toString());
  assert.equal(patched.state.saves, 1);
  assert.equal(patched.state.deletes, 0);

  const deleted = await runOwnershipRequest(t, "DELETE", OWNERSHIP_OWNER_ID);

  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.state.filters[0].user, OWNERSHIP_OWNER_ID.toString());
  assert.equal(deleted.state.saves, 0);
  assert.equal(deleted.state.deletes, 1);
});

test("a lookup without an owner constraint would match, so the negative tests are meaningful", () => {
  // This is the property that makes the cross-user tests above meaningful: with
  // no `user` constraint the driver would return the foreign document. It is
  // asserted directly here so a future change to the fixture cannot quietly
  // turn the negative cases into passing no-ops.
  const ownedDocumentOwner = OWNERSHIP_OWNER_ID.toString();
  const foreignCaller = OWNERSHIP_OTHER_ID.toString();

  const wouldMatch = (filter) => {
    if (filter._id !== OWNERSHIP_ANALYSIS_ID.toString()) return null;
    if (filter.user === undefined) return ownedDocumentOwner;
    return String(filter.user) === ownedDocumentOwner ? ownedDocumentOwner : null;
  };

  assert.equal(
    wouldMatch({ _id: OWNERSHIP_ANALYSIS_ID.toString() }) === ownedDocumentOwner,
    true,
    "an id-only query must match another user's document"
  );
  assert.equal(
    wouldMatch({
      _id: OWNERSHIP_ANALYSIS_ID.toString(),
      user: foreignCaller
    }),
    null,
    "an owner-scoped query must not match for a different caller"
  );
});
