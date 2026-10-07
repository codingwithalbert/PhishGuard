const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

const Analysis = require("../src/models/Analysis");
const AwarenessAssessment = require("../src/models/AwarenessAssessment");
const PhishingIdentificationAssessment =
  require("../src/models/PhishingIdentificationAssessment");
const TrainingCompletion = require("../src/models/TrainingCompletion");
const User = require("../src/models/User");
const errorHandler = require("../src/middleware/error.middleware");
const { authenticate } = require("../src/middleware/auth.middleware");

const analysisRoutes = require("../src/routes/analysis.routes");
const awarenessRoutes = require("../src/routes/awareness.routes");
const phishingIdentificationRoutes =
  require("../src/routes/phishingIdentification.routes");
const trainingRoutes = require("../src/routes/training.routes");
const dashboardRoutes = require("../src/routes/dashboard.routes");
const progressRoutes = require("../src/routes/progress.routes");

// Unauthenticated rejection for every protected endpoint in the six routers
// that previously had no safe HTTP-layer authorization coverage.
//
// The REAL routers and the REAL `authenticate` middleware are mounted, so these
// tests protect route wiring and middleware ordering rather than re-testing the
// middleware in isolation.
//
// No Authorization header is sent, so `authenticate` must answer 401 before it
// performs any User lookup or any controller runs. That is what makes this
// safe: the User model is never queried, so no database connection is needed.
//
// Persistence entry points are trapped fail-closed. If any controller or
// service were reached, a trap would throw instead of silently succeeding.

const AUTH_FAILURE_BODY = {
  success: false,
  error: "Authentication required"
};

// Every protected endpoint in the six routers, with the router it belongs to.
const PROTECTED_ENDPOINTS = [
  { label: "POST /api/analyze", method: "POST", path: "/api/analyze" },
  { label: "GET /api/analyze", method: "GET", path: "/api/analyze" },
  {
    label: "PATCH /api/analyze/:id",
    method: "PATCH",
    path: "/api/analyze/507f1f77bcf86cd799439011",
    body: { status: "reviewed" }
  },
  {
    label: "DELETE /api/analyze/:id",
    method: "DELETE",
    path: "/api/analyze/507f1f77bcf86cd799439011"
  },
  { label: "GET /api/awareness/questions", method: "GET", path: "/api/awareness/questions" },
  {
    label: "POST /api/awareness/submit",
    method: "POST",
    path: "/api/awareness/submit",
    body: { answers: [] }
  },
  { label: "GET /api/awareness/latest", method: "GET", path: "/api/awareness/latest" },
  {
    label: "GET /api/phishing-identification/scenarios",
    method: "GET",
    path: "/api/phishing-identification/scenarios"
  },
  {
    label: "POST /api/phishing-identification/submit",
    method: "POST",
    path: "/api/phishing-identification/submit",
    body: { answers: [] }
  },
  {
    label: "GET /api/phishing-identification/latest",
    method: "GET",
    path: "/api/phishing-identification/latest"
  },
  { label: "GET /api/training/modules", method: "GET", path: "/api/training/modules" },
  { label: "GET /api/training/progress", method: "GET", path: "/api/training/progress" },
  {
    label: "POST /api/training/modules/:moduleId/complete",
    method: "POST",
    path: "/api/training/modules/1/complete"
  },
  { label: "GET /api/dashboard/summary", method: "GET", path: "/api/dashboard/summary" },
  { label: "GET /api/progress", method: "GET", path: "/api/progress" }
];

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/analyze", analysisRoutes);
  app.use("/api/awareness", awarenessRoutes);
  app.use("/api/phishing-identification", phishingIdentificationRoutes);
  app.use("/api/training", trainingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/progress", progressRoutes);

  app.use(errorHandler);

  return app;
}

function persistenceTraps(t) {
  return [
    [User, "findOne"],
    [User, "findById"],
    [Analysis, "findOne"],
    [Analysis, "find"],
    [Analysis, "create"],
    [Analysis, "updateOne"],
    [Analysis, "deleteOne"],
    [AwarenessAssessment, "findOne"],
    [AwarenessAssessment, "find"],
    [AwarenessAssessment, "create"],
    [PhishingIdentificationAssessment, "findOne"],
    [PhishingIdentificationAssessment, "find"],
    [PhishingIdentificationAssessment, "create"],
    [TrainingCompletion, "findOne"],
    [TrainingCompletion, "find"],
    [TrainingCompletion, "create"],
    [mongoose.Query.prototype, "exec"]
  ].map(([target, operation]) => ({
    operation,
    spy: t.mock.method(target, operation, () => {
      throw new Error(`Unauthenticated request must not reach ${operation}`);
    })
  }));
}

test("every protected endpoint rejects an unauthenticated request without touching persistence", async (t) => {
  const traps = persistenceTraps(t);

  const app = buildApp();
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const endpoint of PROTECTED_ENDPOINTS) {
    const response = await fetch(`${baseUrl}${endpoint.path}`, {
      method: endpoint.method,
      headers: { "Content-Type": "application/json" },
      ...(endpoint.body === undefined
        ? {}
        : { body: JSON.stringify(endpoint.body) })
    });

    const text = await response.text();

    assert.equal(response.status, 401, `${endpoint.label} must answer 401`);
    assert.deepEqual(
      JSON.parse(text),
      AUTH_FAILURE_BODY,
      `${endpoint.label} must use the standard authentication failure body`
    );
  }

  for (const { operation, spy } of traps) {
    assert.equal(
      spy.mock.callCount(),
      0,
      `${operation} must not run for an unauthenticated request`
    );
  }

  // No connection was opened: the User lookup in `authenticate` is never
  // reached without a token.
  assert.equal(mongoose.connection.readyState, 0);
});

test("authentication is the first handler on every protected route", () => {
  const routers = [
    ["analysis", analysisRoutes],
    ["awareness", awarenessRoutes],
    ["phishingIdentification", phishingIdentificationRoutes],
    ["training", trainingRoutes],
    ["dashboard", dashboardRoutes],
    ["progress", progressRoutes]
  ];

  let inspected = 0;

  for (const [name, router] of routers) {
    for (const layer of router.stack) {
      if (!layer.route) {
        continue;
      }

      const methods = Object.keys(layer.route.methods).join(",").toUpperCase();

      inspected += 1;

      assert.equal(
        layer.route.stack[0].handle,
        authenticate,
        `${name} ${layer.route.path} (${methods}) must run authenticate first`
      );
      assert.ok(
        layer.route.stack.length > 0,
        `${name} ${layer.route.path} must have handlers`
      );
    }
  }

  // Guards against the loop silently covering nothing if a router is restructured.
  assert.equal(inspected, PROTECTED_ENDPOINTS.length);
});

test("an unauthenticated request is rejected before route validation runs", async (t) => {
  const traps = persistenceTraps(t);
  const app = buildApp();
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A deliberately invalid id and an invalid assessment body would produce 400
  // if validation ran first. Because authentication is wired first, the answer
  // is 401, which proves the ordering rather than merely the presence of the
  // middleware.
  const malformedId = await fetch(`${baseUrl}/api/analyze/not-an-id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "nonsense" })
  });

  assert.equal(malformedId.status, 401);

  const malformedBody = await fetch(`${baseUrl}/api/awareness/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: "not-an-array" })
  });

  assert.equal(malformedBody.status, 401);

  for (const { operation, spy } of traps) {
    assert.equal(spy.mock.callCount(), 0, operation);
  }
});