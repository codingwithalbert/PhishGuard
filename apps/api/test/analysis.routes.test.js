const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = "http://localhost:5000";

let authToken;

async function login() {
  if (authToken) {
    return authToken;
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "user@test.com",
      password: "TestPassword123!"
    })
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(data.token);

  authToken = data.token;

  return authToken;
}

async function analyze(body, token) {
  return fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

test("POST /api/analyze rejects a request without authentication", async () => {
  const response = await fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: "https://example.com"
    })
  });

  assert.equal(response.status, 401);

  const data = await response.json();

  assert.equal(data.success, false);
});

test("POST /api/analyze returns low risk for a normal HTTPS URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "https://example.com"
    },
    token
  );

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.analysis.url, "https://example.com");
  assert.equal(data.analysis.risk, "low");
  assert.equal(data.analysis.score, 0);
  assert.deepEqual(data.analysis.indicators, []);
  assert.equal(data.analysis.status, "active");
  assert.ok(data.analysis.id);
});

test("POST /api/analyze returns high risk for a suspicious URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "http://192.168.1.1/login"
    },
    token
  );

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.analysis.risk, "high");
  assert.equal(data.analysis.score, 50);
  assert.equal(data.analysis.indicators.length, 3);
});

test("POST /api/analyze rejects a missing URL", async () => {
  const token = await login();

  const response = await analyze({}, token);

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL is required");
});

test("POST /api/analyze rejects a non-string URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: 12345
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL must be a string");
});

test("POST /api/analyze rejects an invalid URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "not-a-valid-url"
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "Invalid URL");
});

test("POST /api/analyze rejects unsupported protocols", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "ftp://example.com"
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL must use HTTP or HTTPS");
});