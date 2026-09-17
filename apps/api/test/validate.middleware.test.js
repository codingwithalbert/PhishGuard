const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateAnalyzeRequest
} = require("../src/middleware/validate.middleware");

function runMiddleware(body) {
  const req = {
    body: body
  };

  let response;

  const res = {
    status(code) {
      return {
        json(data) {
          response = {
            status: code,
            data: data
          };
        }
      };
    }
  };

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  validateAnalyzeRequest(req, res, next);

  return {
    req,
    response,
    nextCalled
  };
}

test("rejects a missing URL", () => {
  const result = runMiddleware({});

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL is required");
});

test("rejects a non-string URL", () => {
  const result = runMiddleware({
    url: 12345
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL must be a string");
});

test("rejects an empty URL", () => {
  const result = runMiddleware({
    url: "   "
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL cannot be empty");
});

test("rejects an invalid URL", () => {
  const result = runMiddleware({
    url: "not-a-real-url"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "Invalid URL");
});

test("rejects unsupported URL protocols", () => {
  const result = runMiddleware({
    url: "ftp://example.com/file"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(
    result.response.data.error,
    "URL must use HTTP or HTTPS"
  );
});

test("accepts a valid HTTPS URL", () => {
  const result = runMiddleware({
    url: "  https://example.com/login  "
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, undefined);
  assert.equal(result.req.body.url, "https://example.com/login");
});