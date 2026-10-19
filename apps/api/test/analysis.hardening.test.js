const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");
const Analysis = require("../src/models/Analysis");
const errorHandler = require("../src/middleware/error.middleware");
const { authenticate } = require("../src/middleware/auth.middleware");
const {
  MAX_ANALYSIS_URL_LENGTH,
  validateAnalyzeRequest
} = require("../src/middleware/validate.middleware");
const {
  analyzeLimiter,
  authenticatedUserKey,
  AUTHENTICATED_LIMIT_MESSAGE,
  requireAuthenticatedIdentity
} = require("../src/middleware/rateLimit.middleware");
const analysisRoutes = require("../src/routes/analysis.routes");
const {
  MAX_ANALYSIS_URL_LENGTH: MODEL_MAX_LENGTH
} = require("../src/services/analysis.constants");

// Backend request hardening for URL analysis: the C-4 rate limiter and the
// B-1 maximum URL length.
//
// The real `authenticate`, identity guard, limiter, and validator are used. Only
// the terminal handler is replaced, so no heuristic evaluation and no database
// write ever runs: these tests measure the request boundary, not the work it
// protects. That is also what lets "validation happens before persistence" be
// asserted directly, by proving the terminal handler is never reached.
//
// A router captures its controller by reference at require time, so replacing a
// controller method cannot intercept a mounted route. Behavioural coverage
// therefore mounts the identical real middleware chain with a stub terminal
// handler, and a separate structural test asserts that the production router
// mounts exactly that chain in exactly that order.
//
// No MongoDB is used. Only the current-User lookup is faked, which is what makes
// `req.user.userId` available exactly as in production. Schema-level assertions
// use Mongoose validation, which runs in-process without a connection.
//
// Every fixture is synthetic. No real URL, account, or participant data is used.

const testJwtSecret = crypto.randomBytes(32).toString("hex");
const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = testJwtSecret;

const ANALYZE_LIMIT = 60;

const USER_A = new mongoose.Types.ObjectId().toString();
const USER_B = new mongoose.Types.ObjectId().toString();

// A long but entirely legitimate-looking query string, used to place the
// boundary tests without inventing a protocol or a malformed value.
const PADDING = "a".repeat(120);

function urlOfLength(length) {
  const prefix = "https://example.test/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
}

const AT_BOUNDARY = urlOfLength(MAX_ANALYSIS_URL_LENGTH);
const OVER_BOUNDARY = urlOfLength(MAX_ANALYSIS_URL_LENGTH + 1);

test.after(() => {
  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function stubActiveUsers(t) {
  t.mock.method(User, "findOne", (filter) => {
    const id = filter?._id;
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(String(id)),
          role: "user",
          isActive: true,
          tokenVersion: 0
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  });
}

function resetKeys(...ids) {
  return Promise.all(
    ids.map((id) => analyzeLimiter.resetKey(`u:${id}`))
  );
}

function tokenFor(userId) {
  return jwt.sign({ userId: String(userId), role: "user", tokenVersion: 0 }, testJwtSecret, {
    expiresIn: "1h"
  });
}

// Mirrors the production chain in analysis.routes.js exactly: authentication,
// the identity guard, the analysis limiter, then request validation.
function buildAnalyzeApp(state) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post(
    "/api/analyze",
    authenticate,
    requireAuthenticatedIdentity,
    analyzeLimiter,
    validateAnalyzeRequest,
    (req, res) => {
      state.downstream += 1;
      state.lastUrl = req.body.url;

      return res.status(201).json({ success: true, analysis: {} });
    }
  );
  app.use(errorHandler);
  return app;
}

async function serve(app, path, options = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) })
    });
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

function analyzeRequest(userId, url, extraHeaders = {}) {
  return {
    path: "/api/analyze",
    method: "POST",
    headers: {
      ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
      ...extraHeaders
    },
    body: { url }
  };
}

async function postAnalyze(app, request) {
  const response = await serve(app, request.path, request);

  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------
// Structural: the production router mounts the hardened chain in order
// ---------------------------------------------------------------------------

test("the analysis router mounts the limiter between authentication and validation", () => {
  const layer = analysisRoutes.stack.find(
    (entry) => entry.route && entry.route.path === "/" && entry.route.methods.post
  );

  assert.ok(layer, "POST / must exist on the analysis router");

  const handlers = layer.route.stack.map((entry) => entry.handle);

  const authenticateIndex = handlers.indexOf(authenticate);
  const guardIndex = handlers.indexOf(requireAuthenticatedIdentity);
  const limiterIndex = handlers.indexOf(analyzeLimiter);
  const validateIndex = handlers.indexOf(validateAnalyzeRequest);

  assert.ok(authenticateIndex >= 0, "authentication must be mounted");
  assert.ok(guardIndex >= 0, "the identity guard must be mounted");
  assert.ok(limiterIndex >= 0, "the analysis limiter must be mounted");
  assert.ok(validateIndex >= 0, "request validation must be mounted");

  assert.ok(
    authenticateIndex < guardIndex,
    "authentication must precede the identity guard"
  );
  assert.ok(
    guardIndex < limiterIndex,
    "the identity guard must precede the limiter so req.user is populated"
  );
  assert.ok(
    limiterIndex < validateIndex,
    "the limiter must precede validation so a blocked request does no work"
  );
});

test("the analysis limiter is a distinct instance from every other limiter", () => {
  assert.equal(typeof analyzeLimiter, "function");
  assert.equal(typeof analyzeLimiter.resetKey, "function");

  const otherLimiters = [
    require("../src/middleware/rateLimit.middleware").loginLimiter,
    require("../src/middleware/rateLimit.middleware").registerLimiter,
    require("../src/middleware/rateLimit.middleware").forgotPasswordLimiter,
    require("../src/middleware/rateLimit.middleware").resetPasswordLimiter,
    require("../src/middleware/rateLimit.middleware").credentialChangeLimiter,
    require("../src/middleware/rateLimit.middleware").logoutLimiter,
    require("../src/middleware/rateLimit.middleware").reviewerMessageLimiter,
    require("../src/middleware/rateLimit.middleware").studentMessageLimiter,
    require("../src/middleware/rateLimit.middleware").reportCreateLimiter
  ];

  for (const other of otherLimiters) {
    assert.notEqual(analyzeLimiter, other, "limiters must not share an instance");
  }
});

test("the analysis limiter is keyed on the authenticated user, not on the address", () => {
  assert.equal(authenticatedUserKey({ user: { userId: USER_A } }), `u:${USER_A}`);

  // The same identity reached from two different addresses and with a
  // forwarding header produces the same bucket, so neither the address nor a
  // header can move it.
  const forwarded = {
    user: { userId: USER_A },
    ip: "203.0.113.99",
    headers: {
      "x-forwarded-for": "203.0.113.99, 198.51.100.4",
      "cf-connecting-ip": "203.0.113.99"
    }
  };

  assert.equal(authenticatedUserKey(forwarded), `u:${USER_A}`);
});

test("GET /analyze is not limited, and only the write path is", () => {
  const getLayer = analysisRoutes.stack.find(
    (entry) => entry.route && entry.route.path === "/" && entry.route.methods.get
  );

  assert.ok(getLayer, "GET / must exist on the analysis router");

  const handlers = getLayer.route.stack.map((entry) => entry.handle);

  assert.equal(handlers.includes(analyzeLimiter), false);
  assert.ok(handlers.includes(authenticate), "reads stay authenticated");
});

// ---------------------------------------------------------------------------
// C-4: rate limiting behaviour
// ---------------------------------------------------------------------------

test("requests within the limit are accepted", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  for (let i = 0; i < 5; i++) {
    const { status } = await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));

    assert.equal(status, 201, `request ${i + 1} must be accepted`);
  }

  assert.equal(state.downstream, 5);
});

test("the request exceeding the limit is refused with a safe 429", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  for (let i = 0; i < ANALYZE_LIMIT; i++) {
    const { status } = await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));

    assert.equal(status, 201, `request ${i + 1} must be accepted`);
  }

  const blocked = await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));

  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, AUTHENTICATED_LIMIT_MESSAGE);
  assert.equal(
    state.downstream,
    ANALYZE_LIMIT,
    "a blocked request must not reach the terminal handler"
  );
});

test("a blocked request exposes no internal detail and no legacy rate headers", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const app = buildAnalyzeApp({ downstream: 0, lastUrl: null });

  for (let i = 0; i < ANALYZE_LIMIT; i++) {
    await serve(app, "/api/analyze", analyzeRequest(USER_A, "https://example.test/a"));
  }

  const response = await serve(
    app,
    "/api/analyze",
    analyzeRequest(USER_A, "https://example.test/a")
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("ratelimit-policy") !== null, true);
  assert.equal(response.headers.get("x-ratelimit-limit"), null);
  assert.equal(response.headers.get("x-ratelimit-remaining"), null);
  assert.equal(response.headers.get("x-ratelimit-reset"), null);
});

test("the limit is shared across different URLs from the same user", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  // Changing the submitted URL must not create a fresh budget. Each iteration
  // uses a distinct URL, so only the account-scoped key can be holding the
  // counter.
  for (let i = 0; i < ANALYZE_LIMIT; i++) {
    const { status } = await postAnalyze(
      app,
      analyzeRequest(USER_A, `https://example.test/path/${i}/${PADDING}`)
    );

    assert.equal(status, 201, `request ${i + 1} must be accepted`);
  }

  const blocked = await postAnalyze(
    app,
    analyzeRequest(USER_A, "https://example.test/a-completely-different-url")
  );

  assert.equal(blocked.status, 429, "a new URL must not reset the budget");
  assert.equal(state.downstream, ANALYZE_LIMIT);
});

test("the limit is not evaded by a forwarding header or a second tab", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  for (let i = 0; i < ANALYZE_LIMIT; i++) {
    await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));
  }

  // A different source address and a different forwarded client identity, as a
  // second browser tab or a different device on the same account would produce.
  const evaded = await postAnalyze(
    app,
    analyzeRequest(USER_A, "https://example.test/a", {
      "X-Forwarded-For": "203.0.113.99, 198.51.100.4, 192.0.2.5",
      "CF-Connecting-IP": "203.0.113.99",
      "CF-Ray": "230b030023ae2822-SJC"
    })
  );

  assert.equal(evaded.status, 429);
  assert.equal(state.downstream, ANALYZE_LIMIT);
});

test("two different users have independent budgets", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A, USER_B);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  for (let i = 0; i < ANALYZE_LIMIT; i++) {
    const { status } = await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));

    assert.equal(status, 201, `user A request ${i + 1} must be accepted`);
  }

  const blockedA = await postAnalyze(app, analyzeRequest(USER_A, "https://example.test/a"));
  assert.equal(blockedA.status, 429);

  // A different account must be entirely unaffected by the first one's usage.
  const firstForB = await postAnalyze(app, analyzeRequest(USER_B, "https://example.test/a"));
  assert.equal(firstForB.status, 201);

  for (let i = 0; i < ANALYZE_LIMIT - 1; i++) {
    const { status } = await postAnalyze(app, analyzeRequest(USER_B, "https://example.test/b"));

    assert.equal(status, 201, `user B request ${i + 2} must be accepted`);
  }

  const blockedB = await postAnalyze(app, analyzeRequest(USER_B, "https://example.test/b"));
  assert.equal(blockedB.status, 429);
  assert.equal(state.downstream, ANALYZE_LIMIT * 2);
});

test("an unauthenticated analysis request is refused before the limiter", async (t) => {
  stubActiveUsers(t);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const { status, body } = await postAnalyze(app, analyzeRequest(null, "https://example.test/a"));

  assert.equal(status, 401);
  assert.deepEqual(body, { success: false, error: "Authentication required" });
  assert.equal(state.downstream, 0);
});

test("an invalid token is refused and consumes no quota", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const { status } = await postAnalyze(
    app,
    analyzeRequest(USER_A, "https://example.test/a", { Authorization: "Bearer not-a-token" })
  );

  assert.equal(status, 403);
  assert.equal(state.downstream, 0);

  // The budget is untouched, so a full allowance is still available.
  const { status: next } = await postAnalyze(
    app,
    analyzeRequest(USER_A, "https://example.test/a")
  );

  assert.equal(next, 201);
});

// ---------------------------------------------------------------------------
// B-1: maximum URL length
// ---------------------------------------------------------------------------

test("the validator and the schema share one maximum", () => {
  assert.equal(MODEL_MAX_LENGTH, MAX_ANALYSIS_URL_LENGTH);
  assert.equal(typeof MAX_ANALYSIS_URL_LENGTH, "number");
  assert.ok(MAX_ANALYSIS_URL_LENGTH > 0);
});

test("a URL exactly at the boundary is accepted and passed through unmodified", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  assert.equal(AT_BOUNDARY.length, MAX_ANALYSIS_URL_LENGTH);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const { status } = await postAnalyze(app, analyzeRequest(USER_A, AT_BOUNDARY));

  assert.equal(status, 201, "a URL exactly at the maximum must be accepted");
  assert.equal(state.downstream, 1);
  assert.equal(
    state.lastUrl,
    AT_BOUNDARY,
    "the submitted URL must reach the terminal handler unchanged"
  );
});

test("a URL one character over the boundary is refused before persistence", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  assert.equal(OVER_BOUNDARY.length, MAX_ANALYSIS_URL_LENGTH + 1);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const { status, body } = await postAnalyze(app, analyzeRequest(USER_A, OVER_BOUNDARY));

  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.equal(
    body.error,
    `URL must be ${MAX_ANALYSIS_URL_LENGTH} characters or fewer`
  );
  assert.equal(
    state.downstream,
    0,
    "an oversized URL must be rejected before any persistence"
  );
});

test("an oversized URL is refused, never truncated", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const hugelyOversized = urlOfLength(MAX_ANALYSIS_URL_LENGTH * 8);

  const { status } = await postAnalyze(app, analyzeRequest(USER_A, hugelyOversized));

  assert.equal(status, 400);
  assert.equal(state.downstream, 0);
  assert.equal(state.lastUrl, null, "no truncated URL may reach the handler");
});

test("length is measured after trimming, so surrounding whitespace is not counted", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const padded = `   ${AT_BOUNDARY}   `;

  assert.ok(padded.length > MAX_ANALYSIS_URL_LENGTH);

  const { status } = await postAnalyze(app, analyzeRequest(USER_A, padded));

  assert.equal(status, 201);
  assert.equal(state.lastUrl, AT_BOUNDARY, "the trimmed URL is what is analysed");
});

test("the length check precedes parsing, so a huge malformed value is refused as too long", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const oversizedGarbage = `${"x".repeat(MAX_ANALYSIS_URL_LENGTH + 50)} not a url`;

  const { status, body } = await postAnalyze(app, analyzeRequest(USER_A, oversizedGarbage));

  assert.equal(status, 400);
  assert.match(body.error, /characters or fewer/);
  assert.equal(state.downstream, 0);
});

// ---------------------------------------------------------------------------
// Existing validation semantics are preserved
// ---------------------------------------------------------------------------

test("the existing analyze validation messages are unchanged", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const cases = [
    { label: "missing url", body: {}, status: 400, error: "URL is required" },
    { label: "non-string url", body: { url: 12345 }, status: 400, error: "URL must be a string" },
    { label: "empty url", body: { url: "   " }, status: 400, error: "URL cannot be empty" },
    { label: "malformed url", body: { url: "not a url" }, status: 400, error: "Invalid URL" },
    { label: "unsupported protocol", body: { url: "ftp://example.test/file" }, status: 400, error: "URL must use HTTP or HTTPS" },
    { label: "javascript protocol", body: { url: "javascript:alert(1)" }, status: 400, error: "URL must use HTTP or HTTPS" },
    { label: "file protocol", body: { url: "file:///etc/passwd" }, status: 400, error: "URL must use HTTP or HTTPS" }
  ];

  for (const testCase of cases) {
    const response = await serve(app, "/api/analyze", {
      path: "/api/analyze",
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFor(USER_A)}` },
      body: testCase.body
    });

    const payload = await response.json();

    assert.equal(response.status, testCase.status, `${testCase.label} status`);
    assert.deepEqual(payload, { success: false, error: testCase.error }, testCase.label);
  }

  assert.equal(state.downstream, 0, "no invalid request may reach persistence");
});

test("http and https remain the only accepted protocols", async (t) => {
  stubActiveUsers(t);
  await resetKeys(USER_A);

  const state = { downstream: 0, lastUrl: null };
  const app = buildAnalyzeApp(state);

  const { status } = await postAnalyze(app, analyzeRequest(USER_A, "http://example.test/page"));

  assert.equal(status, 201);
  assert.equal(state.lastUrl, "http://example.test/page");
});

// ---------------------------------------------------------------------------
// Schema boundary: the persistence layer refuses an oversized URL offline
// ---------------------------------------------------------------------------

test("the Analysis schema refuses an oversized URL at the persistence boundary", () => {
  const valid = new Analysis({
    user: new mongoose.Types.ObjectId(),
    url: AT_BOUNDARY,
    risk: "low",
    score: 0,
    indicators: []
  });

  assert.equal(valid.validateSync(), undefined, "a URL at the maximum must validate");

  const oversized = new Analysis({
    user: new mongoose.Types.ObjectId(),
    url: OVER_BOUNDARY,
    risk: "low",
    score: 0,
    indicators: []
  });

  const validationError = oversized.validateSync();

  assert.ok(validationError, "a URL over the maximum must not validate");
  assert.ok(
    Object.prototype.hasOwnProperty.call(validationError.errors, "url"),
    "the url path must be the failing path"
  );
});

test("the stored URL is never silently truncated by the schema", () => {
  const document = new Analysis({
    user: new mongoose.Types.ObjectId(),
    url: OVER_BOUNDARY,
    risk: "low",
    score: 0,
    indicators: []
  });

  assert.equal(
    document.url.length,
    OVER_BOUNDARY.length,
    "the schema must not shorten an oversized value to make it fit"
  );
});