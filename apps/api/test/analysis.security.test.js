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
