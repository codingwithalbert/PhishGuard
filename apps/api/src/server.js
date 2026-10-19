require("dotenv").config();

const connectDB = require("./config/db");
const { createApp } = require("./app");

const PORT = process.env.PORT || 5000;

/**
 * Maximum time a graceful shutdown may spend draining before the process is
 * terminated regardless.
 *
 * PROVISIONAL. This is an application-level safety net, not a verified value.
 * It must be shorter than whatever termination allowance the hosting platform
 * actually grants, and that allowance has never been observed for this
 * deployment. If the platform allows less than this budget, the platform sends
 * SIGKILL first and the drain never finishes. Confirm against the real platform
 * before treating this number as correct.
 */
const SHUTDOWN_BUDGET_MS = 10000;

/**
 * Fixed shutdown and fatal-error categories.
 *
 * These are the ONLY event names this module ever logs. An exception message,
 * stack, request body, token, or connection string is never serialized, because
 * a startup or connection failure frequently embeds the database URI or host.
 * This mirrors the sanitized vocabulary already used by `error.middleware.js`
 * and `auth.middleware.js`.
 */
const SHUTDOWN_EVENTS = Object.freeze({
  begin: "SHUTDOWN_BEGIN",
  complete: "SHUTDOWN_COMPLETE",
  timeout: "SHUTDOWN_TIMEOUT",
  failed: "SHUTDOWN_FAILED",
  startupFailed: "STARTUP_FAILED",
  fatalRejection: "UNHANDLED_REJECTION",
  fatalException: "UNCAUGHT_EXCEPTION"
});

function serializeEvent(event, details) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details
  });
}

function writeLog(logger, event, details = {}) {
  logger.log(`[LIFECYCLE] ${serializeEvent(event, details)}`);
}

function writeErrorLog(logger, event, details = {}) {
  logger.error(`[LIFECYCLE] ${serializeEvent(event, details)}`);
}

function validateEnvironment() {
  const requiredVariables = [
    "MONGODB_URI",
    "JWT_SECRET"
  ];

  const missingVariables = requiredVariables.filter(
    (variable) => !process.env[variable]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingVariables.join(", ")}`
    );
  }
}

/**
 * Closes an `http.Server` and resolves once it has stopped listening and every
 * connection has ended.
 *
 * `closeIdleConnections` is what makes this terminate promptly: without it a
 * pooled keep-alive socket can hold the server open for its whole idle timeout.
 * Active requests are deliberately NOT cut off; they are given the remaining
 * budget to finish.
 *
 * A server that was never listening, or that has already closed, resolves
 * immediately rather than raising, so shutting down before startup completes is
 * safe.
 */
function closeHttpServer(server) {
  if (!server || server.listening === false) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    try {
      server.close(finish);

      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
    } catch (error) {
      finish(error);
    }
  });
}

function defaultDisconnectDatabase() {
  // Required lazily so that merely importing this module never touches the
  // driver. `mongoose.disconnect()` is a no-op when nothing is connected.
  return require("mongoose").disconnect();
}

/**
 * Builds a shutdown controller.
 *
 * Every collaborator is injected so the whole sequence can be exercised without
 * a real listener, a real database, or a real process exit.
 *
 * The controller is idempotent: once a shutdown has begun, later signals cannot
 * start a second cleanup sequence. That guard is deliberately narrow - it stops
 * duplicated work, not information. Exit severity and termination are tracked
 * separately, so a fatal error arriving during an in-progress drain still
 * changes the outcome instead of being swallowed by the guard.
 */
function createShutdownController({
  server = null,
  disconnectDatabase = defaultDisconnectDatabase,
  exit = (code) => process.exit(code),
  logger = console,
  timeoutMs = SHUTDOWN_BUDGET_MS
} = {}) {
  // Four independent pieces of state, deliberately not merged:
  //
  //  - `shutdownStarted` guards the CLEANUP SEQUENCE, so a second signal cannot
  //    start a second drain.
  //  - `pendingExitCode` is the SEVERITY the process must end with. It is
  //    recorded before that guard runs, because the guard must never suppress
  //    the outcome of the shutdown already in flight.
  //  - `budgetExpired` records that the deadline already forced a nonzero exit,
  //    so a later successful completion cannot replace it.
  //  - `terminationRequested` guarantees the process is asked to exit once.
  let shutdownStarted = false;
  let budgetExpired = false;
  let terminationRequested = false;
  let pendingExitCode = 0;
  let budgetTimer = null;

  function clearBudget() {
    if (budgetTimer !== null) {
      clearTimeout(budgetTimer);
      budgetTimer = null;
    }
  }

  // Only a literal 0 counts as a clean shutdown. Anything else - including a
  // missing or non-numeric code - is a failure, so a bug can never be mistaken
  // for success.
  function normalizeExitCode(code) {
    return code === 0 ? 0 : 1;
  }

  function escalateExitCode(code) {
    pendingExitCode = Math.max(pendingExitCode, normalizeExitCode(code));
  }

  function requestTermination(code) {
    if (terminationRequested) {
      return;
    }

    terminationRequested = true;

    exit(code);
  }

  async function shutdown(reason = "signal", exitCode = 0) {
    // Recorded BEFORE the started-guard. A fatal error that arrives while a
    // graceful drain is already running must still raise the outcome to
    // nonzero; otherwise the rejection is logged and the platform is then told
    // the shutdown succeeded.
    escalateExitCode(exitCode);

    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;

    writeLog(logger, SHUTDOWN_EVENTS.begin, { reason });

    // Hard deadline. If draining overruns, the process still terminates with a
    // nonzero code, so a stuck request cannot hold a deployment open forever.
    budgetTimer = setTimeout(() => {
      budgetExpired = true;

      writeErrorLog(logger, SHUTDOWN_EVENTS.timeout, { reason, exitCode: 1 });

      requestTermination(1);
    }, timeoutMs);

    if (budgetTimer && typeof budgetTimer.unref === "function") {
      budgetTimer.unref();
    }

    try {
      // Order matters. Stop accepting first, drain second, release the database
      // last: disconnecting earlier would fail in-flight requests that still
      // need the database.
      await closeHttpServer(server);
      await disconnectDatabase();

      clearBudget();

      // A deadline that already expired must never be overwritten by a later
      // success, so its nonzero outcome is preserved here.
      const finalExitCode = budgetExpired ? 1 : pendingExitCode;

      writeLog(logger, SHUTDOWN_EVENTS.complete, { reason, exitCode: finalExitCode });

      requestTermination(finalExitCode);
    } catch {
      clearBudget();

      writeErrorLog(logger, SHUTDOWN_EVENTS.failed, { reason, exitCode: 1 });

      requestTermination(1);
    }
  }

  return {
    shutdown,
    isShuttingDown: () => shutdownStarted,
    isTerminating: () => terminationRequested,
    setServer: (value) => {
      if (!value) {
        return;
      }

      if (shutdownStarted) {
        // Startup completed after a shutdown had already begun. The drain read
        // whatever server existed at that moment - possibly none - so this one
        // would otherwise stay listening with nothing left to close it. Closing
        // it here is what makes "never abandon a live listener" true, rather
        // than silently dropping the reference. The catch is attached so a late
        // failure is observed rather than surfacing as an unhandled rejection.
        closeHttpServer(value).catch(() => {});

        return;
      }

      server = value;
    }
  };
}

/**
 * Builds a fatal-error handler.
 *
 * The rejection or thrown value is accepted and discarded. Only the fixed
 * category is logged, and the controlled nonzero shutdown is then triggered, so
 * the process never keeps running in an undefined state. The controller's own
 * idempotency guard makes repeated fatal errors harmless for cleanup, and its
 * exit-severity tracking still raises the outcome to nonzero even when a
 * graceful shutdown is already draining.
 */
function createFatalErrorHandler(controller, logger, category, exitCode = 1) {
  return function handleFatalError() {
    writeErrorLog(logger, category, { exitCode });

    // The shutdown promise is returned so a caller - notably a test - can await
    // the whole controlled shutdown rather than racing it.
    return controller.shutdown(category, exitCode);
  };
}

/**
 * Handlers this module has installed on the process, so a re-registration can
 * replace exactly its own listeners and nothing else.
 *
 * `removeAllListeners` is deliberately not used: it would silently discard
 * handlers owned by other modules or by a test harness, which is a worse failure
 * than a duplicated handler.
 */
let installedHandlers = null;

function removeProcessHandlers({ processRef = process } = {}) {
  if (!installedHandlers) {
    return;
  }

  for (const [event, handler] of installedHandlers.entries()) {
    processRef.removeListener(event, handler);
  }

  installedHandlers = null;
}

/**
 * Registers the signal and fatal-error handlers exactly once.
 *
 * A second call replaces this module's own handlers rather than stacking a
 * second set, which prevents a duplicated SIGTERM listener from running every
 * shutdown side effect twice.
 */
function registerProcessHandlers({
  controller,
  logger = console,
  processRef = process
}) {
  removeProcessHandlers({ processRef });

  const handlers = new Map();

  for (const signal of ["SIGTERM", "SIGINT"]) {
    handlers.set(signal, () => controller.shutdown(signal, 0));
  }

  handlers.set(
    "unhandledRejection",
    createFatalErrorHandler(controller, logger, SHUTDOWN_EVENTS.fatalRejection)
  );

  handlers.set(
    "uncaughtException",
    createFatalErrorHandler(controller, logger, SHUTDOWN_EVENTS.fatalException)
  );

  for (const [event, handler] of handlers.entries()) {
    processRef.on(event, handler);
  }

  installedHandlers = handlers;

  return {
    remove() {
      removeProcessHandlers({ processRef });
    }
  };
}

/**
 * Starts the service.
 *
 * The order is unchanged and deliberate: environment validation, then the
 * database connection, and only then `listen()`, so the service never accepts a
 * request it cannot serve.
 *
 * The database connection is asynchronous, so a shutdown signal can arrive while
 * it is in flight. `isShuttingDown` is re-checked immediately before listening,
 * and again after the listener reports it is up, so startup cannot leave behind
 * a server that nothing will ever close.
 *
 * This function REJECTS on failure rather than exiting, so both the success and
 * failure paths are testable. Deciding what to do about a failure is the
 * caller's job. When a shutdown has begun it resolves to `null` instead of
 * rejecting: a requested stop is not a startup failure.
 */
async function startServer({
  port = PORT,
  connect = connectDB,
  buildApp = createApp,
  logger = console,
  isShuttingDown = () => false
} = {}) {
  validateEnvironment();

  const app = buildApp();

  await connect();

  // Re-checked here, immediately before listening. There is no `await` between
  // this test and the `listen()` call below, so nothing can interleave and start
  // a shutdown after the check has passed.
  if (isShuttingDown()) {
    return null;
  }

  // `app.listen()` returns the `http.Server` synchronously and emits `listening`
  // asynchronously. Waiting on the EVENT rather than on the callback argument
  // keeps this correct even if a listener implementation invokes its callback
  // synchronously, which would otherwise resolve with an undefined handle.
  const listener = app.listen(port);

  const started = await new Promise((resolve, reject) => {
    listener.once("error", reject);

    listener.once("listening", () => {
      resolve(listener);
    });
  });

  // A signal can also arrive between `listen()` and the `listening` event. The
  // listener exists at that point, but the drain has already read its server
  // reference, so it is closed here instead of being left listening.
  if (isShuttingDown()) {
    await closeHttpServer(started);

    return null;
  }

  logger.log(`PhishGuard API running on http://localhost:${port}`);

  return started;
}

/**
 * The real entry path. Runs only when this file is executed directly.
 *
 * `logger` and `startServerFn` default to the production collaborators and exist
 * so this function can be exercised offline: a startup failure cannot be induced
 * safely without either a real database connection or a seam to inject one.
 */
async function runAsMain({
  processRef = process,
  logger = console,
  startServerFn = startServer
} = {}) {
  const controller = createShutdownController({
    server: null,
    exit: (code) => processRef.exit(code),
    logger
  });

  const handlers = registerProcessHandlers({
    controller,
    logger,
    processRef
  });

  try {
    const server = await startServerFn({
      logger,
      isShuttingDown: controller.isShuttingDown
    });

    // `startServerFn` resolves to null when a shutdown began while the database
    // connection was in flight. There is then nothing to attach, and the
    // in-flight shutdown owns termination.
    if (server) {
      controller.setServer(server);
    }

    return { controller, handlers, server };
  } catch {
    handlers.remove();

    if (controller.isShuttingDown()) {
      // A shutdown is already draining and will terminate with its own outcome.
      // Exiting here would overwrite a requested graceful stop with a failure,
      // which is the same defect as a fatal error being reported as a clean
      // shutdown.
      return { controller, handlers, server: null };
    }

    // Sanitized. A startup failure commonly embeds the database URI or host in
    // its message, which must never reach the log. This replaces the previous
    // behaviour of printing `error.message` verbatim.
    writeErrorLog(logger, SHUTDOWN_EVENTS.startupFailed, { exitCode: 1 });

    processRef.exit(1);
  }
}

if (require.main === module) {
  runAsMain();
}

module.exports = {
  PORT,
  SHUTDOWN_BUDGET_MS,
  SHUTDOWN_EVENTS,
  closeHttpServer,
  createFatalErrorHandler,
  createShutdownController,
  defaultDisconnectDatabase,
  registerProcessHandlers,
  removeProcessHandlers,
  runAsMain,
  startServer,
  validateEnvironment,
  writeErrorLog,
  writeLog
};