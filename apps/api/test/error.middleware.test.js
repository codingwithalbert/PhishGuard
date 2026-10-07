const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { format } = require("node:util");
const express = require("express");
const errorHandler = require("../src/middleware/error.middleware");
const {
  INTERNAL_ERROR_MESSAGE,
  INVALID_JSON_MESSAGE,
  PAYLOAD_TOO_LARGE_MESSAGE
} = require("../src/middleware/error.middleware");

// The exact properties the JSON body parser sets when a request body exceeds
// the configured limit. Reproduced from a real oversized request so the unit
// coverage mirrors the parser contract rather than a guess.
function createEntityTooLargeError(overrides = {}) {
  const error = new Error("request entity too large");
  error.name = "PayloadTooLargeError";
  error.status = 413;
  error.statusCode = 413;
  error.type = "entity.too.large";
  error.expose = true;
  error.expected = 1200012;
  error.length = 1200012;
  error.limit = 1048576;
  return Object.assign(error, overrides);
}

function captureErrors(t) {
  const calls = [];
  t.mock.method(console, "error", (...args) => calls.push(args));
  return calls;
}

function handle(error, req = {}) {
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  errorHandler(error, req, response, () => assert.fail("must not call next"));
  return response;
}

function assertDiagnostic(calls, { category, errorType, status }) {
  assert.equal(calls.length, 1);
  const output = format(...calls[0]);
  assert.equal(output.startsWith("[ERROR] "), true);
  const diagnostic = JSON.parse(output.slice("[ERROR] ".length));
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "category", "errorType", "event", "status", "timestamp"
  ]);
  assert.equal(diagnostic.event, "GLOBAL_ERROR");
  assert.equal(diagnostic.category, category);
  assert.equal(diagnostic.errorType, errorType);
  assert.equal(diagnostic.status, status);
  assert.equal(Number.isNaN(Date.parse(diagnostic.timestamp)), false);
}

test("raw error objects and attached sensitive data never reach console.error", (t) => {
  const calls = captureErrors(t);
  const marker = "synthetic-sensitive-payload";
  const error = new Error(marker);
  error.name = marker;
  error.stack = marker;
  error.code = marker;
  error.body = marker;
  error.cause = new Error(marker);
  error.credentials = { password: marker, token: marker };
  const response = handle(error, {
    body: { password: marker },
    headers: { authorization: marker },
    originalUrl: `/reset-password/${marker}?token=${marker}`,
    method: marker
  });

  assert.equal(calls.flat().includes(error), false);
  assert.equal(format(...calls[0]).includes(marker), false);
  assertDiagnostic(calls, {
    category: "unexpected_error", errorType: "Error", status: 500
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { success: false, error: "Internal server error" });
});

test("malformed JSON parser errors retain the safe 400 without logging submitted content", async (t) => {
  const calls = captureErrors(t);
  const marker = "synthetic-submitted-body";
  const body = `{"password":"${marker}","token":"${marker}",`;
  let parserError;
  const app = express();
  app.use(express.json());
  app.post("/test", () => assert.fail("invalid JSON must not reach the route"));
  app.use((err, req, res, next) => {
    parserError = err;
    next(err);
  });
  app.use(errorHandler);
  const server = http.createServer(app);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: marker },
    body
  });

  assert.equal(parserError instanceof SyntaxError, true);
  assert.equal(parserError.body === body, true);
  assert.equal(calls.flat().includes(parserError), false);
  assert.equal(format(...calls[0]).includes(marker), false);
  assertDiagnostic(calls, {
    category: "invalid_json", errorType: "SyntaxError", status: 400
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: "Invalid JSON payload" });
});

test("unexpected errors retain useful sanitized type diagnostics without messages or stacks", (t) => {
  const calls = captureErrors(t);
  const error = new TypeError("synthetic-internal-connection-detail");
  error.name = "synthetic-forged-error-name";
  handle(error);

  assert.equal(format(...calls[0]).includes(error.message), false);
  assert.equal(format(...calls[0]).includes(error.name), false);
  assertDiagnostic(calls, {
    category: "unexpected_error", errorType: "TypeError", status: 500
  });
});

test("non-Error payloads get an unknown diagnostic without serializing the payload", (t) => {
  const calls = captureErrors(t);
  const marker = "synthetic-arbitrary-error-payload";
  handle({ name: marker, message: marker, body: marker, status: 401 });

  assert.equal(format(...calls[0]).includes(marker), false);
  assertDiagnostic(calls, {
    category: "unexpected_error", errorType: "Unknown", status: 500
  });
});

test("an entity-too-large error maps to a safe 413 without leaking parser details", (t) => {
  const calls = captureErrors(t);
  const error = createEntityTooLargeError();
  const response = handle(error);

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, {
    success: false,
    error: PAYLOAD_TOO_LARGE_MESSAGE
  });

  // No parser internals, no received length, and no configured limit may be
  // published or logged.
  const published = JSON.stringify(response.body);

  for (const forbidden of [
    "entity.too.large",
    "PayloadTooLargeError",
    "request entity too large",
    "1048576",
    "1200012"
  ]) {
    assert.equal(published.includes(forbidden), false, forbidden);
    assert.equal(format(...calls[0]).includes(forbidden), false, forbidden);
  }

  assert.equal(calls.flat().includes(error), false);
  assertDiagnostic(calls, {
    category: "payload_too_large",
    errorType: "Error",
    status: 413
  });
});

test("a 413 without the parser type is still mapped to 413", (t) => {
  const calls = captureErrors(t);
  const error = Object.assign(new Error("synthetic-413"), { status: 413 });
  const response = handle(error);

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, {
    success: false,
    error: PAYLOAD_TOO_LARGE_MESSAGE
  });
  assertDiagnostic(calls, {
    category: "payload_too_large",
    errorType: "Error",
    status: 413
  });
});

test("malformed JSON still maps to 400 and is not treated as an oversized body", (t) => {
  const calls = captureErrors(t);
  const malformed = Object.assign(new SyntaxError("synthetic"), {
    status: 400,
    body: "synthetic-submitted-body",
    type: "entity.parse.failed"
  });
  const response = handle(malformed);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    success: false,
    error: INVALID_JSON_MESSAGE
  });
  assertDiagnostic(calls, {
    category: "invalid_json",
    errorType: "SyntaxError",
    status: 400
  });
});

test("an unrelated error still maps to the generic safe 500", (t) => {
  const calls = captureErrors(t);
  const error = new Error("synthetic-unrelated-detail");
  error.body = "synthetic-body-marker";
  error.type = "entity.parse.failed";
  const response = handle(error);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: INTERNAL_ERROR_MESSAGE
  });
  assertDiagnostic(calls, {
    category: "unexpected_error",
    errorType: "Error",
    status: 500
  });
});

test("the published messages are stable and distinct", () => {
  assert.equal(INVALID_JSON_MESSAGE, "Invalid JSON payload");
  assert.equal(PAYLOAD_TOO_LARGE_MESSAGE, "Request body too large");
  assert.equal(INTERNAL_ERROR_MESSAGE, "Internal server error");
});

for (const [label, error, status, message] of [
  ["parser-shaped SyntaxError", Object.assign(new SyntaxError("synthetic"), { status: 400, body: "synthetic" }), 400, "Invalid JSON payload"],
  ["SyntaxError without body", Object.assign(new SyntaxError("synthetic"), { status: 400 }), 500, "Internal server error"],
  ["SyntaxError with other status", Object.assign(new SyntaxError("synthetic"), { status: 413, body: "synthetic" }), 500, "Internal server error"],
  ["non-SyntaxError with body and status 400", Object.assign(new Error("synthetic"), { status: 400, body: "synthetic" }), 500, "Internal server error"],
  ["ordinary unexpected error", new Error("synthetic"), 500, "Internal server error"]
]) {
  test(`client response remains unchanged for ${label}`, (t) => {
    captureErrors(t);
    const response = handle(error);
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.body, { success: false, error: message });
  });
}
