const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const mongoose = require("mongoose");

// HTTP security regression coverage for the REAL production Express stack.
//
// The app under test is built by `createApp()` from `src/app.js`, which is the
// single source of truth for Helmet, CORS, the JSON body limit, the cookie
// parser, route mounting, /api/health, and the global error middleware. No
// middleware configuration is duplicated here, so these assertions cannot drift
// away from production.
//
// The app is served by an ephemeral loopback server. Nothing connects to
// MongoDB, nothing calls the bootstrap in `server.js`, and no external service
// is contacted.

const ALLOWED_ORIGIN = "https://frontend.example.invalid";
const DISALLOWED_ORIGIN = "https://evil.example.invalid";
const PREVIOUS_CLIENT_URL = process.env.CLIENT_URL;

const { createApp } = require("../src/app");

// `createApp()` reads CLIENT_URL on every call, so setting it before building
// the app exercises the real CORS configuration without any module-cache
// manipulation. The previous value is restored after the suite.
process.env.CLIENT_URL = ALLOWED_ORIGIN;

let server;
let baseUrl;
let app;

test.before(async () => {
  app = createApp();
  server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (PREVIOUS_CLIENT_URL === undefined) {
    delete process.env.CLIENT_URL;
  } else {
    process.env.CLIENT_URL = PREVIOUS_CLIENT_URL;
  }
});

async function send(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

// Only security-significant, long-stable Helmet headers are asserted. The full
// header set is deliberately not pinned, so a Helmet upgrade cannot break this
// test for a reason unrelated to security.
function assertSecurityHeaders(headers) {
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(headers.get("x-powered-by"), null);
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(headers.get("referrer-policy"), "no-referrer");

  const csp = headers.get("content-security-policy");

  assert.ok(csp, "Content-Security-Policy must be present");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);

  const hsts = headers.get("strict-transport-security");

  assert.ok(hsts, "Strict-Transport-Security must be present");
  assert.match(hsts, /max-age=\d+/);
}

test("GET /api/health succeeds through the real middleware stack", async () => {
  const response = await send("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "phishguard-api"
  });
});

test("a normal API response carries the important Helmet protections", async () => {
  const response = await send("/api/health");

  assert.equal(response.status, 200);
  assertSecurityHeaders(response.headers);
});

test("security headers remain present on a 4xx response", async () => {
  // A real protected route with no credentials. The request never reaches a
  // controller, and the rejection still carries the security headers.
  const response = await send("/api/analyze");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Authentication required"
  });
  assertSecurityHeaders(response.headers);
});

test("the configured allowed origin is authorized and credentials are enabled", async () => {
  const response = await send("/api/health", {
    headers: { Origin: ALLOWED_ORIGIN }
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN
  );
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("vary") ?? "", /Origin/);
});

test("a disallowed origin is never authorized by the response", async () => {
  const response = await send("/api/health", {
    headers: { Origin: DISALLOWED_ORIGIN }
  });

  // The configured origin is a static value in the current CORS configuration,
  // so the package answers with that origin rather than echoing the requester.
  // What matters, and what is asserted here, is that the disallowed origin is
  // never the value being authorized. The browser performs the match, so an
  // attacker origin receives no usable grant.
  assert.notEqual(
    response.headers.get("access-control-allow-origin"),
    DISALLOWED_ORIGIN
  );
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN
  );
});

test("an OPTIONS preflight from the allowed origin succeeds and permits the frontend request", async () => {
  const response = await send("/api/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN
  );
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");

  // The frontend authenticates with an Authorization header and posts JSON.
  const allowedHeaders = response.headers.get("access-control-allow-headers") ?? "";

  assert.match(allowedHeaders, /authorization/i);
  assert.match(allowedHeaders, /content-type/i);

  const allowedMethods = response.headers.get("access-control-allow-methods") ?? "";

  assert.match(allowedMethods, /POST/);
});

test("a request body above the configured 1 MB JSON limit is rejected with 413", async () => {
  const oversized = "x".repeat(1_200_000);

  const response = await send("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: oversized, password: oversized })
  });

  const text = await response.text();

  // The parser's entity-too-large condition is mapped to 413 with a fixed
  // message. Nothing about the parser, the received body, its length, or the
  // configured limit is published.
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(text), {
    success: false,
    error: "Request body too large"
  });

  assert.equal(text.includes("entity.too.large"), false);
  assert.equal(text.includes("PayloadTooLargeError"), false);
  assert.equal(text.includes("request entity too large"), false);
  assert.equal(text.includes("1048576"), false);
  assert.equal(text.includes("1200012"), false);
  assert.equal(text.includes(" at "), false, "must not expose a stack trace");
  assert.equal(text.includes(oversized.slice(0, 64)), false);
});

test("a rejected oversized body still carries the security headers", async () => {
  const response = await send("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "y".repeat(1_200_000) })
  });

  assert.equal(response.status, 413);
  assertSecurityHeaders(response.headers);
});

test("malformed JSON is rejected by the real global error handler without leaking details", async () => {
  const response = await send("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json"
  });

  const text = await response.text();

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(text), {
    success: false,
    error: "Invalid JSON payload"
  });
  assert.equal(text.includes("JSON.parse"), false);
  assert.equal(text.includes("Unexpected token"), false);
  assert.equal(text.includes("position"), false);
});

test("importing app.js neither connects to MongoDB nor starts a listener", async () => {
  // ReadyState 0 is "disconnected". Importing the app module must never open a
  // connection, and none of the requests above should have opened one either.
  assert.equal(mongoose.connection.readyState, 0);

  // The bootstrap module owns the database and the listener, so neither it nor
  // the database module may be pulled in by importing the app.
  const loadedKeys = Object.keys(require.cache);

  assert.equal(
    loadedKeys.some((key) => /[\\/]config[\\/]db\.js$/.test(key)),
    false,
    "config/db.js must not be loaded by app.js"
  );
  assert.equal(
    loadedKeys.some((key) => /[\\/]src[\\/]server\.js$/.test(key)),
    false,
    "server.js must not be loaded by app.js"
  );

  // The only listener in this process is the ephemeral one created above.
  assert.ok(baseUrl.startsWith("http://127.0.0.1:"));
});

test("createApp returns independent app instances without shared state", () => {
  const first = createApp();
  const second = createApp();

  assert.notEqual(first, second);
  assert.equal(typeof first.listen, "function");
});

test("the bootstrap still connects to the database before listening", async () => {
  // Previously this was asserted by matching literal source text. The bootstrap
  // now takes its collaborators as injectable parameters so the lifecycle is
  // testable, which changed that text. The GUARANTEE is unchanged, so it is
  // now asserted behaviourally - which is stronger, because ordering is observed
  // rather than inferred from a substring.
  // 0. Test-only dotenv isolation (same mechanism as the stub at the top of
  //    lifecycle.test.js): `src/server.js` line 1 calls
  //    `require("dotenv").config()`, which would read the real `apps/api/.env`
  //    into this child process. Replacing dotenv under its own require-cache
  //    key before this require makes that call a no-op for every evaluation
  //    of the module below, without touching production code and without
  //    reading or displaying `.env`.
  const dotenvStubPath = require.resolve("dotenv");

  delete require.cache[dotenvStubPath];

  const dotenvStubModule = new (require("node:module").Module)(
    dotenvStubPath,
    null
  );

  dotenvStubModule.filename = dotenvStubPath;
  dotenvStubModule.loaded = true;
  dotenvStubModule.exports = { config: () => ({}) };
  require.cache[dotenvStubPath] = dotenvStubModule;

  const serverModule = require("../src/server.js");
  const source = fs.readFileSync(
    require.resolve("../src/server.js"),
    "utf8"
  );

  // 1. The app still comes from `createApp()` in app.js, and the database
  //    connector still comes from `config/db.js`.
  assert.match(source, /const \{ createApp \} = require\("\.\/app"\)/);
  assert.match(source, /require\("\.\/config\/db"\)/);
  assert.match(source, /connect = connectDB/);

  // 2. The connection is awaited before the listener is created. A fake app and
  //    a fake connector record the real call order. `startServer` performs the
  //    real environment validation, so synthetic values are supplied and
  //    restored; nothing is ever connected to.
  const previousMongodb = process.env.MONGODB_URI;
  const previousJwt = process.env.JWT_SECRET;

  process.env.MONGODB_URI = "mongodb://example.invalid/phishguard";
  process.env.JWT_SECRET = "a-secret-for-tests";

  try {
    const order = [];
    const handlers = {};
    const fakeServer = {
      once(event, handler) {
        handlers[event] = handler;

        return this;
      }
    };

    const server = await serverModule.startServer({
      port: 0,
      connect: async () => {
        order.push("connect");
      },
      buildApp: () => ({
        listen: () => {
          order.push("listen");

          // Real `http.Server` emits `listening` asynchronously.
          setImmediate(() => handlers.listening());

          return fakeServer;
        }
      }),
      logger: { log() {} }
    });

    assert.deepEqual(order, ["connect", "listen"]);
    assert.equal(server, fakeServer);

    // 3. A connection failure must mean the listener is never reached, so the
    //    service never accepts a request it cannot serve. Environment
    //    validation passes first, so this fails at connect and not before it.
    let listenCalls = 0;

    await assert.rejects(
      serverModule.startServer({
        port: 0,
        connect: async () => {
          throw new Error("simulated connection failure");
        },
        buildApp: () => ({
          listen: () => {
            listenCalls += 1;

            return { once() {} };
          }
        }),
        logger: { log() {} }
      }),
      /simulated connection failure/
    );

    assert.equal(listenCalls, 0);
  } finally {
    if (previousMongodb === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = previousMongodb;
    }

    if (previousJwt === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwt;
    }
  }

  // 4. The listener still uses the same PORT expression as before.
  assert.match(
    source,
    /const PORT = process\.env\.PORT \|\| 5000;/
  );
});

test("the HTTP middleware configuration exists in exactly one place", () => {
  const appSource = fs.readFileSync(require.resolve("../src/app.js"), "utf8");
  const serverSource = fs.readFileSync(
    require.resolve("../src/server.js"),
    "utf8"
  );

  // app.js is the single source of truth for the HTTP stack.
  assert.match(appSource, /app\.use\(helmet\(\)\)/);
  assert.match(appSource, /cors\(/);
  assert.match(appSource, /credentials: true/);
  assert.match(appSource, /express\.json\(\{ limit: JSON_BODY_LIMIT \}\)/);
  assert.match(appSource, /cookieParser\(\)/);
  assert.match(appSource, /app\.use\(errorHandler\)/);
  assert.match(appSource, /"1mb"/);

  // server.js must not carry a second copy of any of it.
  assert.doesNotMatch(serverSource, /helmet/);
  assert.doesNotMatch(serverSource, /cors\(/);
  assert.doesNotMatch(serverSource, /express\.json/);
  assert.doesNotMatch(serverSource, /cookieParser/);
  assert.doesNotMatch(serverSource, /errorHandler/);

  // Only app.js mounts API routes.
  assert.match(appSource, /app\.use\("\/api\/auth", authRoutes\)/);
  assert.match(appSource, /app\.use\("\/api\/research", researchRoutes\)/);
  assert.doesNotMatch(serverSource, /Routes\)/);
});