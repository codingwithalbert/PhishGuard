const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const { ipKeyGenerator } = require("express-rate-limit");

const { createApp } = require("../src/app");
const {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter
} = require("../src/middleware/rateLimit.middleware");

// Proxy-trust regression suite for the three public authentication limiters.
//
// `createApp()` now sets `trust proxy` to exactly `1` (one trusted Render edge
// hop). With that setting Express derives `req.ip` from the RIGHTMOST
// X-Forwarded-For entry - the address the trusted hop observed - and ignores
// everything a client prepended to the left. These tests pin that behavior on
// the real production middleware stack:
//
//   * the trust setting is exactly 1 (never true, false, or a larger count);
//   * distinct edge-observed client IPs receive independent buckets;
//   * one edge-observed client IP shares a single bucket;
//   * attacker-prepended leftmost entries neither mint a fresh bucket to
//     bypass an exhausted limit nor drain someone else's bucket;
//   * the IPv6 /56 grouping of the default key generator is preserved;
//   * the 429 response contract and draft-8 headers are unchanged.
//
// Test topology: the local HTTP server is the "trusted hop" (socket
// 127.0.0.1) and the rightmost X-Forwarded-For value simulates the client IP
// that hop observed. Requests send empty bodies, which each route's
// validation rejects with a 400 ahead of every controller, so no MongoDB
// connection, bcrypt hash, user account, or external service is ever reached.
// The limiters count every attempt (skipFailedRequests is false), which is
// exactly what makes these 400-then-429 sequences a faithful probe of the
// production counters.

const IPV6_SUBNET = 56;

const LOGIN_LIMIT = 10;
const REGISTER_LIMIT = 20;
const FORGOT_LIMIT = 5;

const PUBLIC_AUTH_ENDPOINTS = [
  {
    path: "/api/auth/login",
    limiter: loginLimiter,
    limit: LOGIN_LIMIT,
    blockedMessage: "Too many login attempts. Please try again later."
  },
  {
    path: "/api/auth/register",
    limiter: registerLimiter,
    limit: REGISTER_LIMIT,
    blockedMessage:
      "Too many registration attempts. Please try again later."
  },
  {
    path: "/api/auth/forgot-password",
    limiter: forgotPasswordLimiter,
    limit: FORGOT_LIMIT,
    blockedMessage:
      "Too many password reset requests. Please try again later."
  }
];

// Simulated edge-observed client addresses (RFC 5737 / RFC 3849 documentation
// ranges; no packet ever leaves the loopback interface).
const CLIENT_A = "203.0.113.10";
const CLIENT_B = "203.0.113.20";
const PREPEND_1 = "198.51.100.77";
const PREPEND_2 = "192.0.2.55";

// IPv6 clients: A and A_PEER share a /56 subnet, B_OTHER does not.
const IPV6_A = "2001:db8:1:1::1";
const IPV6_A_PEER = "2001:db8:1:1::2";
const IPV6_B_OTHER = "2001:db8:1:100::1";

const SIMULATED_CLIENTS = [
  CLIENT_A,
  CLIENT_B,
  IPV6_A,
  IPV6_A_PEER,
  IPV6_B_OTHER
];

// Mirrors the default key generator of express-rate-limit 8.x so `resetKey`
// clears the exact bucket the middleware computes (IPv6 grouped by /56).
function keyFor(ip) {
  return ipKeyGenerator(ip, IPV6_SUBNET);
}

const serverApp = createApp();

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(serverApp);

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

test.beforeEach(async () => {
  // Every simulated client key is cleared on every limiter so no test inherits
  // state from another and the suite passes in any order.
  for (const ip of SIMULATED_CLIENTS) {
    const key = keyFor(ip);

    for (const endpoint of PUBLIC_AUTH_ENDPOINTS) {
      await endpoint.limiter.resetKey(key);
    }
  }
});

async function post(path, forwardedFor) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (forwardedFor !== undefined) {
    headers["X-Forwarded-For"] = forwardedFor;
  }

  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
}

function rateLimitRemaining(response) {
  const header = response.headers.get("ratelimit");

  assert.ok(header, "the draft-8 RateLimit header must be present");

  const match = /r=(\d+)/.exec(header);

  assert.ok(match, `malformed RateLimit header: ${header}`);

  return Number(match[1]);
}

function assertDraftEightHeaders(response) {
  assert.ok(response.headers.get("ratelimit"));
  assert.ok(response.headers.get("ratelimit-policy"));
  assert.equal(response.headers.get("x-ratelimit-limit"), null);
  assert.equal(response.headers.get("x-ratelimit-remaining"), null);
  assert.equal(response.headers.get("x-ratelimit-reset"), null);
}

async function assertPassedLimiter(response, expectedRemaining) {
  // Validation answers 400 ahead of every controller, so this status proves
  // the request was counted but not limited.
  assert.equal(response.status, 400);
  await response.json();
  assertDraftEightHeaders(response);

  if (expectedRemaining !== undefined) {
    assert.equal(rateLimitRemaining(response), expectedRemaining);
  }
}

async function assertLimited(response, endpoint) {
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    success: false,
    error: endpoint.blockedMessage
  });
  assertDraftEightHeaders(response);
  assert.ok(
    response.headers.get("retry-after"),
    "429 responses must carry Retry-After"
  );
}

// Sends `count` requests and returns the collected responses.
async function collect(path, forwardedFor, count) {
  const responses = [];

  for (let attempt = 0; attempt < count; attempt += 1) {
    responses.push(await post(path, forwardedFor));
  }

  return responses;
}

test("A. createApp() sets trust proxy to exactly 1", () => {
  const app = createApp();

  assert.equal(app.get("trust proxy"), 1);
  assert.notEqual(app.get("trust proxy"), true);
  assert.notEqual(app.get("trust proxy"), false);
});

for (const endpoint of PUBLIC_AUTH_ENDPOINTS) {
  test(`B. distinct edge-observed client IPs get independent ${endpoint.path} buckets`, async () => {
    // Exhaust client A's bucket entirely.
    const exhausted = await collect(
      endpoint.path,
      CLIENT_A,
      endpoint.limit + 1
    );

    for (const response of exhausted.slice(0, endpoint.limit)) {
      await assertPassedLimiter(response);
    }

    await assertLimited(exhausted[endpoint.limit], endpoint);

    // Client B must still hold a full, untouched quota.
    const clientB = await post(endpoint.path, CLIENT_B);

    await assertPassedLimiter(clientB, endpoint.limit - 1);
  });

  test(`C. one edge-observed client IP shares a single ${endpoint.path} bucket`, async () => {
    const statuses = [];
    const responses = await collect(endpoint.path, CLIENT_A, endpoint.limit + 1);

    for (let index = 0; index < responses.length; index += 1) {
      const response = responses[index];

      statuses.push(response.status);

      if (index < endpoint.limit) {
        // One shared counter decrements across every same-client request.
        await assertPassedLimiter(response, endpoint.limit - 1 - index);
      } else {
        await assertLimited(response, endpoint);
      }
    }

    assert.deepEqual(
      statuses,
      Array.from({ length: endpoint.limit }, () => 400).concat([429])
    );
  });

  test(`D. prepended X-Forwarded-For entries cannot bypass an exhausted ${endpoint.path} bucket`, async () => {
    const exhausted = await collect(
      endpoint.path,
      CLIENT_A,
      endpoint.limit + 1
    );

    await assertLimited(exhausted[endpoint.limit], endpoint);

    // Attacker-controlled leftmost entries - including an invalid value -
    // must not mint a fresh bucket: the rightmost entry still resolves to the
    // exhausted client A bucket.
    const spoofedHeaders = [
      `${PREPEND_1}, ${CLIENT_A}`,
      `${PREPEND_2}, ${PREPEND_1}, ${CLIENT_A}`,
      `garbage-not-an-ip, ${CLIENT_A}`
    ];

    for (const spoofedHeader of spoofedHeaders) {
      const response = await post(endpoint.path, spoofedHeader);

      await assertLimited(response, endpoint);
    }
  });

  test(`E. the bucket follows the rightmost entry on ${endpoint.path}; a leftmost victim name cannot drain its quota`, async () => {
    // Four requests naming CLIENT_A on the left but arriving for CLIENT_B
    // must all count against CLIENT_B only.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await post(endpoint.path, `${CLIENT_A}, ${CLIENT_B}`);

      await assertPassedLimiter(response, endpoint.limit - 1 - attempt);
    }

    // CLIENT_A's own bucket must be untouched: its first request still shows
    // a full quota, proving the leftmost CLIENT_A values were never counted.
    const clientA = await post(endpoint.path, CLIENT_A);

    await assertPassedLimiter(clientA, endpoint.limit - 1);
  });
}

test("G. IPv6 clients are bucketed per /56 subnet by the default key generator", async () => {
  // Exhaust IPv6 client A's login bucket.
  const exhausted = await collect(
    "/api/auth/login",
    IPV6_A,
    LOGIN_LIMIT + 1
  );

  for (const response of exhausted.slice(0, LOGIN_LIMIT)) {
    await assertPassedLimiter(response);
  }

  await assertLimited(exhausted[LOGIN_LIMIT], PUBLIC_AUTH_ENDPOINTS[0]);

  // A different address inside the same /56 shares the subnet bucket.
  const sameSubnet = await post("/api/auth/login", IPV6_A_PEER);

  await assertLimited(sameSubnet, PUBLIC_AUTH_ENDPOINTS[0]);

  // An attacker-prepended IPv4 value cannot move an IPv6 bucket either.
  const spoofed = await post("/api/auth/login", `${PREPEND_1}, ${IPV6_A_PEER}`);

  await assertLimited(spoofed, PUBLIC_AUTH_ENDPOINTS[0]);

  // An address in a different /56 holds an independent bucket.
  const otherSubnet = await post("/api/auth/login", IPV6_B_OTHER);

  await assertPassedLimiter(otherSubnet, LOGIN_LIMIT - 1);
});

test("no database connection is opened by any of these tests", () => {
  assert.equal(mongoose.connection.readyState, 0);
});
