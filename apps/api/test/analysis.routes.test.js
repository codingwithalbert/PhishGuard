const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = "http://localhost:5000";

async function analyze(body) {
  return fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("POST /api/analyze returns low risk for a normal HTTPS URL", async () => {
  const response = await analyze({
    url: "https://example.com",
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.url, "https://example.com");
  assert.equal(data.risk, "low");
  assert.equal(data.score, 0);
  assert.deepEqual(data.indicators, []);
});

test("POST /api/analyze returns high risk for a suspicious URL", async () => {
  const response = await analyze({
    url: "http://192.168.1.1/login",
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.risk, "high");
  assert.equal(data.score, 50);
  assert.equal(data.indicators.length, 3);
});

test("POST /api/analyze rejects a missing URL", async () => {
  const response = await analyze({});

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
});

test("POST /api/analyze rejects a non-string URL", async () => {
  const response = await analyze({
    url: 12345,
  });

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
});

test("POST /api/analyze rejects an invalid URL", async () => {
  const response = await analyze({
    url: "not-a-valid-url",
  });

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
});

test("POST /api/analyze rejects unsupported protocols", async () => {
  const response = await analyze({
    url: "ftp://example.com",
  });

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
});