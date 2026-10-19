const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const authRoutes = require("../src/routes/auth.routes");
const { createAuthRouter } = authRoutes;
const errorHandler = require("../src/middleware/error.middleware");

// Offline server-side RBAC coverage (Phase 0 security hardening).
//
// Phase 0 removed the `/staff-test` and `/admin-test` demonstration routes
// from the PRODUCTION router. The authorization allow/deny matrix they
// previously exercised live still must be covered, so this suite mounts the
// identical router factory with `includeDemoRoutes: true` on an ephemeral
// loopback server and drives the real `authenticate` + `authorizeRoles`
// chain. Only the current-User lookup is mocked (the same technique used by
// passwordReset.stage3.test.js), so no MongoDB and no live API are involved.
//
// This suite additionally asserts that the production router, as mounted by
// `app.js`, no longer registers the demonstration routes.

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const STAFF_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();

const demoRouter = createAuthRouter({ includeDemoRoutes: true });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", demoRouter);
app.use(errorHandler);

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
});

function authUser(id, role) {
  return {
    _id: id,
    role,
    isActive: true,
    tokenVersion: 0
  };
}

// Doubly-thenable Mongoose-style query mock, matching the established
// passwordReset.stage3.test.js pattern for the real `authenticate` chain:
// `authenticate` awaits `findOne(...).select(PROJECTION)`, so the mock must
// support `select()` returning a thenable that resolves to the user record.
function mockUserLookup(t, id, role) {
  return t.mock.method(User, "findOne", () => {
    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(authUser(id, role)).then(
          onFulfilled,
          onRejected
        );
      }
    };

    return query;
  });
}

function makeToken(userId, role) {
  return jwt.sign(
    {
      userId: userId.toString(),
      role,
      tokenVersion: 0
    },
    testJwtSecret,
    {
      expiresIn: "1h"
    }
  );
}

async function get(path, token) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers
  });
}

test("the production router no longer registers the demonstration RBAC routes", () => {
  const registered = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);

  assert.equal(registered.includes("/staff-test"), false);
  assert.equal(registered.includes("/admin-test"), false);

  // The authenticated surface itself is unchanged by the hardening.
  for (const required of [
    "/register",
    "/login",
    "/me",
    "/profile",
    "/change-password",
    "/logout"
  ]) {
    assert.ok(
      registered.includes(required),
      `${required} must remain registered`
    );
  }
});

test("a request without a JWT is rejected as unauthenticated", async () => {
  const staffRoute = await get("/api/auth/staff-test");
  const adminRoute = await get("/api/auth/admin-test");

  for (const response of [staffRoute, adminRoute]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Authentication required"
    });
  }
});

test("a token signed by another secret is rejected as invalid", async () => {
  const forgedToken = jwt.sign(
    {
      userId: STAFF_ID.toString(),
      role: "staff",
      tokenVersion: 0
    },
    "not-the-server-secret",
    {
      expiresIn: "1h"
    }
  );

  const staffRoute = await get("/api/auth/staff-test", forgedToken);

  assert.equal(staffRoute.status, 403);
  assert.deepEqual(await staffRoute.json(), {
    success: false,
    error: "Invalid or expired token"
  });
});

test("a user-role token is denied both demonstration routes from server state", async (t) => {
  for (const route of ["/api/auth/staff-test", "/api/auth/admin-test"]) {
    const lookup = mockUserLookup(t, USER_ID, "user");
    const response = await get(route, makeToken(USER_ID, "user"));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "You do not have permission to access this resource"
    });
    assert.equal(lookup.mock.callCount(), 1);
  }
});

test("a staff-role token is allowed the staff route and denied the admin route", async (t) => {
  const allowedLookup = mockUserLookup(t, STAFF_ID, "staff");
  const allowed = await get(
    "/api/auth/staff-test",
    makeToken(STAFF_ID, "staff")
  );

  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {
    success: true,
    message: "Staff access granted"
  });
  assert.equal(allowedLookup.mock.callCount(), 1);

  const deniedLookup = mockUserLookup(t, STAFF_ID, "staff");
  const denied = await get(
    "/api/auth/admin-test",
    makeToken(STAFF_ID, "staff")
  );

  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    success: false,
    error: "You do not have permission to access this resource"
  });
  assert.equal(deniedLookup.mock.callCount(), 1);
});

test("an admin-role token is allowed both demonstration routes", async (t) => {
  const staffRouteLookup = mockUserLookup(t, ADMIN_ID, "admin");
  const staffRoute = await get(
    "/api/auth/staff-test",
    makeToken(ADMIN_ID, "admin")
  );

  assert.equal(staffRoute.status, 200);
  assert.deepEqual(await staffRoute.json(), {
    success: true,
    message: "Staff access granted"
  });
  assert.equal(staffRouteLookup.mock.callCount(), 1);

  const adminRouteLookup = mockUserLookup(t, ADMIN_ID, "admin");
  const adminRoute = await get(
    "/api/auth/admin-test",
    makeToken(ADMIN_ID, "admin")
  );

  assert.equal(adminRoute.status, 200);
  assert.deepEqual(await adminRoute.json(), {
    success: true,
    message: "Admin access granted"
  });
  assert.equal(adminRouteLookup.mock.callCount(), 1);
});

test("authorization resolves from the database role, not the token claim", async (t) => {
  // A forged `role: "admin"` claim is worthless: authenticate authorizes from
  // the re-read User record, so a staff record with a lying token is still a
  // staff decision.
  const lookup = mockUserLookup(t, STAFF_ID, "staff");
  const lyingToken = makeToken(STAFF_ID, "admin");
  const response = await get("/api/auth/admin-test", lyingToken);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "You do not have permission to access this resource"
  });
  assert.equal(lookup.mock.callCount(), 1);
});
