/*
 * Focused automated coverage for the shared API transport layer.
 *
 * Conventions match the backend suite: the native `node:test` runner, no test
 * framework, no mocking library, no new dependency. Every fixture is synthetic.
 *
 * Why the transport is tested in isolation: `api.js` reads `import.meta.env`,
 * which only exists inside a Vite build, so it cannot be imported by a plain
 * Node test. `apiTransport.js` deliberately takes the base URL, the fetch
 * implementation, and the session hooks as injected arguments, which makes the
 * whole failure-handling contract reachable here without a browser.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  createJsonRequester,
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRequestCancelled,
  MAX_REQUEST_TIMEOUT_MS,
  messageForKind,
  REQUEST_ERROR_KINDS,
  REQUEST_ERROR_MESSAGES,
  requestBlob,
  requestJson,
  resolveTimeoutMs,
  safeProductError,
  sendRequest,
  toSafeErrorMessage
} from "../src/services/apiTransport.js";

const BASE_URL = "https://api.test.invalid";
const SAFE_FALLBACK = "The page could not load this. Please try again.";

/** Minimal Response stand-in. Only the members the transport reads. */
function jsonResponse(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    }
  };
}

/** A response whose body is raw, unquoted text. */
function rawResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    }
  };
}

function htmlResponse(status = 502) {
  return {
    ok: false,
    status,
    async text() {
      return "<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>";
    }
  };
}

function emptyResponse(status = 204) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return "";
    }
  };
}

function blobResponse(status, blob, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async blob() {
      return blob;
    },
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      }
    }
  };
}

function fetchReturning(response) {
  return async () => response;
}

/**
 * A response whose HEADERS arrive immediately but whose body never completes,
 * and whose reader deliberately IGNORES the abort signal.
 *
 * This is the D-1 shape: a real service that flushes headers and then stalls.
 * Because the reader ignores the signal, aborting cannot end the request — only
 * the explicit deadline race can. `release()` lets a test unstick the body so
 * the process does not leak a pending promise.
 */
function stalledBodyResponse({ status = 200, ok = true, onRead } = {}) {
  const state = { reads: 0, released: false };
  let release = null;

  state.release = () => {
    state.released = true;

    if (release) {
      release();
    }
  };

  return {
    state,
    response: {
      ok,
      status,
      async text() {
        state.reads += 1;

        if (typeof onRead === "function") {
          onRead();
        }

        // Ignores `init.signal` entirely, on purpose.
        return new Promise((resolve) => {
          release = () => resolve('{"late":true}');
        });
      },
      async blob() {
        state.reads += 1;

        return new Promise((resolve) => {
          release = () => resolve({ size: 0 });
        });
      },
      headers: {
        get() {
          return null;
        }
      }
    }
  };
}

/** Never resolves, so the deadline is the only thing that can end the request. */
function fetchNeverSettles(onCall) {
  return (url, init) =>
    new Promise((_resolve, reject) => {
      if (typeof onCall === "function") {
        onCall(url, init);
      }

      init?.signal?.addEventListener("abort", () => {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        reject(abortError);
      });
    });
}

/**
 * A faithful stand-in for real `fetch` abort semantics: it rejects with an
 * AbortError as soon as the supplied signal is aborted, including when the
 * signal was already aborted before the call.
 */
function fetchHonouringAbort(onCall) {
  return (url, init) =>
    new Promise((resolve, reject) => {
      if (typeof onCall === "function") {
        onCall(url, init);
      }

      const abort = () => {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";

        reject(abortError);
      };

      if (init?.signal?.aborted) {
        abort();

        return;
      }

      if (init?.signal) {
        init.signal.addEventListener("abort", abort, { once: true });
      }
    });
}

function fetchFailingWith(error) {
  return async () => {
    throw error;
  };
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the request to reject, but it resolved.");
}

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

test("a valid JSON success response resolves with the parsed body", async () => {
  const body = await requestJson({
    baseUrl: BASE_URL,
    path: "/api/training/progress",
    fetchImpl: fetchReturning(jsonResponse(200, { success: true, exposure: 100 }))
  });

  assert.deepEqual(body, { success: true, exposure: 100 });
});

test("a JSON success response is returned unchanged through the shared requester", async () => {
  const seen = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });

      return jsonResponse(200, { success: true });
    }
  });

  const body = await request("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://example.test" })
  });

  assert.deepEqual(body, { success: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${BASE_URL}/api/analyze`);
  assert.equal(seen[0].init.method, "POST");
});

test("a caller-supplied content type is preserved and merged with the auth header", async () => {
  let capturedHeaders = null;

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: async (_url, init) => {
      capturedHeaders = init.headers;

      return jsonResponse(200, { success: true });
    },
    getAuthToken: () => "test-token",
    buildAuthHeaders: (token) => ({ Authorization: `Bearer ${token}` })
  });

  await request("/api/reports", {
    requiresAuth: true,
    headers: { Accept: "text/csv" }
  });

  assert.equal(capturedHeaders["Content-Type"], "application/json");
  assert.equal(capturedHeaders.Accept, "text/csv");
  assert.equal(capturedHeaders.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// Recognized HTTP errors
// ---------------------------------------------------------------------------

test("a recognized 4xx validation error keeps its safe server message and status", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(
        jsonResponse(400, { success: false, error: "URL must use HTTP or HTTPS" })
      )
    })
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.kind, REQUEST_ERROR_KINDS.http);
  assert.equal(error.status, 400);
  assert.equal(error.message, "URL must use HTTP or HTTPS");
});

test("a 409 duplicate conflict is surfaced with its real status so page branching still works", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/reports",
      fetchImpl: fetchReturning(
        jsonResponse(409, { success: false, error: "A report already exists" })
      )
    })
  );

  assert.equal(error.status, 409);
  assert.equal(error.message, "A report already exists");
});

test("a 5xx refusal never surfaces the server body, only fixed copy", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/dashboard/summary",
      fetchImpl: fetchReturning(
        jsonResponse(500, { success: false, error: "Internal server error" })
      )
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.http);
  assert.equal(error.status, 500);
  assert.equal(error.message, REQUEST_ERROR_MESSAGES.http);
});

test("a 4xx with an empty body falls back to fixed copy and keeps the status", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/auth/login",
      fetchImpl: fetchReturning({ ok: false, status: 401, async text() { return ""; } })
    })
  );

  assert.equal(error.status, 401);
  assert.equal(error.message, REQUEST_ERROR_MESSAGES.http);
});

test("a 4xx whose JSON carries no error field falls back to fixed copy", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/auth/login",
      fetchImpl: fetchReturning(jsonResponse(400, { success: false }))
    })
  );

  assert.equal(error.status, 400);
  assert.equal(error.message, REQUEST_ERROR_MESSAGES.http);
});

// ---------------------------------------------------------------------------
// HTML, empty, and malformed bodies
// ---------------------------------------------------------------------------

test("an HTML error page never leaks its markup to the caller", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(htmlResponse(502))
    })
  );

  assert.equal(error.message, REQUEST_ERROR_MESSAGES.http);
  assert.doesNotMatch(error.message, /DOCTYPE|Bad Gateway|</);
});

test("an HTML body on a 200 is reported as an unexpected response, never a parser error", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/dashboard/summary",
      fetchImpl: fetchReturning({
        ok: true,
        status: 200,
        async text() {
          return "<!DOCTYPE html><html><body>SPA fallback</body></html>";
        }
      })
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.unexpectedResponse);
  assert.equal(error.status, null);
  assert.equal(error.message, messageForKind(REQUEST_ERROR_KINDS.unexpectedResponse));
  assert.doesNotMatch(error.message, /JSON|token|DOCTYPE/);
});

test("an empty success body is reported as an unexpected response", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(emptyResponse(200))
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.unexpectedResponse);
  assert.equal(error.status, null);
});

test("truncated JSON is reported as an unexpected response with no parser detail", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/progress",
      fetchImpl: fetchReturning(jsonResponse(200, '{"success":true,"trunc'))
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.unexpectedResponse);
  assert.doesNotMatch(error.message, /JSON|position|Unexpected/);
});

test("a valid JSON scalar body is parsed rather than treated as malformed", async () => {
  const body = await requestJson({
    baseUrl: BASE_URL,
    path: "/api/health",
    fetchImpl: fetchReturning(rawResponse(200, '"ok"'))
  });

  assert.equal(body, "ok");
});

test("a bare unquoted word is not valid JSON and is reported as unexpected", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/health",
      fetchImpl: fetchReturning(rawResponse(200, "ok"))
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.unexpectedResponse);
});

// ---------------------------------------------------------------------------
// Network failures
// ---------------------------------------------------------------------------

test("a browser network failure is normalized and its TypeError never escapes", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/auth/login",
      fetchImpl: fetchFailingWith(new TypeError("Failed to fetch"))
    })
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.kind, REQUEST_ERROR_KINDS.network);
  assert.equal(error.status, null);
  assert.equal(error.message, messageForKind(REQUEST_ERROR_KINDS.network));
  assert.doesNotMatch(error.message, /Failed to fetch/);
});

test("a missing fetch implementation fails closed as a network error", async () => {
  const error = await captureRejection(
    requestJson({ baseUrl: BASE_URL, path: "/api/health", fetchImpl: null })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.network);
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test("a stalled request is aborted at the deadline and reported as a timeout", async () => {
  const started = Date.now();

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/research/analytics",
      fetchImpl: fetchNeverSettles(),
      timeoutMs: 60
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(error.status, null);
  assert.equal(error.message, messageForKind(REQUEST_ERROR_KINDS.timeout));
  assert.ok(Date.now() - started < 5000, "the deadline must end the request");
});

test("the deadline policy cannot be disabled or made unbounded", () => {
  // A non-positive or non-finite value must not remove the deadline, so a
  // caller cannot accidentally opt out of the timeout.
  assert.equal(resolveTimeoutMs(0), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(-1), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(Number.NaN), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(undefined), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(null), DEFAULT_REQUEST_TIMEOUT_MS);

  // An oversized value is capped, so a request can never hang indefinitely.
  assert.equal(resolveTimeoutMs(MAX_REQUEST_TIMEOUT_MS + 600000), MAX_REQUEST_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(Number.POSITIVE_INFINITY), DEFAULT_REQUEST_TIMEOUT_MS);

  // A normal value is honoured unchanged.
  assert.equal(resolveTimeoutMs(250), 250);
  assert.equal(resolveTimeoutMs(DEFAULT_REQUEST_TIMEOUT_MS), DEFAULT_REQUEST_TIMEOUT_MS);
});

test("a request that supplies no deadline still gets the default applied", async () => {
  let capturedSignal = null;

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: (url, init) => {
        capturedSignal = init.signal;

        return fetchHonouringAbort()(url, init);
      },
      timeoutMs: 40
    })
  );

  assert.ok(capturedSignal, "a composed signal must always be supplied");
  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
});

// ---------------------------------------------------------------------------
// Caller cancellation (Research Analytics stale-response supersession)
// ---------------------------------------------------------------------------

test("caller cancellation is classified as cancelled, never as a failure", async () => {
  const controller = new AbortController();
  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchNeverSettles()
  });

  const pending = request("/api/research/analytics", {
    signal: controller.signal,
    timeoutMs: 5000
  });

  setTimeout(() => controller.abort(), 20);

  const error = await captureRejection(pending);

  assert.equal(error.kind, REQUEST_ERROR_KINDS.cancelled);
  assert.equal(error.name, "AbortError", "existing caller-side abort checks keep working");
  assert.equal(error.status, null);
});

test("a stale superseded request cannot overwrite a newer selection with an error", async () => {
  // Mirrors the Research Analytics pattern: request 2 supersedes request 1, and
  // only the newest request id may act on its outcome. The superseded request
  // must settle as a deliberate cancellation, never as a reportable failure.
  let latestRequestId = 0;
  const controllers = [];
  const outcomes = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchHonouringAbort()
  });

  const loadAnalytics = async () => {
    const requestId = (latestRequestId += 1);
    const controller = new AbortController();

    if (requestId > 1) {
      controllers[requestId - 2].abort();
    }

    controllers[requestId - 1] = controller;

    try {
      await request("/api/research/analytics", {
        signal: controller.signal,
        timeoutMs: 800
      });

      outcomes.push({ requestId, applied: true, kind: null });

      return;
    } catch (error) {
      const isStale = latestRequestId !== requestId;
      const isDeliberateCancellation = error?.name === "AbortError";

      // This is exactly the guard ResearchAnalytics.jsx applies before it
      // decides whether to surface an error.
      const applied = !isStale && !isDeliberateCancellation;

      outcomes.push({
        requestId,
        applied,
        kind: error?.kind,
        isStale,
        isDeliberateCancellation
      });
    }
  };

  // Request 1 must NOT be awaited before request 2 supersedes it, otherwise it
  // would reach its own deadline first and be classified as a timeout.
  const supersededRequest = loadAnalytics();

  await new Promise((resolve) => setTimeout(resolve, 15));

  const currentRequest = loadAnalytics();

  await Promise.all([supersededRequest, currentRequest]);

  const superseded = outcomes.find((entry) => entry.requestId === 1);

  assert.ok(superseded, "the superseded request must have settled");
  assert.equal(superseded.kind, REQUEST_ERROR_KINDS.cancelled);
  assert.equal(superseded.isStale, true);
  assert.equal(
    superseded.applied,
    false,
    "a superseded request must never be applied or shown as an error"
  );
  assert.equal(
    outcomes.filter((entry) => entry.requestId === 1).length,
    1,
    "the superseded request must settle exactly once"
  );
});

test("an already-aborted caller signal short-circuits without reaching the network", async () => {
  let reached = false;

  const controller = new AbortController();
  controller.abort();

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchHonouringAbort(() => {
        reached = true;
      }),
      signal: controller.signal
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.cancelled);
  assert.equal(error.name, "AbortError");
  assert.equal(reached, true, "fetch is invoked, but the composed signal is already aborted");
});

// ---------------------------------------------------------------------------
// Session expiration
// ---------------------------------------------------------------------------

test("a 403 invalid-token rejection triggers session invalidation exactly once", async () => {
  const invalidations = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchReturning(
      jsonResponse(403, { success: false, error: "Invalid or expired token" })
    ),
    getAuthToken: () => "stored-token",
    buildAuthHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
    isInvalidSessionError: (error) =>
      error.status === 403 && error.message === "Invalid or expired token",
    onInvalidSession: (token) => invalidations.push(token)
  });

  const error = await captureRejection(
    request("/api/dashboard/summary", { requiresAuth: true })
  );

  assert.equal(error.status, 403);
  assert.equal(error.message, "Invalid or expired token");
  assert.deepEqual(invalidations, ["stored-token"]);
});

test("a 401 missing-credentials rejection triggers session invalidation", async () => {
  const invalidations = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchReturning(
      jsonResponse(401, { success: false, error: "Authentication required" })
    ),
    getAuthToken: () => null,
    buildAuthHeaders: () => ({}),
    isInvalidSessionError: (error) =>
      error.status === 401 && error.message === "Authentication required",
    onInvalidSession: (token) => invalidations.push(token)
  });

  await captureRejection(request("/api/progress", { requiresAuth: true }));

  assert.deepEqual(invalidations, [null]);
});

test("a timeout never triggers session invalidation", async () => {
  const invalidations = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchNeverSettles(),
    getAuthToken: () => "stored-token",
    buildAuthHeaders: () => ({}),
    isInvalidSessionError: (error) => error.status === 403,
    onInvalidSession: () => invalidations.push("unexpected")
  });

  await captureRejection(
    request("/api/dashboard/summary", { requiresAuth: true, timeoutMs: 40 })
  );

  assert.deepEqual(invalidations, [], "a timeout must not be treated as an expired session");
});

test("an unrelated 4xx never triggers session invalidation", async () => {
  const invalidations = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchReturning(
      jsonResponse(400, { success: false, error: "URL must use HTTP or HTTPS" })
    ),
    getAuthToken: () => "stored-token",
    buildAuthHeaders: () => ({}),
    isInvalidSessionError: (error) => error.status === 403,
    onInvalidSession: () => invalidations.push("unexpected")
  });

  await captureRejection(
    request("/api/analyze", { requiresAuth: true, method: "POST", body: "{}" })
  );

  assert.deepEqual(invalidations, []);
});

test("a public request never triggers session invalidation", async () => {
  const invalidations = [];

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: fetchReturning(
      jsonResponse(403, { success: false, error: "Invalid or expired token" })
    ),
    getAuthToken: () => "stored-token",
    buildAuthHeaders: () => ({}),
    isInvalidSessionError: () => true,
    onInvalidSession: () => invalidations.push("unexpected")
  });

  await captureRejection(request("/api/auth/login", { method: "POST", body: "{}" }));

  assert.deepEqual(invalidations, []);
});

// ---------------------------------------------------------------------------
// sendRequest (blob / CSV path) and no-retry guarantee
// ---------------------------------------------------------------------------

test("sendRequest returns a successful blob response without parsing it", async () => {
  const csv = "participantId,awarenessScore\nPG-R0001,80\n";
  const blob = { size: csv.length, type: "text/csv" };

  const response = await sendRequest({
    baseUrl: BASE_URL,
    path: "/api/research/export.csv",
    fetchImpl: fetchReturning(
      blobResponse(200, blob, {
        "content-disposition": 'attachment; filename="research.csv"'
      })
    ),
    headers: { Accept: "text/csv" }
  });

  assert.equal(await response.blob(), blob);
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="research.csv"'
  );
});

test("sendRequest applies the same timeout policy to the blob path", async () => {
  const error = await captureRejection(
    sendRequest({
      baseUrl: BASE_URL,
      path: "/api/research/export.csv",
      fetchImpl: fetchNeverSettles(),
      timeoutMs: 50
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
});

test("a non-idempotent request is never retried automatically", async () => {
  let attempts = 0;

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: async () => {
      attempts += 1;

      throw new TypeError("Failed to fetch");
    }
  });

  await captureRejection(
    request("/api/reports", { requiresAuth: true, method: "POST", body: "{}" })
  );

  assert.equal(attempts, 1, "a report submission must be attempted exactly once");
});

test("a timed-out submission is also attempted exactly once", async () => {
  let attempts = 0;

  const request = createJsonRequester({
    baseUrl: BASE_URL,
    fetchImpl: (url, init) => {
      attempts += 1;

      return fetchNeverSettles()(url, init);
    }
  });

  const error = await captureRejection(
    request("/api/awareness/submit", {
      requiresAuth: true,
      method: "POST",
      body: "{}",
      timeoutMs: 40
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(attempts, 1);
});

test("every transport kind carries its own fixed message and a null status", () => {
  const kinds = [
    REQUEST_ERROR_KINDS.timeout,
    REQUEST_ERROR_KINDS.cancelled,
    REQUEST_ERROR_KINDS.network,
    REQUEST_ERROR_KINDS.unexpectedResponse
  ];

  for (const kind of kinds) {
    const error = new ApiError(messageForKind(kind), { kind });

    assert.equal(error.kind, kind);
    assert.equal(error.status, null);
    assert.equal(typeof error.message, "string");
    assert.ok(error.message.length > 0, `${kind} must have a message`);
  }
});

test("every kind value resolves to a message, and unknown kinds fall back safely", () => {
  for (const kind of Object.values(REQUEST_ERROR_KINDS)) {
    assert.equal(
      messageForKind(kind),
      REQUEST_ERROR_MESSAGES[kind],
      `kind ${kind} must have its own message`
    );
  }

  assert.equal(messageForKind("something-unknown"), REQUEST_ERROR_MESSAGES.http);
});

// ---------------------------------------------------------------------------
// toSafeErrorMessage — the single choke point for user-visible error text
// ---------------------------------------------------------------------------

test("a normalized transport error renders its safe message", () => {
  const timeout = new ApiError(messageForKind(REQUEST_ERROR_KINDS.timeout), {
    kind: REQUEST_ERROR_KINDS.timeout
  });

  assert.equal(toSafeErrorMessage(timeout, SAFE_FALLBACK), messageForKind(REQUEST_ERROR_KINDS.timeout));
});

test("a recognized 4xx renders the server's safe validation message", () => {
  const error = new ApiError("URL must use HTTP or HTTPS", {
    status: 400,
    kind: REQUEST_ERROR_KINDS.http
  });

  assert.equal(toSafeErrorMessage(error, SAFE_FALLBACK), "URL must use HTTP or HTTPS");
});

test("a raw JSON parser error can never reach the interface", () => {
  // This is the exact message a browser produces for an HTML body, and the
  // exact defect class C-1 described.
  const parserError = new SyntaxError(
    'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'
  );

  assert.equal(toSafeErrorMessage(parserError, SAFE_FALLBACK), SAFE_FALLBACK);
});

test("a raw browser network error can never reach the interface", () => {
  const networkError = new TypeError("Failed to fetch");

  assert.equal(toSafeErrorMessage(networkError, SAFE_FALLBACK), SAFE_FALLBACK);
});

test("a 5xx carrying an internal message is not surfaced to the user", () => {
  const serverError = { status: 500, message: "MongoServerError: index build failed" };

  assert.equal(toSafeErrorMessage(serverError, SAFE_FALLBACK), SAFE_FALLBACK);
});

test("unrecognized thrown values all fall back", () => {
  assert.equal(toSafeErrorMessage(undefined, SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage(null, SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage("a string", SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage({}, SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage(new Error("anything"), SAFE_FALLBACK), SAFE_FALLBACK);
});

test("the pre-existing 4xx contract is preserved for un-normalized errors", () => {
  // Research Analytics raises its own response-format error with a real status,
  // and pages still branch on it.
  const formatError = new Error("The response could not be read in the expected format.");
  formatError.status = 500;

  assert.equal(toSafeErrorMessage(formatError, SAFE_FALLBACK), SAFE_FALLBACK);

  const validationError = new Error("Analysis not found");
  validationError.status = 404;

  assert.equal(toSafeErrorMessage(validationError, SAFE_FALLBACK), "Analysis not found");
});

test("isRequestCancelled identifies only a deliberate cancellation", () => {
  assert.equal(
    isRequestCancelled(new ApiError("x", { kind: REQUEST_ERROR_KINDS.cancelled })),
    true
  );
  assert.equal(
    isRequestCancelled(new ApiError("x", { kind: REQUEST_ERROR_KINDS.timeout })),
    false
  );
  assert.equal(isRequestCancelled(new Error("Failed to fetch")), false);
  assert.equal(isRequestCancelled(undefined), false);
});

// ---------------------------------------------------------------------------
// D-1 / D-1b: the deadline must span the WHOLE lifecycle, not just dispatch
// ---------------------------------------------------------------------------

test("headers arriving but a JSON body that stalls still settles at the deadline", async () => {
  const { response, state } = stalledBodyResponse();

  const started = Date.now();

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/dashboard/summary",
      fetchImpl: fetchReturning(response),
      timeoutMs: 120
    })
  );

  const elapsed = Date.now() - started;

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(error.status, null);
  assert.equal(error.message, messageForKind(REQUEST_ERROR_KINDS.timeout));
  assert.equal(state.reads, 1, "the body reader must actually have been entered");
  assert.ok(elapsed < 1500, `must settle on the deadline, took ${elapsed}ms`);

  state.release();
});

test("the deadline applies even when the body reader ignores the abort signal", async () => {
  const { response } = stalledBodyResponse();

  let signalAborted = false;

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/progress",
      fetchImpl: async (url, init) => {
        init.signal.addEventListener("abort", () => {
          signalAborted = true;
        });

        return response;
      },
      timeoutMs: 120
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(signalAborted, true, "the composed signal must still be aborted");
});

test("headers arriving but an HTTP error body that stalls settles at the deadline", async () => {
  const { response, state } = stalledBodyResponse({ status: 500, ok: false });

  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(response),
      timeoutMs: 120
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(state.reads, 1, "the error-body reader must actually have been entered");

  state.release();
});

test("caller cancellation after headers is honoured, not ignored", async () => {
  const { response, state } = stalledBodyResponse();
  const controller = new AbortController();

  const pending = requestJson({
    baseUrl: BASE_URL,
    path: "/api/research/analytics",
    fetchImpl: fetchReturning(response),
    signal: controller.signal,
    timeoutMs: 5000
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  controller.abort();

  const error = await captureRejection(pending);

  assert.equal(error.kind, REQUEST_ERROR_KINDS.cancelled);
  assert.equal(error.name, "AbortError");
  assert.equal(error.status, null);

  state.release();
});

test("a caller cancellation after headers beats a later deadline", async () => {
  const { response, state } = stalledBodyResponse();
  const controller = new AbortController();

  const started = Date.now();

  const pending = requestJson({
    baseUrl: BASE_URL,
    path: "/api/analyze",
    fetchImpl: fetchReturning(response),
    signal: controller.signal,
    timeoutMs: 800
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();

  const error = await captureRejection(pending);

  assert.equal(error.kind, REQUEST_ERROR_KINDS.cancelled);
  assert.ok(
    Date.now() - started < 500,
    "cancellation must settle immediately, not at the deadline"
  );

  state.release();
});

test("a deadline reached before any cancellation is reported as a timeout", async () => {
  const { response, state } = stalledBodyResponse();
  const controller = new AbortController();

  // The handler is attached immediately: the deadline is only 80 ms, so the
  // request must already be settled by the time the cancellation is issued.
  const settled = requestJson({
    baseUrl: BASE_URL,
    path: "/api/analyze",
    fetchImpl: fetchReturning(response),
    signal: controller.signal,
    timeoutMs: 80
  }).then(
    (value) => ({ rejected: false, value }),
    (error) => ({ rejected: true, error })
  );

  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();

  const outcome = await settled;

  assert.equal(outcome.rejected, true);
  assert.equal(outcome.error.kind, REQUEST_ERROR_KINDS.timeout);

  state.release();
});

test("a CSV blob body that stalls settles at the deadline", async () => {
  const { response, state } = stalledBodyResponse();

  const error = await captureRejection(
    requestBlob({
      baseUrl: BASE_URL,
      path: "/api/research/export.csv",
      fetchImpl: fetchReturning(response),
      timeoutMs: 120
    })
  );

  assert.equal(error.kind, REQUEST_ERROR_KINDS.timeout);
  assert.equal(state.reads, 1, "the blob reader must actually have been entered");

  state.release();
});

test("a CSV blob that completes still returns the blob and its headers", async () => {
  const blob = { size: 42, type: "text/csv" };

  const result = await requestBlob({
    baseUrl: BASE_URL,
    path: "/api/research/export.csv",
    fetchImpl: fetchReturning(
      blobResponse(200, blob, {
        "content-disposition": 'attachment; filename="research.csv"'
      })
    )
  });

  assert.equal(result.blob, blob);
  assert.equal(
    result.headers.get("content-disposition"),
    'attachment; filename="research.csv"'
  );
});

// ---------------------------------------------------------------------------
// D-2: product-authored safe messages, and what must stay suppressed
// ---------------------------------------------------------------------------

test("a product-authored response-format message survives to the interface", () => {
  const formatError = safeProductError(
    "The progress data could not be read in the expected format.",
    500
  );

  assert.equal(formatError.status, 500);
  assert.equal(
    toSafeErrorMessage(formatError, SAFE_FALLBACK),
    "The progress data could not be read in the expected format."
  );
});

test("safeProductError rejects anything that is not a non-empty string", () => {
  assert.throws(() => safeProductError(""), TypeError);
  assert.throws(() => safeProductError("   "), TypeError);
  assert.throws(() => safeProductError(null), TypeError);
  assert.throws(() => safeProductError(undefined), TypeError);
  assert.throws(() => safeProductError(123), TypeError);
  assert.throws(() => safeProductError({ message: "x" }), TypeError);
});

test("a product-authored error without a status is still surfaced", () => {
  const error = safeProductError("The assessment result could not be read.");

  assert.equal(error.status, null);
  assert.equal(
    toSafeErrorMessage(error, SAFE_FALLBACK),
    "The assessment result could not be read."
  );
});

test("a plain Error carrying a 500 status stays suppressed", () => {
  // The pre-S1B behaviour: these page-authored errors had no sanctioned way to
  // opt in, which is exactly why safeProductError was introduced.
  const legacy = new Error(
    "The progress data could not be read in the expected format."
  );
  legacy.status = 500;

  assert.equal(toSafeErrorMessage(legacy, SAFE_FALLBACK), SAFE_FALLBACK);
});

test("raw 5xx, parser, and network messages remain suppressed", () => {
  const serverDetail = new Error("MongoServerError: index build failed");
  serverDetail.status = 500;

  const parserDetail = new SyntaxError(
    'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'
  );

  const networkDetail = new TypeError("Failed to fetch");

  assert.equal(toSafeErrorMessage(serverDetail, SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage(parserDetail, SAFE_FALLBACK), SAFE_FALLBACK);
  assert.equal(toSafeErrorMessage(networkDetail, SAFE_FALLBACK), SAFE_FALLBACK);
});

test("a transport 5xx still hides the body after the page changes", async () => {
  const error = await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/progress",
      fetchImpl: fetchReturning(
        jsonResponse(500, {
          success: false,
          error: "MongoServerError: shard unreachable"
        })
      )
    })
  );

  assert.equal(error.status, 500);
  assert.equal(error.message, messageForKind(REQUEST_ERROR_KINDS.http));
  assert.doesNotMatch(error.message, /Mongo|shard/);
});

// ---------------------------------------------------------------------------
// Cleanup: timers and abort listeners must not leak
// ---------------------------------------------------------------------------

function activeTimers() {
  // `globalThis.process` rather than a bare `process`, because the ESLint config
  // for this package targets browser globals only.
  const nodeProcess = globalThis.process;

  if (!nodeProcess?.getActiveResourcesInfo) {
    return null;
  }

  return nodeProcess.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
}

test("no timeout timer survives a settled request", async (t) => {
  const before = activeTimers();

  if (before === null) {
    t.skip("runtime does not expose getActiveResourcesInfo");

    return;
  }

  for (let i = 0; i < 25; i++) {
    await requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(jsonResponse(200, { success: true })),
      timeoutMs: 30000
    });
  }

  assert.equal(activeTimers(), before, "settled requests must clear their deadline timer");
});

test("the caller's abort listener is removed after success and after failure", async () => {
  const cases = [
    {
      name: "success",
      fetchImpl: fetchReturning(jsonResponse(200, { success: true }))
    },
    {
      name: "http failure",
      fetchImpl: fetchReturning(jsonResponse(400, { success: false, error: "bad" }))
    },
    {
      name: "network failure",
      fetchImpl: fetchFailingWith(new TypeError("Failed to fetch"))
    }
  ];

  for (const testCase of cases) {
    const controller = new AbortController();
    const signal = controller.signal;

    let added = 0;
    let removed = 0;

    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);

    signal.addEventListener = (...args) => {
      added += 1;

      return originalAdd(...args);
    };
    signal.removeEventListener = (...args) => {
      removed += 1;

      return originalRemove(...args);
    };

    // The success case resolves, the failure cases reject; cleanup must happen
    // on every one of them, so the outcome itself is not asserted here.
    await requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: testCase.fetchImpl,
      signal,
      timeoutMs: 5000
    }).catch(() => {});

    assert.equal(added, 1, `${testCase.name}: the listener must be attached`);
    assert.equal(removed, 1, `${testCase.name}: the listener must be detached`);
  }
});

test("the caller's abort listener is removed after a cancellation", async () => {
  const { response, state } = stalledBodyResponse();
  const controller = new AbortController();
  const signal = controller.signal;

  let added = 0;
  let removed = 0;

  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);

  signal.addEventListener = (...args) => {
    added += 1;

    return originalAdd(...args);
  };
  signal.removeEventListener = (...args) => {
    removed += 1;

    return originalRemove(...args);
  };

  const pending = requestJson({
    baseUrl: BASE_URL,
    path: "/api/analyze",
    fetchImpl: fetchReturning(response),
    signal,
    timeoutMs: 5000
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();

  await captureRejection(pending);

  assert.equal(added, 1);
  assert.equal(removed, 1);

  state.release();
});

test("no timer survives a timed-out request whose body reader ignores the signal", async (t) => {
  const { response, state } = stalledBodyResponse();

  const before = activeTimers();

  if (before === null) {
    state.release();
    t.skip("runtime does not expose getActiveResourcesInfo");

    return;
  }

  await captureRejection(
    requestJson({
      baseUrl: BASE_URL,
      path: "/api/analyze",
      fetchImpl: fetchReturning(response),
      timeoutMs: 60
    })
  );

  assert.equal(activeTimers(), before, "a timed-out request must still clear its timer");

  state.release();
});