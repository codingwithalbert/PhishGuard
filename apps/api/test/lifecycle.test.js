const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

// Test-only dotenv isolation.
//
// `src/server.js` line 1 calls `require("dotenv").config()`, which reads the
// developer's real `apps/api/.env` into this child process and prints dotenv's
// "injected env" summary. This suite is offline: every lifecycle collaborator
// is injected and every environment test uses synthetic values, so the real
// file load adds nothing but credential presence and console noise here.
//
// Replacing dotenv in the require cache makes `config()` a no-op for EVERY
// evaluation of `src/server` in this process: the import below, the
// cache-deletion re-require in the import-isolation test, and the dynamic
// `import("../src/server.js")` in the fatal-error-handler test. It survives
// `src/server` cache deletions because the stub lives under dotenv's own
// cache key, and nested `require("dotenv")` of a CommonJS module resolves
// through the same CJS loader/cache in both paths. No production file is
// modified; `.env` is never read or displayed.
//
// KNOWN LIMITS: the stub intentionally stays active for the remainder of this
// child process (`node --test` runs each file in its own process, so no other
// suite is affected); it covers CommonJS `require`/`import()` only - a future
// ESM-mode runner or a `dotenv/config` preload shim would resolve dotenv
// outside the CJS cache and bypass this stub; and a future test that wanted
// to exercise dotenv's real file parsing through `src/server` would need to
// remove it first.
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

const errorHandler = require("../src/middleware/error.middleware");
const {
  SHUTDOWN_BUDGET_MS,
  SHUTDOWN_EVENTS,
  closeHttpServer,
  createFatalErrorHandler,
  createShutdownController,
  registerProcessHandlers,
  removeProcessHandlers,
  runAsMain,
  startServer,
  validateEnvironment
} = require("../src/server");
const { createApp, describeDatabaseReadiness } = require("../src/app");

// Operational lifecycle and database readiness.
//
// Everything here runs offline. No real database is connected and no
// externally reachable listener is started: the shutdown controller takes every
// collaborator as an injected fake, and the HTTP assertions use ephemeral
// loopback servers on port 0, exactly as the existing security suites do.
//
// SCOPE NOTE, preserved deliberately: these tests prove that the shutdown and
// readiness LOGIC is correct and that the modules have no import side effects.
// They prove nothing about any running deployment - not about signal delivery,
// not about platform termination allowances, and not about a real database
// connection transitioning between states. Those require a real environment.

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createRecordingLogger() {
  const lines = [];

  return {
    lines,
    log: (line) => lines.push({ level: "log", line }),
    error: (line) => lines.push({ level: "error", line }),
    all: () => lines.map((entry) => entry.line).join("\n")
  };
}

/** Minimal http.Server stand-in that records how it was closed. */
function createFakeServer({ listening = true, neverFinish = false, failOnClose = false } = {}) {
  const state = {
    listening,
    closed: false,
    idleClosed: false,
    idleCloseSupported: true
  };

  return {
    state,
    get listening() {
      return state.listening;
    },
    close(callback) {
      if (failOnClose) {
        callback(new Error("close failed"));

        return;
      }

      state.listening = false;
      state.closed = true;

      if (!neverFinish) {
        callback();
      }
    },
    closeIdleConnections() {
      state.idleClosed = true;
    }
  };
}

/**
 * `http.Server` stand-in whose drain completes only when `finishDrain()` is
 * called.
 *
 * `createFakeServer` resolves `close()` immediately, which cannot reproduce the
 * interleavings that matter most here: a fatal error arriving mid-drain, or a
 * cleanup finishing after the shutdown deadline. This fake holds the drain open
 * so a test can decide exactly when it completes.
 */
function createDeferredServer() {
  const state = { listening: true, closed: false, idleClosed: false, finish: null };

  return {
    state,
    get listening() {
      return state.listening;
    },
    close(callback) {
      state.listening = false;
      state.closed = true;
      state.finish = callback;
    },
    closeIdleConnections() {
      state.idleClosed = true;
    },
    finishDrain(error) {
      const callback = state.finish;

      state.finish = null;

      if (callback) {
        callback(error);
      }
    }
  };
}

/** Environment guard: applies overrides for the duration of `fn`, then restores. */
function withEnvironment(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createFakeProcessRef() {
  const listeners = new Map();

  return {
    exitCodes: [],
    listenerCount(event) {
      return listeners.get(event)?.length ?? 0;
    },
    listenersFor(event) {
      return listeners.get(event) ?? [];
    },
    on(event, handler) {
      const existing = listeners.get(event) ?? [];

      existing.push(handler);
      listeners.set(event, existing);
    },
    removeListener(event, handler) {
      const existing = listeners.get(event) ?? [];
      const index = existing.indexOf(handler);

      if (index >= 0) {
        existing.splice(index, 1);
      }
    },
    exit(code) {
      this.exitCodes.push(code);
    }
  };
}

function parseLogLines(logger, prefix) {
  return logger
    .all()
    .split("\n")
    .filter((line) => line.includes(prefix))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"), line.length).trim()));
}

// ---------------------------------------------------------------------------
// PART A / F1 - importing has no startup side effects
// ---------------------------------------------------------------------------

test("importing server.js registers no signal handlers and starts nothing", () => {
  // The test runner itself may already hold listeners, so the meaningful
  // assertion is that a fresh evaluation of the module body changes nothing.
  const events = ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"];
  const before = events.map((event) => process.listenerCount(event));

  const modulePath = require.resolve("../src/server");

  delete require.cache[modulePath];
  require("../src/server");

  const after = events.map((event) => process.listenerCount(event));

  assert.deepEqual(after, before, "importing must register no process handlers");
});

test("importing the lifecycle module opens no database connection", () => {
  // ReadyState 0 is "disconnected".
  assert.equal(mongoose.connection.readyState, 0);
});

test("startup environment validation is unchanged and still fails fast", () => {
  const previousMongodb = process.env.MONGODB_URI;
  const previousJwt = process.env.JWT_SECRET;

  delete process.env.MONGODB_URI;
  delete process.env.JWT_SECRET;

  assert.throws(() => validateEnvironment(), /MONGODB_URI/);
  assert.throws(() => validateEnvironment(), /JWT_SECRET/);

  process.env.JWT_SECRET = "a-secret-for-tests";
  assert.throws(() => validateEnvironment(), /MONGODB_URI/);

  process.env.MONGODB_URI = "mongodb://example.invalid/phishguard";

  assert.doesNotThrow(() => validateEnvironment());

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
});

test("a failed database connection prevents HTTP listening entirely", async () => {
  const listenCalls = [];

  await assert.rejects(
    startServer({
      port: 0,
      connect: async () => {
        throw new Error("simulated connection failure");
      },
      buildApp: () => ({
        listen: (...args) => {
          listenCalls.push(args);

          return { once: () => {} };
        }
      })
    })
  );

  assert.equal(
    listenCalls.length,
    0,
    "the service must never accept a request it cannot serve"
  );
});

test("startup succeeds only after the connection resolves", async () => {
  const previousMongodb = process.env.MONGODB_URI;
  const previousJwt = process.env.JWT_SECRET;

  // `startServer` performs the real environment validation, so the variables
  // must be present. Synthetic values only; nothing is ever connected to.
  process.env.MONGODB_URI = "mongodb://example.invalid/phishguard";
  process.env.JWT_SECRET = "a-secret-for-tests";

  try {
    const order = [];

    // Models real `http.Server` behaviour: `listen()` returns synchronously and
    // emits `listening` asynchronously.
    const fakeServer = {
      handlers: {},
      once(event, handler) {
        this.handlers[event] = handler;

        return this;
      },
      emit(event) {
        this.handlers[event]?.();
      }
    };

    const app = {
      listen: (_port, callback) => {
        order.push("listen");

        // A callback argument is accepted and ignored, proving the
        // implementation does not depend on it for the server handle.
        void callback;

        setImmediate(() => fakeServer.emit("listening"));

        return fakeServer;
      }
    };

    const server = await startServer({
      port: 0,
      connect: async () => {
        order.push("connect");
      },
      buildApp: () => app,
      logger: createRecordingLogger()
    });

    assert.deepEqual(order, ["connect", "listen"]);
    assert.equal(server, fakeServer);
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
});

// ---------------------------------------------------------------------------
// PART B / F3-F9 - graceful shutdown
// ---------------------------------------------------------------------------

test("SIGTERM closes the server, disconnects the database, and exits 0", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  const disconnects = [];
  const server = createFakeServer();

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {
      disconnects.push("disconnect");
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.equal(server.state.closed, true, "the HTTP server must be closed");
  assert.deepEqual(disconnects, ["disconnect"], "the database must be disconnected");
  assert.deepEqual(exitCodes, [0], "a clean shutdown exits 0");

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.deepEqual(events, [SHUTDOWN_EVENTS.begin, SHUTDOWN_EVENTS.complete]);
});

test("SIGINT shuts down identically to SIGTERM", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  const server = createFakeServer();

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGINT", 0);

  assert.equal(server.state.closed, true);
  assert.deepEqual(exitCodes, [0]);

  const begin = parseLogLines(logger, "[LIFECYCLE]")[0];

  assert.equal(begin.reason, "SIGINT");
});

test("idle connections are closed while active requests drain", async () => {
  const server = createFakeServer();

  await closeHttpServer(server);

  assert.equal(server.state.idleClosed, true, "idle keep-alive sockets must be closed");
  assert.equal(server.state.closed, true);
});

test("the database is disconnected only after the server has closed", async () => {
  const order = [];
  const server = createFakeServer();

  const controller = createShutdownController({
    server: Object.assign(server, {
      close(callback) {
        order.push("server.close");

        callback();
      }
    }),
    disconnectDatabase: async () => {
      order.push("disconnect");
    },
    exit: () => {},
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(
    order,
    ["server.close", "disconnect"],
    "disconnecting earlier would fail in-flight requests that still need the database"
  );
});

test("shutdown is idempotent and cannot be re-entered", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  let disconnects = 0;

  const controller = createShutdownController({
    server: createFakeServer(),
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);
  await controller.shutdown("SIGTERM", 0);
  await controller.shutdown("unhandledRejection", 1);

  assert.equal(disconnects, 1, "cleanup must run exactly once");
  assert.deepEqual(exitCodes, [0], "a later fatal error must not re-exit");
  assert.equal(controller.isShuttingDown(), true);

  const begins = parseLogLines(logger, "[LIFECYCLE]").filter(
    (entry) => entry.event === SHUTDOWN_EVENTS.begin
  );

  assert.equal(begins.length, 1, "only one shutdown may begin");
});

test("shutting down before the server ever listened is safe", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  let disconnects = 0;

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(exitCodes, [0]);
  assert.equal(disconnects, 1, "the database is still released");

  const notListening = createFakeServer({ listening: false });

  await closeHttpServer(notListening);

  assert.equal(notListening.state.closed, false, "a stopped server is not re-closed");
});

test("the shutdown budget expires with a bounded nonzero exit", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];

  const controller = createShutdownController({
    // A server that accepts close() but never completes draining.
    server: createFakeServer({ neverFinish: true }),
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 40
  });

  controller.shutdown("SIGTERM", 0);

  await new Promise((resolve) => setTimeout(resolve, 140));

  assert.deepEqual(exitCodes, [1], "an expired budget must still terminate, nonzero");

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.timeout), true);
});

test("a cleanup failure terminates nonzero rather than hanging", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];

  const controller = createShutdownController({
    server: createFakeServer({ failOnClose: true }),
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(exitCodes, [1]);

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.failed), true);
});

test("the shutdown budget is the documented provisional value", () => {
  assert.equal(SHUTDOWN_BUDGET_MS, 10000);
});

// ---------------------------------------------------------------------------
// PART C / F10-F11 - fatal process errors
// ---------------------------------------------------------------------------

test("unhandled rejections trigger a controlled nonzero shutdown", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  let disconnects = 0;

  const controller = createShutdownController({
    server: createFakeServer(),
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown(SHUTDOWN_EVENTS.fatalRejection, 1);

  assert.equal(disconnects, 1, "the database must still be released");
  assert.deepEqual(exitCodes, [1], "a fatal error must exit nonzero");

  const entries = parseLogLines(logger, "[LIFECYCLE]");

  // The controller records the fatal category as the shutdown reason; the
  // sanitized category line itself is written by `createFatalErrorHandler`.
  assert.equal(entries[0].event, SHUTDOWN_EVENTS.begin);
  assert.equal(entries[0].reason, SHUTDOWN_EVENTS.fatalRejection);
  assert.equal(
    entries.some((entry) => entry.event === SHUTDOWN_EVENTS.complete),
    true,
    "cleanup still completes even after a fatal error"
  );
});

test("fatal logs contain no message, stack, token, or connection string", async () => {
  const logger = createRecordingLogger();
  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: () => {},
    logger,
    timeoutMs: 500
  });

  // Simulate the worst realistic case: a connection error carrying the URI.
  const secretUri =
    "mongodb+srv://user:hunter2@cluster0.example.invalid/phishguard?retryWrites=true";
  const rawError = new Error(`failed to connect to ${secretUri}`);

  rawError.stack = "Error: secret stack\n    at Object.<anonymous> (/app/src/server.js:1:1)";

  const handler = (await import("../src/server.js")).createFatalErrorHandler(
    controller,
    logger,
    SHUTDOWN_EVENTS.fatalException
  );

  handler(rawError);

  const output = logger.all();

  for (const forbidden of [
    "hunter2",
    secretUri,
    "cluster0.example.invalid",
    "Error:",
    "at Object",
    "server.js",
    rawError.message
  ]) {
    assert.equal(
      output.includes(forbidden),
      false,
      `fatal output must not contain ${forbidden}`
    );
  }

  assert.equal(output.includes(SHUTDOWN_EVENTS.fatalException), true);
});

test("the fatal handler ignores the rejection reason entirely", async () => {
  const logger = createRecordingLogger();
  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: () => {},
    logger,
    timeoutMs: 500
  });

  const rejections = [];
  const promises = [];

  for (const reason of [
    new Error("password=hunter2 rejected"),
    "string rejection with mongodb://secret",
    { password: "hunter2" }
  ]) {
    promises.push(controller.shutdown(SHUTDOWN_EVENTS.fatalRejection, 1));
    rejections.push(reason);
  }

  await Promise.all(promises);

  const output = logger.all();

  assert.equal(output.includes("hunter2"), false);
  assert.equal(output.includes("mongodb://secret"), false);
  assert.equal(rejections.length, 3);
});

// ---------------------------------------------------------------------------
// PART A / F2, F5 - handler registration
// ---------------------------------------------------------------------------

test("handlers register exactly once and re-registration does not duplicate", () => {
  const processRef = createFakeProcessRef();
  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: () => {},
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  registerProcessHandlers({ controller, logger: createRecordingLogger(), processRef });

  for (const event of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"]) {
    assert.equal(processRef.listenerCount(event), 1, `${event} must register once`);
  }

  registerProcessHandlers({ controller, logger: createRecordingLogger(), processRef });

  for (const event of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"]) {
    assert.equal(
      processRef.listenerCount(event),
      1,
      `${event} must not stack a second handler`
    );
  }
});

test("registration does not discard handlers owned by anything else", () => {
  const processRef = createFakeProcessRef();
  const foreign = () => {};

  processRef.on("SIGTERM", foreign);

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: () => {},
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  const registration = registerProcessHandlers({
    controller,
    logger: createRecordingLogger(),
    processRef
  });

  assert.equal(
    processRef.listenersFor("SIGTERM").includes(foreign),
    true,
    "an unrelated listener must survive"
  );

  registration.remove();

  assert.equal(
    processRef.listenersFor("SIGTERM").includes(foreign),
    true,
    "removal must not take an unrelated listener with it"
  );

  removeProcessHandlers({ processRef });
});

test("a registered SIGTERM handler drives the shutdown sequence", async () => {
  const processRef = createFakeProcessRef();
  const exitCodes = [];
  let disconnects = 0;
  const server = createFakeServer();

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  const registration = registerProcessHandlers({
    controller,
    logger: createRecordingLogger(),
    processRef
  });

  await processRef.listenersFor("SIGTERM")[0]();

  assert.equal(server.state.closed, true);
  assert.equal(disconnects, 1);
  assert.deepEqual(exitCodes, [0]);

  registration.remove();
});

test("a registered unhandledRejection handler drives a nonzero shutdown", async () => {
  const processRef = createFakeProcessRef();
  const exitCodes = [];

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  const registration = registerProcessHandlers({
    controller,
    logger: createRecordingLogger(),
    processRef
  });

  await processRef.listenersFor("unhandledRejection")[0](new Error("rejected"));

  assert.deepEqual(exitCodes, [1]);

  registration.remove();
});

// ---------------------------------------------------------------------------
// PART D / F14-F17 - readiness
// ---------------------------------------------------------------------------

test("readiness maps every connection state to a coarse word", () => {
  const states = mongoose.Connection.STATES;

  assert.deepEqual(describeDatabaseReadiness(states.connected), {
    ready: true,
    state: "connected"
  });
  assert.deepEqual(describeDatabaseReadiness(states.connecting), {
    ready: false,
    state: "connecting"
  });
  assert.deepEqual(describeDatabaseReadiness(states.disconnecting), {
    ready: false,
    state: "disconnecting"
  });
  assert.deepEqual(describeDatabaseReadiness(states.disconnected), {
    ready: false,
    state: "disconnected"
  });
  assert.deepEqual(describeDatabaseReadiness(states.uninitialized), {
    ready: false,
    state: "unavailable"
  });
});

test("an unrecognised or missing connection state is reported as unavailable", () => {
  for (const value of [undefined, null, -1, 42, "connected", {}]) {
    assert.deepEqual(
      describeDatabaseReadiness(value),
      { ready: false, state: "unavailable" },
      `${String(value)} must not be treated as ready`
    );
  }
});

async function withApp(fn) {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

test("GET /api/health is unchanged and independent of the database", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "phishguard-api"
    });
  });
});

test("GET /api/health returns 200 while the database is disconnected", async () => {
  // The anti-restart-loop guarantee. A platform probing this endpoint must
  // never see a failure because the database is down.
  assert.equal(mongoose.connection.readyState, 0);

  await withApp(async (base) => {
    const response = await fetch(`${base}/api/health`);

    assert.equal(
      response.status,
      200,
      "liveness must not depend on database readiness"
    );
  });
});

test("GET /api/ready reports not ready while the database is disconnected", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/ready`);

    assert.equal(response.status, 503);

    const body = await response.json();

    assert.deepEqual(body, {
      status: "not_ready",
      service: "phishguard-api",
      database: "disconnected"
    });
    assert.equal(
      response.headers.get("cache-control"),
      "no-store",
      "readiness must never be cached"
    );
  });
});

test("readiness responses expose no database internals", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/ready`);
    const text = await response.text();

    for (const forbidden of [
      "mongodb",
      "mongodb+srv",
      "://",
      "host",
      "port",
      "uri",
      "cluster",
      "replicaSet",
      "readyState",
      process.env.MONGODB_URI ?? "mongodb+srv://unset"
    ]) {
      assert.equal(
        text.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `readiness response must not contain ${forbidden}`
      );
    }
  });
});

test("readiness is public and unauthenticated, matching health", async () => {
  await withApp(async (base) => {
    const ready = await fetch(`${base}/api/ready`);
    const health = await fetch(`${base}/api/health`);

    assert.equal(ready.status, 503, "readiness answers without credentials");
    assert.equal(health.status, 200, "health answers without credentials");
  });
});

test("the readiness route is reachable through the real middleware stack", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/ready`);

    // Security headers must be present on readiness exactly as on any other
    // response, because it is mounted inside `createApp()`.
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-powered-by"), null);
  });
});

test("an unmatched path does not reach the JSON error handler", async () => {
  // There is deliberately no dedicated 404 handler, so an unknown path falls
  // through to Express's own default. This is recorded here as observed
  // behaviour, not endorsed as a contract.
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/definitely-not-a-route`);

    assert.equal(response.status, 404);
  });
});

test("the error handler is still mounted last and is reachable", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/analyze`);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Authentication required"
    });
  });

  assert.equal(typeof errorHandler, "function");
});

// ---------------------------------------------------------------------------
// S4D - PART A: fatal exit-code escalation (D-1)
//
// Regression coverage for the defect where an unhandled rejection arriving while
// a graceful shutdown was already draining was logged and then reported to the
// platform as a clean exit 0.
// ---------------------------------------------------------------------------

test("a fatal error during an in-progress shutdown escalates the exit code to 1", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  const server = createDeferredServer();
  let disconnects = 0;

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 5000
  });

  const fatal = createFatalErrorHandler(
    controller,
    logger,
    SHUTDOWN_EVENTS.fatalRejection,
    1
  );

  // 1. SIGTERM begins an ordinary graceful shutdown, which pauses in the drain.
  const pending = controller.shutdown("SIGTERM", 0);

  await wait(0);

  assert.deepEqual(exitCodes, [], "no exit may happen while cleanup is still pending");

  // 2. An unhandled rejection arrives WHILE that shutdown is draining.
  await fatal(new Error("boom during shutdown"));

  assert.equal(controller.isShuttingDown(), true);
  assert.deepEqual(exitCodes, [], "the fatal error must not start a second cleanup");

  // 3. The drain finally completes.
  server.finishDrain();

  await pending;

  assert.deepEqual(
    exitCodes,
    [1],
    "a fatal error must never be reported as a successful shutdown"
  );
  assert.equal(disconnects, 1, "cleanup must still run exactly once");

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(
    events.filter((event) => event === SHUTDOWN_EVENTS.begin).length,
    1,
    "only one shutdown may begin"
  );
  assert.equal(events.includes(SHUTDOWN_EVENTS.fatalRejection), true);
  assert.equal(events.includes(SHUTDOWN_EVENTS.complete), true, "cleanup still completes");
  assert.equal(events.includes(SHUTDOWN_EVENTS.timeout), false);
});

test("an uncaught exception during an in-progress shutdown also escalates the exit code", async () => {
  const exitCodes = [];
  const server = createDeferredServer();

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 5000
  });

  const pending = controller.shutdown("SIGINT", 0);

  await wait(0);

  const fatal = createFatalErrorHandler(
    controller,
    createRecordingLogger(),
    SHUTDOWN_EVENTS.fatalException,
    1
  );

  await fatal(new TypeError("cannot read properties of undefined"));

  server.finishDrain();

  await pending;

  assert.deepEqual(exitCodes, [1], "SIGINT plus a fatal error must still end nonzero");
});

test("an ordinary shutdown with no fatal error still exits 0", async () => {
  const exitCodes = [];
  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 5000
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(exitCodes, [0], "escalation must not invent failures");
});

test("only a literal zero counts as a clean shutdown", async () => {
  // A code that is present but not literally 0 must fail closed rather than be
  // read as success. `undefined` is deliberately absent: it is the documented
  // default (`exitCode = 0`) that a plain signal relies on.
  for (const code of [null, Number.NaN, "0", "", false, 2]) {
    const exitCodes = [];
    const controller = createShutdownController({
      server: null,
      disconnectDatabase: async () => {},
      exit: (recorded) => exitCodes.push(recorded),
      logger: createRecordingLogger(),
      timeoutMs: 500
    });

    await controller.shutdown("SIGNAL", code);

    assert.deepEqual(
      exitCodes,
      [1],
      `exit code ${JSON.stringify(code) ?? "undefined"} must not be treated as success`
    );
  }
});

// ---------------------------------------------------------------------------
// S4D - PART B: exactly-once termination (D-2)
//
// Regression coverage for the defect where the deadline called `exit(1)` and a
// later-completing cleanup then called `exit(0)` as well.
// ---------------------------------------------------------------------------

test("an HTTP drain that completes after the deadline exits exactly once", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  const server = createDeferredServer();

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 60
  });

  const pending = controller.shutdown("SIGTERM", 0);

  await wait(200);

  assert.deepEqual(exitCodes, [1], "an expired budget must terminate nonzero");

  // The drain finishes after the deadline already forced termination.
  server.finishDrain();

  await pending;

  assert.deepEqual(
    exitCodes,
    [1],
    "a forced timeout must never be replaced by a later successful exit"
  );
  assert.equal(controller.isTerminating(), true);

  const entries = parseLogLines(logger, "[LIFECYCLE]");

  assert.deepEqual(entries.map((entry) => entry.event), [
    SHUTDOWN_EVENTS.begin,
    SHUTDOWN_EVENTS.timeout,
    SHUTDOWN_EVENTS.complete
  ]);
  assert.equal(
    entries.at(-1).exitCode,
    1,
    "the late completion must still report the nonzero outcome"
  );
});

test("a database disconnect that completes after the deadline exits exactly once", async () => {
  const exitCodes = [];
  let finishDisconnect;

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: () =>
      new Promise((resolve) => {
        finishDisconnect = resolve;
      }),
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 60
  });

  const pending = controller.shutdown("SIGTERM", 0);

  await wait(200);

  assert.deepEqual(exitCodes, [1]);

  finishDisconnect();

  await pending;

  assert.deepEqual(exitCodes, [1], "the deadline outcome must survive a late success");
});

test("the deadline stays armed while the database is disconnecting", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];
  const server = createDeferredServer();

  const controller = createShutdownController({
    server,
    // The HTTP drain completes promptly; the database release never settles.
    disconnectDatabase: () => new Promise(() => {}),
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 120
  });

  const pending = controller.shutdown("SIGTERM", 0);

  // `close()` is invoked synchronously inside `shutdown`, so the drain callback
  // is already waiting when this runs.
  server.finishDrain();

  await wait(320);

  assert.equal(server.state.closed, true, "the HTTP phase did complete");
  assert.deepEqual(exitCodes, [1], "the budget must also cover database disconnection");

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.timeout), true);

  // `pending` intentionally never settles because the database release hangs.
  // It carries no rejection, so leaving it unawaited is safe.
  void pending;
});

test("a database disconnect that never settles still terminates nonzero", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: () => new Promise(() => {}),
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 60
  });

  const pending = controller.shutdown("SIGTERM", 0);

  await wait(200);

  assert.deepEqual(exitCodes, [1]);

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.timeout), true);

  void pending;
});

test("a rejected database disconnect terminates nonzero without leaking it", async () => {
  const logger = createRecordingLogger();
  const exitCodes = [];

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {
      throw new Error(
        "failed to reach mongodb+srv://phishguard:hunter2@cluster0.example.invalid/db"
      );
    },
    exit: (code) => exitCodes.push(code),
    logger,
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(exitCodes, [1], "a cleanup failure must not hang or look successful");

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.failed), true);
  assert.equal(logger.all().includes("hunter2"), false);
  assert.equal(logger.all().includes("cluster0.example.invalid"), false);
});

test("further shutdown requests after termination cannot re-exit", async () => {
  const exitCodes = [];
  const server = createDeferredServer();
  let disconnects = 0;

  const controller = createShutdownController({
    server,
    disconnectDatabase: async () => {
      disconnects += 1;
    },
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 60
  });

  const pending = controller.shutdown("SIGTERM", 0);

  await wait(200);

  assert.deepEqual(exitCodes, [1], "the deadline terminated the process");

  // Everything that arrives afterwards must be a no-op.
  await controller.shutdown("SIGTERM", 0);
  await controller.shutdown(SHUTDOWN_EVENTS.fatalRejection, 1);

  server.finishDrain();

  await pending;

  assert.deepEqual(exitCodes, [1], "termination is requested exactly once");
  assert.equal(disconnects, 1, "cleanup ran exactly once");
  assert.equal(controller.isTerminating(), true);
});

// ---------------------------------------------------------------------------
// S4D - PART C: the startup/shutdown race (D-3)
//
// Regression coverage for the defect where the database connection resolving
// after a shutdown had begun still produced an HTTP listener that nothing would
// ever close.
// ---------------------------------------------------------------------------

const STARTUP_ENV = {
  MONGODB_URI: "mongodb://example.invalid/phishguard",
  JWT_SECRET: "a-secret-for-tests"
};

test("a shutdown during a pending database connection prevents listening", async () => {
  await withEnvironment(STARTUP_ENV, async () => {
    const exitCodes = [];
    const listenCalls = [];
    let finishConnect;
    let shuttingDownWhenConnectionResolved = null;

    const controller = createShutdownController({
      server: null,
      disconnectDatabase: () => wait(30),
      exit: (code) => exitCodes.push(code),
      logger: createRecordingLogger(),
      timeoutMs: 5000
    });

    const startup = startServer({
      port: 0,
      isShuttingDown: controller.isShuttingDown,
      connect: () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        }),
      buildApp: () => ({
        listen: (...args) => {
          listenCalls.push(args);

          return { once() {} };
        }
      }),
      logger: createRecordingLogger()
    });

    // SIGTERM arrives while the database connection is still in flight.
    const shutdown = controller.shutdown("SIGTERM", 0);

    // The connection finally completes, after the shutdown has begun.
    shuttingDownWhenConnectionResolved = controller.isShuttingDown();
    finishConnect();

    const server = await startup;

    assert.equal(shuttingDownWhenConnectionResolved, true, "the signal is already pending");
    assert.deepEqual(listenCalls, [], "no listener may be created after shutdown begins");
    assert.equal(server, null, "startup must report that it produced no server");

    await shutdown;

    assert.deepEqual(exitCodes, [0], "a requested stop is not a failure");
  });
});

test("a listener created while a shutdown begins is closed rather than abandoned", async () => {
  await withEnvironment(STARTUP_ENV, async () => {
    let shuttingDown = false;
    const closed = [];
    const handlers = {};

    const listener = {
      listening: true,
      close(callback) {
        closed.push("close");
        this.listening = false;

        callback();
      },
      closeIdleConnections() {
        closed.push("idle");
      },
      once(event, handler) {
        handlers[event] = handler;

        return this;
      }
    };

    const server = await startServer({
      port: 0,
      isShuttingDown: () => shuttingDown,
      connect: async () => {},
      buildApp: () => ({
        listen: () => {
          // A signal lands after `listen()` but before `listening` is emitted.
          shuttingDown = true;
          setImmediate(() => handlers.listening());

          return listener;
        }
      }),
      logger: createRecordingLogger()
    });

    assert.equal(server, null, "startup must report that it produced no usable server");
    assert.deepEqual(
      closed,
      ["close", "idle"],
      "the late listener must be closed, never left listening"
    );
  });
});

test("a server attached after shutdown began is closed rather than abandoned", async () => {
  const exitCodes = [];
  const late = createDeferredServer();

  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);

  assert.deepEqual(exitCodes, [0]);

  // Startup finishing after the drain already read its server reference.
  controller.setServer(late);

  await wait(0);

  assert.equal(late.state.closed, true, "a late listener must never be abandoned");
  assert.equal(late.state.idleClosed, true);
  assert.deepEqual(exitCodes, [0], "attaching a server must not re-exit");
});

test("attaching no server after shutdown is harmless", async () => {
  const exitCodes = [];
  const controller = createShutdownController({
    server: null,
    disconnectDatabase: async () => {},
    exit: (code) => exitCodes.push(code),
    logger: createRecordingLogger(),
    timeoutMs: 500
  });

  await controller.shutdown("SIGTERM", 0);
  controller.setServer(null);
  await wait(0);

  assert.deepEqual(exitCodes, [0]);
});

test("a successful startup attaches the listener, registers handlers, and does not exit", async () => {
  const processRef = createFakeProcessRef();
  const fakeServer = { once() {} };
  const seenIsShuttingDown = [];

  const result = await runAsMain({
    processRef,
    logger: createRecordingLogger(),
    startServerFn: async (options) => {
      seenIsShuttingDown.push(options.isShuttingDown);

      return fakeServer;
    }
  });

  assert.equal(result.server, fakeServer, "the listener must be attached to the controller");
  assert.equal(result.controller.isShuttingDown(), false);
  assert.deepEqual(processRef.exitCodes, [], "a successful startup must not exit");
  assert.equal(
    typeof seenIsShuttingDown[0],
    "function",
    "startup must be told about the shutdown state so it can re-check"
  );
  assert.equal(seenIsShuttingDown[0](), false);
  assert.equal(processRef.listenerCount("SIGTERM"), 1);
  assert.equal(processRef.listenerCount("unhandledRejection"), 1);

  result.handlers.remove();
});

test("a signal delivered during startup is not reported as a startup failure", async () => {
  const processRef = createFakeProcessRef();
  const logger = createRecordingLogger();
  const listenCalls = [];

  const result = await runAsMain({
    processRef,
    logger,
    // Real delivery through the handler `runAsMain` itself registered.
    startServerFn: async (options) => {
      await processRef.listenersFor("SIGTERM")[0]();

      if (options.isShuttingDown()) {
        return null;
      }

      listenCalls.push(true);

      return { once() {} };
    }
  });

  assert.equal(result.server, null);
  assert.deepEqual(listenCalls, [], "no listener may follow a shutdown");
  assert.deepEqual(
    processRef.exitCodes,
    [0],
    "the requested shutdown keeps its own successful outcome"
  );

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.startupFailed), false);
  assert.equal(events.includes(SHUTDOWN_EVENTS.complete), true);

  result.handlers.remove();
});

test("a startup rejection after a shutdown began does not overwrite the shutdown outcome", async () => {
  const processRef = createFakeProcessRef();
  const logger = createRecordingLogger();

  await runAsMain({
    processRef,
    logger,
    startServerFn: async () => {
      await processRef.listenersFor("SIGTERM")[0]();

      // Releasing the database mid-connection can reject the pending connect.
      throw new Error("connection closed while shutting down");
    }
  });

  assert.deepEqual(
    processRef.exitCodes,
    [0],
    "a requested graceful stop must never be rewritten as a failure"
  );

  const events = parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event);

  assert.equal(events.includes(SHUTDOWN_EVENTS.startupFailed), false);
  assert.equal(events.includes(SHUTDOWN_EVENTS.complete), true);
  assert.equal(processRef.listenerCount("SIGTERM"), 0, "handlers are still removed on failure");
});

// ---------------------------------------------------------------------------
// S4D - PART E: startup failure sanitization
// ---------------------------------------------------------------------------

test("a startup failure logs only the fixed category and exits nonzero", async () => {
  const processRef = createFakeProcessRef();
  const logger = createRecordingLogger();

  const secretUri =
    "mongodb+srv://phishguard:hunter2@cluster0.example.invalid/phishguard?retryWrites=true";
  const rawError = new Error(`failed to connect to ${secretUri}`);

  rawError.stack =
    "MongoParseError: secret\n    at Object.<anonymous> (C:\\srv\\apps\\api\\src\\config\\db.js:10:15)";

  await runAsMain({
    processRef,
    logger,
    startServerFn: async () => {
      throw rawError;
    }
  });

  assert.deepEqual(processRef.exitCodes, [1], "startup failure must terminate nonzero");

  const entries = parseLogLines(logger, "[LIFECYCLE]");

  assert.deepEqual(
    entries.map((entry) => entry.event),
    [SHUTDOWN_EVENTS.startupFailed],
    "the fixed startup category is the only thing that may be logged"
  );
  assert.deepEqual(Object.keys(entries[0]).sort(), ["event", "exitCode", "timestamp"]);

  const output = logger.all();

  for (const forbidden of [
    "hunter2",
    secretUri,
    "cluster0.example.invalid",
    "retryWrites",
    "failed to connect",
    "MongoParseError",
    "Error:",
    "at Object",
    "db.js",
    "config",
    "\\srv\\",
    rawError.message
  ]) {
    assert.equal(
      output.includes(forbidden),
      false,
      `startup output must not contain ${forbidden}`
    );
  }

  for (const event of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"]) {
    assert.equal(processRef.listenerCount(event), 0, `${event} must not survive a failed startup`);
  }
});

test("a real database connection failure prevents listening and logs nothing sensitive", async () => {
  // An invalid scheme is rejected by the driver while parsing the URI, before
  // any network activity, so this exercises the real `connectDB` path without a
  // single connection attempt.
  await withEnvironment(
    { MONGODB_URI: "not-a-valid-uri", JWT_SECRET: "a-secret-for-tests" },
    async () => {
      const processRef = createFakeProcessRef();
      const logger = createRecordingLogger();

      await runAsMain({ processRef, logger });

      assert.deepEqual(processRef.exitCodes, [1]);
      assert.deepEqual(
        parseLogLines(logger, "[LIFECYCLE]").map((entry) => entry.event),
        [SHUTDOWN_EVENTS.startupFailed]
      );

      const output = logger.all();

      for (const forbidden of [
        "Invalid scheme",
        "MongoParseError",
        "not-a-valid-uri",
        "Error:",
        "connection string"
      ]) {
        assert.equal(output.includes(forbidden), false, `must not contain ${forbidden}`);
      }

      assert.equal(
        mongoose.connection.readyState,
        0,
        "a failed connection attempt must leave no connection behind"
      );
    }
  );
});

test("startup failure removes the handlers it registered", async () => {
  const processRef = createFakeProcessRef();

  await runAsMain({
    processRef,
    logger: createRecordingLogger(),
    startServerFn: async () => {
      throw new Error("boom");
    }
  });

  assert.deepEqual(processRef.exitCodes, [1]);

  for (const event of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"]) {
    assert.equal(processRef.listenerCount(event), 0, `${event} must not leak`);
  }
});