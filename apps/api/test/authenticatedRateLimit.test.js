const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");
const errorHandler = require("../src/middleware/error.middleware");
const { authenticate } = require("../src/middleware/auth.middleware");
const { authorizeRoles } = require("../src/middleware/role.middleware");
const {
  validateChangePasswordRequest
} = require("../src/middleware/account.validate.middleware");
const {
  validateReportId,
  validateReportMessage
} = require("../src/middleware/reporting.validate.middleware");
const {
  AUTHENTICATED_LIMIT_MESSAGE,
  authenticatedUserKey,
  credentialChangeLimiter,
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  requireAuthenticatedIdentity,
  reviewerMessageLimiter
} = require("../src/middleware/rateLimit.middleware");
const authRoutes = require("../src/routes/auth.routes");
const reportingRoutes = require("../src/routes/reporting.routes");

// Authenticated-user rate limiting for the two Phase 1 endpoints.
//
// The real `authenticate`, identity guard, limiters, and validators are used.
// Only the terminal boundary is replaced, so no bcrypt hashing and no
// transactional email ever runs: these tests measure the limiter, not the
// expensive work it protects.
//
// A router captures its controller by reference at require time, so replacing a
// controller method cannot intercept a mounted route. Behavioural coverage
// therefore mounts the identical real middleware chain with a stub terminal
// handler, while separate structural tests assert that the production routers
// mount exactly that chain in exactly that order.
//
// No MongoDB is used. Only the current-User lookup is faked, which is what makes
// `req.user.userId` available exactly as in production.

const testJwtSecret = crypto.randomBytes(32).toString("hex");
const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = testJwtSecret;

const AUTH_REQUIRED_BODY = {
  success: false,
  error: "Authentication required"
};

const CREDENTIAL_LIMIT = 5;
const REVIEWER_MESSAGE_LIMIT = 20;

const USER_A = new mongoose.Types.ObjectId().toString();
const USER_B = new mongoose.Types.ObjectId().toString();
const REVIEW_REPORT_ID = new mongoose.Types.ObjectId().toString();

const FORWARDING_HEADERS = {
  "X-Forwarded-For": "203.0.113.99, 198.51.100.4, 192.0.2.5",
  "CF-Connecting-IP": "203.0.113.99",
  "CF-Ray": "230b030023ae2822-SJC"
};

const CHANGE_PASSWORD_BODY = {
  currentPassword: "current-Password-1",
  newPassword: "new-Password-2"
};
const REVIEW_MESSAGE_BODY = { message: "Please verify this submission." };

test.after(() => {
  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

// Installs a single current-User stub. `roleForId` is read per request, so one
// mock can serve several identities within a single test without re-mocking.
function stubActiveUsers(t, roleForId = () => "user") {
  t.mock.method(User, "findOne", (filter) => {
    const id = filter?._id;
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(String(id)),
          role: roleForId(String(id)),
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
    ids.flatMap((id) => [
      credentialChangeLimiter.resetKey(`u:${id}`),
      reviewerMessageLimiter.resetKey(`u:${id}`)
    ])
  );
}

function tokenFor(userId) {
  return jwt.sign({ userId: String(userId), role: "user", tokenVersion: 0 }, testJwtSecret, {
    expiresIn: "1h"
  });
}

// Mirrors the production chain in auth.routes.js exactly.
function buildChangePasswordApp(state) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post(
    "/api/auth/change-password",
    authenticate,
    requireAuthenticatedIdentity,
    credentialChangeLimiter,
    validateChangePasswordRequest,
    (req, res) => {
      state.downstream += 1;
      return res.status(200).json({
        success: true,
        message: "Password changed successfully."
      });
    }
  );
  app.use(errorHandler);
  return app;
}

// Mirrors the production chain in reporting.routes.js exactly, including the
// router-wide authentication and the role gate ahead of the limiter.
function buildReviewMessageApp(state) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post(
    "/api/reports/review/:reportId/messages",
    authenticate,
    authorizeRoles("staff", "admin"),
    requireAuthenticatedIdentity,
    reviewerMessageLimiter,
    validateReportId,
    validateReportMessage,
    (req, res) => {
      state.downstream += 1;
      return res.status(201).json({ success: true, reportMessage: {} });
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

function changeRequest(userId, extraHeaders = {}) {
  return {
    path: "/api/auth/change-password",
    method: "POST",
    headers: {
      ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
      ...extraHeaders
    },
    body: CHANGE_PASSWORD_BODY
  };
}

function reviewRequest(userId, extraHeaders = {}) {
  return {
    path: `/api/reports/review/${REVIEW_REPORT_ID}/messages`,
    method: "POST",
    headers: {
      ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
      ...extraHeaders
    },
    body: REVIEW_MESSAGE_BODY
  };
}

function assertRateLimitHeaders(response) {
  assert.ok(response.headers.get("ratelimit"), "RateLimit header must be present");
  assert.ok(
    response.headers.get("ratelimit-policy"),
    "RateLimit-Policy must be present"
  );
  assert.equal(response.headers.get("x-ratelimit-limit"), null);
  assert.equal(response.headers.get("x-ratelimit-remaining"), null);
  assert.equal(response.headers.get("x-ratelimit-reset"), null);
}

// The limiter middleware returned by express-rate-limit is an anonymous
// function, so handlers are compared by reference rather than by name.
function findRouteLayer(router, path, method) {
  const layer = router.stack.find(
    (entry) => entry.route
      && entry.route.path === path
      && entry.route.methods[method]
  );

  assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);

  return layer;
}

// The role gate and the limiters are anonymous functions, so the role gate is
// located positionally using the named validators as anchors, and the limiters
// are located by reference.
function handlerIndexes(layer) {
  const handlers = layer.route.stack.map((entry) => entry.handle);
  const indexOfNamed = (name) =>
    handlers.findIndex((handler) => handler.name === name);

  return {
    guard: handlers.indexOf(requireAuthenticatedIdentity),
    credential: handlers.indexOf(credentialChangeLimiter),
    reviewer: handlers.indexOf(reviewerMessageLimiter),
    handlers,
    indexOfNamed
  };
}

// Reporting applies `authenticate` with `router.use`, so it lives on the router
// rather than in any individual route stack.
function routerHasAuthenticate(router) {
  return router.stack.some((layer) => !layer.route && layer.handle === authenticate);
}

test("the existing unauthenticated limiters are unchanged and distinct", () => {
  assert.equal(typeof loginLimiter, "function");
  assert.equal(typeof registerLimiter, "function");
  assert.equal(typeof forgotPasswordLimiter, "function");
  assert.equal(typeof credentialChangeLimiter, "function");
  assert.equal(typeof reviewerMessageLimiter, "function");

  for (const existing of [loginLimiter, registerLimiter, forgotPasswordLimiter]) {
    assert.notEqual(credentialChangeLimiter, existing);
    assert.notEqual(reviewerMessageLimiter, existing);
  }

  assert.notEqual(reviewerMessageLimiter, credentialChangeLimiter);
});

test("the limiter key is derived only from the server-authoritative user id", () => {
  // `keyGenerator` is not exposed on the middleware instance by
  // express-rate-limit, so the shared exported helper is asserted directly and
  // the applied key is verified behaviourally by the isolation and spoof tests.
  assert.equal(
    authenticatedUserKey({ user: { userId: USER_A } }),
    `u:${USER_A}`
  );
  assert.equal(
    authenticatedUserKey({ user: { userId: USER_B } }),
    `u:${USER_B}`
  );
  assert.notEqual(
    authenticatedUserKey({ user: { userId: USER_A } }),
    authenticatedUserKey({ user: { userId: USER_B } })
  );

  // The key reads only the server-authoritative identity, so an otherwise
  // valid request with no identity, and one carrying forwarding headers, both
  // produce the same key for the same user.
  const withHeaders = {
    user: { userId: USER_A },
    headers: FORWARDING_HEADERS,
    ip: "203.0.113.99"
  };

  assert.equal(authenticatedUserKey(withHeaders), `u:${USER_A}`);
});

test("the identity guard refuses a missing identity with the exact existing 401", () => {
  const makeResponse = () => ({
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  });

  for (const request of [{}, { user: {} }, { user: { role: "user" } }]) {
    const response = makeResponse();

    requireAuthenticatedIdentity(request, response, () =>
      assert.fail("must not continue without an identity")
    );

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, AUTH_REQUIRED_BODY);
  }
});

test("C. the password-change limiter allows five requests then blocks the sixth", async (t) => {
  await resetKeys(USER_A, USER_B);
  stubActiveUsers(t);
  const state = { downstream: 0 };
  const app = buildChangePasswordApp(state);

  for (let attempt = 1; attempt <= CREDENTIAL_LIMIT; attempt += 1) {
    const request = changeRequest(USER_A);
    const response = await serve(app, request.path, request);

    assert.equal(response.status, 200, `request ${attempt} must pass the limiter`);
    assertRateLimitHeaders(response);
    assert.deepEqual(await response.json(), {
      success: true,
      message: "Password changed successfully."
    });
  }

  // 11. Every below-limit request reached the downstream boundary.
  assert.equal(state.downstream, CREDENTIAL_LIMIT);

  // 10. The sixth request is limited.
  const blockedRequest = changeRequest(USER_A);
  const blocked = await serve(app, blockedRequest.path, blockedRequest);

  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), AUTHENTICATED_LIMIT_MESSAGE);
  assertRateLimitHeaders(blocked);
  assert.equal(state.downstream, CREDENTIAL_LIMIT, "blocked request must not reach the handler");

  // 12. A different user keeps an independent quota.
  const otherRequest = changeRequest(USER_B);
  const otherUser = await serve(app, otherRequest.path, otherRequest);

  assert.equal(otherUser.status, 200);
  await otherUser.json();
});

test("D. the reviewer-message limiter allows twenty requests then blocks the twenty-first", async (t) => {
  await resetKeys(USER_A, USER_B);
  stubActiveUsers(t, () => "staff");
  const state = { downstream: 0 };
  const app = buildReviewMessageApp(state);

  for (let attempt = 1; attempt <= REVIEWER_MESSAGE_LIMIT; attempt += 1) {
    const request = reviewRequest(USER_A);
    const response = await serve(app, request.path, request);

    assert.equal(response.status, 201, `request ${attempt} must pass the limiter`);
    assertRateLimitHeaders(response);
    await response.json();
  }

  assert.equal(state.downstream, REVIEWER_MESSAGE_LIMIT);

  const blockedRequest = reviewRequest(USER_A);
  const blocked = await serve(app, blockedRequest.path, blockedRequest);

  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), AUTHENTICATED_LIMIT_MESSAGE);
  assert.equal(state.downstream, REVIEWER_MESSAGE_LIMIT);

  // 16. A second reviewer has an independent quota.
  const otherRequest = reviewRequest(USER_B);
  const otherReviewer = await serve(app, otherRequest.path, otherRequest);

  assert.equal(otherReviewer.status, 201);
  await otherReviewer.json();
});

test("A. spoofed forwarding headers cannot create or move an authenticated bucket", async (t) => {
  await resetKeys(USER_A, USER_B);

  // A single stub serves both identities; the role is switched per identity so
  // the same test can exercise the student and reviewer chains.
  const roles = new Map([
    [USER_A, "user"],
    [USER_B, "staff"]
  ]);
  stubActiveUsers(t, (id) => roles.get(id) ?? "user");

  const state = { downstream: 0 };
  const app = buildChangePasswordApp(state);

  for (let attempt = 1; attempt <= CREDENTIAL_LIMIT; attempt += 1) {
    const request = changeRequest(USER_A);
    const response = await serve(app, request.path, request);

    assert.equal(response.status, 200);
    await response.json();
  }

  const plainRequest = changeRequest(USER_A);
  const plainBlocked = await serve(app, plainRequest.path, plainRequest);

  assert.equal(plainBlocked.status, 429);
  await plainBlocked.json();

  // 3, 4, 5. X-Forwarded-For, CF-Connecting-IP and CF-Ray must not produce a
  // fresh bucket, because none of them participates in the key.
  const spoofedRequest = changeRequest(USER_A, FORWARDING_HEADERS);
  const spoofed = await serve(app, spoofedRequest.path, spoofedRequest);

  assert.equal(spoofed.status, 429, "forwarding headers must not bypass the limit");
  assert.deepEqual(await spoofed.json(), AUTHENTICATED_LIMIT_MESSAGE);

  // 2. Spoofed headers must not let another user borrow or drain a quota.
  const otherSpoofedRequest = changeRequest(USER_B, FORWARDING_HEADERS);
  const otherUser = await serve(app, otherSpoofedRequest.path, otherSpoofedRequest);

  assert.equal(otherUser.status, 200);
  await otherUser.json();

  // The same applies to the reviewer limiter, using an identity that resolves
  // to a reviewer role.
  await resetKeys(USER_B, USER_B);
  const reviewerState = { downstream: 0 };
  const reviewerApp = buildReviewMessageApp(reviewerState);

  for (let attempt = 1; attempt <= REVIEWER_MESSAGE_LIMIT; attempt += 1) {
    const request = reviewRequest(USER_B);
    const response = await serve(reviewerApp, request.path, request);

    assert.equal(response.status, 201);
    await response.json();
  }

  const spoofedReviewRequest = reviewRequest(USER_B, FORWARDING_HEADERS);
  const spoofedReview = await serve(
    reviewerApp,
    spoofedReviewRequest.path,
    spoofedReviewRequest
  );

  assert.equal(spoofedReview.status, 429);
  await spoofedReview.json();
});

test("B. unauthenticated requests keep existing behavior and consume no quota", async (t) => {
  await resetKeys(USER_A, USER_B);
  stubActiveUsers(t);

  const changeState = { downstream: 0 };
  const changeApp = buildChangePasswordApp(changeState);
  const reviewState = { downstream: 0 };
  const reviewApp = buildReviewMessageApp(reviewState);

  // 6. Unauthenticated password change.
  const unauthenticatedChange = await serve(
    changeApp,
    "/api/auth/change-password",
    { method: "POST", body: CHANGE_PASSWORD_BODY }
  );

  assert.equal(unauthenticatedChange.status, 401);
  assert.deepEqual(await unauthenticatedChange.json(), AUTH_REQUIRED_BODY);

  // 7. Unauthenticated reviewer message.
  const unauthenticatedReview = await serve(
    reviewApp,
    `/api/reports/review/${REVIEW_REPORT_ID}/messages`,
    { method: "POST", body: REVIEW_MESSAGE_BODY }
  );

  assert.equal(unauthenticatedReview.status, 401);
  assert.deepEqual(await unauthenticatedReview.json(), AUTH_REQUIRED_BODY);

  // Authentication runs before the limiter, so neither request reached it.
  // No standard rate-limit headers are emitted and neither quota was spent.
  assert.equal(unauthenticatedChange.headers.get("ratelimit"), null);
  assert.equal(unauthenticatedReview.headers.get("ratelimit"), null);
  assert.equal(changeState.downstream, 0);
  assert.equal(reviewState.downstream, 0);

  // The full authenticated budget is still available afterwards.
  for (let attempt = 1; attempt <= CREDENTIAL_LIMIT; attempt += 1) {
    const request = changeRequest(USER_A);
    const response = await serve(changeApp, request.path, request);

    assert.equal(response.status, 200, `request ${attempt} must still be allowed`);
    await response.json();
  }

  const nowBlockedRequest = changeRequest(USER_A);
  const nowBlocked = await serve(changeApp, nowBlockedRequest.path, nowBlockedRequest);

  assert.equal(nowBlocked.status, 429);
  await nowBlocked.json();
});

test("role authorization is still enforced ahead of the reviewer limiter", async (t) => {
  await resetKeys(USER_A, USER_B);
  stubActiveUsers(t, () => "user");
  const state = { downstream: 0 };
  const app = buildReviewMessageApp(state);

  // An ordinary user is denied by role authorization. The request never
  // reaches the identity guard or the limiter, so no quota is consumed.
  const deniedRequest = reviewRequest(USER_A);
  const denied = await serve(app, deniedRequest.path, deniedRequest);

  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    success: false,
    error: "You do not have permission to access this resource"
  });
  assert.equal(denied.headers.get("ratelimit"), null);
  assert.equal(state.downstream, 0);

  // The reviewer budget is untouched by the denied attempt.
  await resetKeys(USER_A, USER_B);
  stubActiveUsers(t, () => "staff");
  const staffState = { downstream: 0 };
  const staffApp = buildReviewMessageApp(staffState);

  for (let attempt = 1; attempt <= REVIEWER_MESSAGE_LIMIT; attempt += 1) {
    const request = reviewRequest(USER_A);
    const response = await serve(staffApp, request.path, request);

    assert.equal(response.status, 201);
    await response.json();
  }
});

test("production routes mount authentication, authorization, guard, then limiter", () => {
  const changeLayer = findRouteLayer(authRoutes, "/change-password", "post");
  const changeHandlers = changeLayer.route.stack.map((entry) => entry.handle);
  const change = handlerIndexes(changeLayer);

  // Auth is a route-level middleware on the auth router.
  assert.ok(
    changeHandlers.includes(authenticate),
    "authenticate must be present on the change-password route"
  );
  assert.ok(change.guard >= 0, "the identity guard must be present");
  assert.ok(
    changeHandlers.indexOf(authenticate) < change.guard,
    "the guard must follow authenticate"
  );
  assert.ok(change.credential > change.guard, "the limiter must follow the guard");
  assert.ok(
    change.credential < change.handlers.length - 2,
    "the limiter must precede validation and the controller"
  );

  // The reviewer path is shared with a GET handler, so POST is selected
  // explicitly. Authentication is applied router-wide with `router.use`.
  assert.ok(
    routerHasAuthenticate(reportingRoutes),
    "the reporting router must still apply authenticate router-wide"
  );

  const review = handlerIndexes(
    findRouteLayer(reportingRoutes, "/review/:reportId/messages", "post")
  );
  const reviewReportIdIndex = review.indexOfNamed("validateReportId");
  const reviewControllerIndex = review.indexOfNamed("createReviewReportMessage");

  assert.ok(reviewReportIdIndex >= 0, "route validation must remain present");
  assert.ok(reviewControllerIndex >= 0, "the controller must remain present");

  // The role gate is the first handler, ahead of the identity guard.
  assert.equal(review.handlers[0].name, "", "a role gate must precede the guard");
  assert.ok(
    review.guard > 0,
    "the identity guard must follow the role gate"
  );
  assert.ok(review.reviewer > review.guard, "the limiter must follow the guard");
  assert.ok(
    review.reviewer < reviewReportIdIndex,
    "the limiter must precede route validation"
  );
  assert.ok(
    review.reviewer < reviewControllerIndex,
    "the limiter must precede the controller"
  );
});

test("the new limiters mount only on the two intended endpoints", () => {
  const mounted = [];

  for (const [routerName, router] of [
    ["auth", authRoutes],
    ["reports", reportingRoutes]
  ]) {
    for (const layer of router.stack) {
      if (!layer.route) {
        continue;
      }

      const handlers = layer.route.stack.map((entry) => entry.handle);
      const methods = Object.keys(layer.route.methods)
        .map((method) => method.toUpperCase())
        .join(",");

      if (handlers.includes(credentialChangeLimiter)) {
        mounted.push(`${routerName}${layer.route.path}[${methods}]`);
      }

      if (handlers.includes(reviewerMessageLimiter)) {
        mounted.push(`${routerName}${layer.route.path}[${methods}]`);
      }
    }
  }

  assert.deepEqual(mounted.sort(), [
    "auth/change-password[POST]",
    "reports/review/:reportId/messages[POST]"
  ]);

  // Report completion must not be limited in this phase.
  const completion = handlerIndexes(
    findRouteLayer(reportingRoutes, "/review/:reportId/complete", "patch")
  );

  assert.equal(completion.reviewer, -1);
  assert.equal(completion.credential, -1);

  const completionLayer = findRouteLayer(
    reportingRoutes,
    "/review/:reportId/complete",
    "patch"
  );

  assert.equal(
    completionLayer.route.stack[0].handle.name,
    "",
    "completion must keep its role gate"
  );
  assert.ok(
    completionLayer.route.stack.map((entry) => entry.handle).includes(authenticate) === false,
    "completion relies on the router-wide authenticate"
  );
  assert.ok(routerHasAuthenticate(reportingRoutes));

  // Student report messages must not inherit the reviewer limiter.
  const studentMessage = handlerIndexes(
    findRouteLayer(reportingRoutes, "/:reportId/messages", "post")
  );

  assert.equal(studentMessage.reviewer, -1);
  assert.equal(studentMessage.credential, -1);

  // The existing public limiters all remain mounted.
  assert.ok(
    findRouteLayer(authRoutes, "/register", "post")
      .route.stack.map((entry) => entry.handle)
      .includes(registerLimiter),
    "the registration limiter must remain mounted"
  );
  assert.ok(
    findRouteLayer(authRoutes, "/login", "post")
      .route.stack.map((entry) => entry.handle)
      .includes(loginLimiter),
    "the login limiter must remain mounted"
  );
});

test("no database connection is opened by any of these tests", () => {
  assert.equal(mongoose.connection.readyState, 0);
});
