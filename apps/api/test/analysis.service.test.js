const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeUrl } = require("../src/services/analysis.service");

test("analyzes a normal HTTPS URL as low risk", () => {
  const result = analyzeUrl("https://example.com");

  assert.equal(result.success, true);
  assert.equal(result.risk, "low");
  assert.equal(result.score, 0);
  assert.deepEqual(result.indicators, []);
});

test("detects suspicious keywords", () => {
  const result = analyzeUrl("https://example.com/login/verify");

  assert.equal(result.success, true);
  assert.equal(result.score, 10);
  assert.equal(result.risk, "low");
  assert.equal(result.indicators.length, 1);
});

test("detects an IP address", () => {
  const result = analyzeUrl("https://192.168.1.10/login");

  assert.equal(result.success, true);
  assert.equal(result.score, 30);
  assert.equal(result.risk, "medium");
});

test("detects a non-standard port", () => {
  const result = analyzeUrl("https://example.com:8080/login");

  assert.equal(result.success, true);
  assert.equal(result.score, 20);
  assert.equal(result.risk, "low");
});

test("detects punycode", () => {
  const result = analyzeUrl("https://xn--example-9za.com/login");

  assert.equal(result.success, true);
  assert.equal(result.score, 20);
  assert.equal(result.risk, "low");
});

test("combines multiple suspicious indicators", () => {
  const result = analyzeUrl(
    "http://login.verify.account.security.example.com:8080/login%2Fverify"
  );

  assert.equal(result.success, true);
  assert.equal(result.score, 75);
  assert.equal(result.risk, "high");
});

test("detects an @ character in the URL", () => {
  const result = analyzeUrl("https://example.com@evil.example/login");

  assert.equal(result.success, true);
  assert.equal(result.score, 25);
  assert.equal(result.risk, "medium");
  assert.ok(
    result.indicators.includes("URL contains an @ character")
  );
});

test("detects an unusually long URL", () => {
  const longPath = "a".repeat(101);
  const result = analyzeUrl(`https://example.com/${longPath}`);

  assert.equal(result.success, true);
  assert.equal(result.score, 10);
  assert.equal(result.risk, "low");
  assert.ok(
    result.indicators.includes("URL is unusually long")
  );
});