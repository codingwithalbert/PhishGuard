require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:5000";

function makeToken(role) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      userId: `test-${role}-id`,
      role
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h"
    }
  );
}

function makeInvalidToken() {
  return jwt.sign(
    {
      userId: "test-user-id",
      role: "admin"
    },
    "not-the-server-secret",
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

  return fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers
  });
}

test("staff-test rejects a request without a JWT", async () => {
  const response = await get("/api/auth/staff-test");

  assert.equal(response.status, 401);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "Authentication required");
});

test("admin-test rejects an invalid JWT", async () => {
  const response = await get(
    "/api/auth/admin-test",
    makeInvalidToken()
  );

  assert.equal(response.status, 403);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "Invalid or expired token");
});

test("admin-test denies a valid User JWT", async () => {
  const response = await get(
    "/api/auth/admin-test",
    makeToken("user")
  );

  assert.equal(response.status, 403);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(
    data.error,
    "You do not have permission to access this resource"
  );
});

test("staff-test allows a valid Staff JWT", async () => {
  const response = await get(
    "/api/auth/staff-test",
    makeToken("staff")
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.message, "Staff access granted");
});

test("admin-test denies a valid Staff JWT", async () => {
  const response = await get(
    "/api/auth/admin-test",
    makeToken("staff")
  );

  assert.equal(response.status, 403);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(
    data.error,
    "You do not have permission to access this resource"
  );
});

test("staff-test allows a valid Admin JWT", async () => {
  const response = await get(
    "/api/auth/staff-test",
    makeToken("admin")
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.message, "Staff access granted");
});

test("admin-test allows a valid Admin JWT", async () => {
  const response = await get(
    "/api/auth/admin-test",
    makeToken("admin")
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.message, "Admin access granted");
});
