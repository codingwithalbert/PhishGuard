/*
 * PhishGuard API transport layer.
 *
 * This module owns every transport-level failure mode so that no browser
 * message, JSON parser message, or infrastructure response body can ever reach
 * a user-visible error state. It is deliberately free of Vite, DOM, and session
 * dependencies: the base URL, the fetch implementation, and the session hooks
 * are all injected, which is what makes it directly testable under `node:test`
 * and keeps `api.js` a thin catalogue of endpoints.
 *
 * Failure taxonomy. Exactly four transport outcomes exist, and each is
 * reported with its own `kind` so a caller can distinguish them:
 *
 *   "timeout"            the deadline elapsed before the response arrived
 *   "cancelled"          the CALLER aborted deliberately (superseded request)
 *   "network"            the request never reached a response
 *   "unexpected_response" a response arrived but its body was not usable JSON
 *
 * An HTTP error response (4xx/5xx) is not a transport failure: it is a
 * successful exchange carrying a refusal, so it carries the real numeric
 * `status` and, for a recognized 4xx, the server's own safe validation text.
 *
 * `status` is deliberately left `null` for every non-HTTP kind. Pages branch on
 * `status === 404` and on session-error detection, so a timeout or a network
 * failure must never be mistaken for an application-level refusal.
 *
 * No request is ever retried automatically. A POST that timed out may already
 * have been committed server-side, so a silent retry could duplicate a report,
 * an assessment attempt, or an analysis.
 */

/**
 * Default deadline for a single request.
 *
 * Long enough that a cold start on a free-tier instance and a slow research
 * aggregation both complete normally; short enough that a black-holed
 * connection resolves into a visible, retryable state instead of an
 * indefinite spinner.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

/** Timeout ceiling, so a caller cannot disable the deadline by opting out. */
export const MAX_REQUEST_TIMEOUT_MS = 60000;

/**
 * Every message below is fixed product copy. None is derived from a thrown
 * value, a response body, or a header, so none can carry internal detail.
 *
 * Keys are the `REQUEST_ERROR_KINDS` values, so a message can always be
 * resolved from the kind alone via `messageForKind`.
 */
export const REQUEST_ERROR_KINDS = Object.freeze({
  timeout: "timeout",
  cancelled: "cancelled",
  network: "network",
  unexpectedResponse: "unexpected_response",
  http: "http"
});

export const REQUEST_ERROR_MESSAGES = Object.freeze({
  timeout: "The service did not respond in time. Check your connection and try again.",
  network: "The service could not be reached. Check your connection and try again.",
  cancelled: "The request was cancelled.",
  unexpected_response:
    "The service returned an unexpected response. Please try again.",
  http: "The request could not be completed. Please try again."
});

/** Resolves the fixed message for a kind, falling back to the generic copy. */
export function messageForKind(kind) {
  return REQUEST_ERROR_MESSAGES[kind] ?? REQUEST_ERROR_MESSAGES.http;
}

/**
 * True when a failure was caused by the caller deliberately superseding the
 * request, rather than by the service.
 *
 * A superseded request is not an error to report: Research Analytics aborts the
 * previous filter request whenever the selection changes, so this is what
 * separates an expected cancellation from a genuine failure.
 */
export function isRequestCancelled(error) {
  return error?.kind === REQUEST_ERROR_KINDS.cancelled;
}

/**
 * A normalized transport or HTTP failure.
 *
 * `message` is always safe to render. `status` is numeric only when a real
 * HTTP error response was received. `kind` is one of REQUEST_ERROR_KINDS.
 */
export class ApiError extends Error {
  constructor(message, { status = null, kind = REQUEST_ERROR_KINDS.http, name } = {}) {
    super(message);
    this.name = name || "ApiError";
    this.status = status;
    this.kind = kind;
  }
}

/**
 * Creates an error whose message is literal product copy.
 *
 * This is the ONLY sanctioned way for a page to opt its own message into the
 * user-visible surface. It exists because a page that rejects a response whose
 * shape it does not recognise has already authored a safe, specific message —
 * "The progress data could not be read in the expected format" — and the
 * conservative 4xx rule in `toSafeErrorMessage` would otherwise discard it in
 * favour of a generic fallback.
 *
 * SCOPE AND SAFETY RULES, enforced by review rather than by the type system,
 * so every caller must observe them:
 *
 *   1. The argument MUST be a string literal written in source. Never pass
 *      server data, a response field, a caught message, an interpolated value
 *      derived from a request, or anything else outside the codebase. A server
 *      response, a parser message, a network error, and an infrastructure
 *      string can never legitimately reach this call.
 *   2. It must not be used to wrap or re-describe an error that came from the
 *      transport. Transport failures already carry safe fixed copy.
 *
 * It grants no new capability to any untrusted input: it is a constructor for
 * product-authored text, not an "is safe" flag attachable to an arbitrary value.
 */
export function safeProductError(message, status = null) {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("safeProductError requires a non-empty string literal");
  }

  return new ApiError(message, {
    status,
    kind: REQUEST_ERROR_KINDS.http
  });
}

/**
 * Resolves the effective deadline for a request.
 *
 * Exported so the clamping policy can be asserted directly instead of by
 * waiting out a real deadline in a test.
 *
 * A non-positive or non-finite value falls back to the default rather than
 * disabling the deadline, so a caller cannot accidentally opt out of the
 * timeout. An oversized value is capped so a request can never hang
 * indefinitely.
 */
export function resolveTimeoutMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.min(timeoutMs, MAX_REQUEST_TIMEOUT_MS);
}

function isAbortLike(error) {
  return error?.name === "AbortError";
}

/**
 * Resolves the one message that is safe to show a user.
 *
 * This is the single choke point for user-visible error text. A normalized
 * `ApiError` is safe by construction: its message is either a fixed transport
 * string or the API's own already-sanitized 4xx validation text, so it is
 * returned as-is. The numeric 4xx branch preserves the previous contract for
 * any error that reached a caller without normalization.
 *
 * Anything else — a browser network TypeError, a thrown JSON parser error, an
 * arbitrary thrown value — yields the caller's fallback, so no internal detail
 * and no browser-generated string can reach the interface.
 */
export function toSafeErrorMessage(error, fallback) {
  if (error instanceof ApiError) {
    return typeof error.message === "string" && error.message.length > 0
      ? error.message
      : fallback;
  }

  if (
    error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function timeoutError() {
  return new ApiError(messageForKind(REQUEST_ERROR_KINDS.timeout), {
    kind: REQUEST_ERROR_KINDS.timeout
  });
}

function cancelledError() {
  // A superseded request is deliberately not a failure, so it carries no
  // `status` and is ignored by every error branch. `name` stays "AbortError"
  // so existing caller-side checks keep recognising it unchanged.
  return new ApiError(messageForKind(REQUEST_ERROR_KINDS.cancelled), {
    kind: REQUEST_ERROR_KINDS.cancelled,
    name: "AbortError"
  });
}

function networkError() {
  return new ApiError(messageForKind(REQUEST_ERROR_KINDS.network), {
    kind: REQUEST_ERROR_KINDS.network
  });
}

/**
 * Builds the deadline that is active for the WHOLE request lifecycle, from
 * dispatch through complete body consumption.
 *
 * Aborting `fetch` is not sufficient on its own: a body reader may ignore the
 * signal entirely, so the composed signal alone cannot be relied on to end a
 * request. The guard therefore publishes a `settled` promise that rejects as
 * soon as the deadline elapses or the caller cancels, and every lifecycle step
 * races against it. `settledBy` records which cause fired FIRST, so a timeout
 * and a caller cancellation arriving together are reported deterministically
 * rather than by whichever check happens to run first.
 *
 * The caller's signal is never mutated. Its listener is detached in `cleanup`.
 */
function createLifecycleGuard({ signal = null, timeoutMs }) {
  const controller = new AbortController();
  let settledBy = null;

  let settle = null;

  const settled = new Promise((_resolve, reject) => {
    settle = reject;
  });

  // The guard promise is always raced, but attach a handler so that a guard
  // which fires after a step already resolved cannot become an unhandled
  // rejection.
  settled.catch(() => {});

  const abortFromCaller = () => {
    if (settledBy === null) {
      settledBy = "caller";
      settle(cancelledError());
    }

    controller.abort();
  };

  let timer = null;

  if (signal) {
    if (signal.aborted) {
      settledBy = "caller";
      settle(cancelledError());
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromCaller);
    }
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (settledBy === null) {
        settledBy = "timeout";
        settle(timeoutError());
      }

      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    settled,
    get settledBy() {
      return settledBy;
    },
    cleanup() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      if (signal) {
        signal.removeEventListener("abort", abortFromCaller);
      }
    }
  };
}

/**
 * Runs one lifecycle step under the guard.
 *
 * The operation is raced against the guard deadline, so the returned promise
 * always settles within the deadline even when the underlying reader ignores
 * the abort signal. A late rejection from a discarded operation is absorbed so
 * it can never surface as an unhandled rejection.
 */
async function guardedStep(guard, operation) {
  const operationPromise = Promise.resolve().then(operation);

  operationPromise.catch(() => {});

  try {
    return await Promise.race([operationPromise, guard.settled]);
  } catch (error) {
    // A guard rejection is already a normalized ApiError.
    if (error instanceof ApiError) {
      throw error;
    }

    if (guard.settledBy === "timeout") {
      throw timeoutError();
    }

    if (guard.settledBy === "caller" || isAbortLike(error)) {
      throw cancelledError();
    }

    throw networkError();
  }
}

/**
 * Owns the guard for one complete request: dispatch, status handling, error
 * body, and success body. `consume` receives the successful response and must
 * return the value the caller wants; it runs inside the deadline.
 */
async function runRequestLifecycle(options, consume) {
  const {
    baseUrl = "",
    path = "",
    fetchImpl,
    signal = null,
    headers = {},
    ...init
  } = options;

  const fetchToUse =
    typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;

  if (typeof fetchToUse !== "function") {
    throw networkError();
  }

  const guard = createLifecycleGuard({
    signal,
    timeoutMs: resolveTimeoutMs(options.timeoutMs)
  });

  try {
    const response = await guardedStep(guard, () =>
      fetchToUse(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: guard.signal
      })
    );

    if (!response.ok) {
      const message = await guardedStep(guard, () =>
        readHttpErrorMessage(response)
      );

      throw new ApiError(message, {
        status: response.status,
        kind: REQUEST_ERROR_KINDS.http
      });
    }

    return await guardedStep(guard, () => consume(response));
  } finally {
    guard.cleanup();
  }
}

/**
 * Reads an error response body without ever trusting its shape.
 *
 * Only a 4xx keeps the server's own message, because those are the
 * intentional, already-sanitized validation strings the product depends on.
 * A 5xx is deliberately NOT passed through even though this API currently
 * returns fixed text for it: a future or upstream handler that returned
 * diagnostic detail must still be unable to reach the interface.
 */
async function readHttpErrorMessage(response) {
  const fallback = messageForKind(REQUEST_ERROR_KINDS.http);
  const isClientError = response.status >= 400 && response.status < 500;

  let text;

  try {
    text = await response.text();
  } catch {
    return fallback;
  }

  if (text.trim().length === 0) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text);

    if (
      isClientError &&
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.error === "string" &&
      parsed.error.trim().length > 0
    ) {
      return parsed.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

/**
 * Performs one request under the full-lifecycle timeout/cancellation policy and
 * returns the raw `Response`.
 *
 * NOTE: this covers dispatch and any HTTP error body, but deliberately does NOT
 * read the success body. A caller that goes on to read the response body must
 * use `requestJson` or `requestBlob`, which keep the deadline active through
 * body consumption. Reading a body from a response returned here is outside the
 * deadline.
 */
export function sendRequest(options = {}) {
  return runRequestLifecycle(options, async (response) => response);
}

/**
 * Reads a successful response body as JSON.
 *
 * An empty body, a body that is not JSON, and a body whose content type is not
 * JSON are all reported as `unexpected_response` rather than surfacing a parser
 * message. Every PhishGuard endpoint returns a JSON envelope, so an empty or
 * non-JSON 2xx body is a contract violation worth surfacing.
 */
async function readJsonBody(response) {
  let text;

  try {
    text = await response.text();
  } catch {
    throw new ApiError(messageForKind(REQUEST_ERROR_KINDS.unexpectedResponse), {
      kind: REQUEST_ERROR_KINDS.unexpectedResponse
    });
  }

  if (text.trim().length === 0) {
    throw new ApiError(messageForKind(REQUEST_ERROR_KINDS.unexpectedResponse), {
      kind: REQUEST_ERROR_KINDS.unexpectedResponse
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(messageForKind(REQUEST_ERROR_KINDS.unexpectedResponse), {
      kind: REQUEST_ERROR_KINDS.unexpectedResponse
    });
  }
}

/**
 * Performs a request and parses a successful JSON body, with the deadline
 * active through body consumption.
 */
export function requestJson(options = {}) {
  return runRequestLifecycle(options, readJsonBody);
}

/**
 * Performs a request and reads a successful blob body, with the deadline active
 * through body consumption. Used by the research CSV download, whose payload is
 * never parsed or displayed.
 *
 * Returns the blob together with the response headers, because the download
 * filename is supplied by the server in `Content-Disposition`.
 */
export async function requestBlob(options = {}) {
  let capturedHeaders = null;

  const blob = await runRequestLifecycle(options, (response) => {
    capturedHeaders = response.headers;

    return response.blob();
  });

  return { blob, headers: capturedHeaders };
}

/**
 * Builds the shared requester used by every endpoint wrapper in `api.js`.
 *
 * `requiresAuth` is preserved as a caller option so the existing call sites and
 * the CSV download keep their current signature and behavior. Session
 * invalidation hooks are injected rather than imported, which is what lets this
 * be exercised without a DOM.
 */
export function createJsonRequester({
  baseUrl = "",
  fetchImpl,
  defaultTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  getAuthToken = () => null,
  buildAuthHeaders = () => ({}),
  isInvalidSessionError = () => false,
  onInvalidSession = () => {}
} = {}) {
  return async function request(path, options = {}) {
    const { requiresAuth = false, timeoutMs, signal, headers, ...init } = options;

    const requestToken = requiresAuth ? getAuthToken() : null;

    try {
      return await requestJson({
        baseUrl,
        path,
        fetchImpl,
        signal,
        timeoutMs: timeoutMs ?? defaultTimeoutMs,
        headers: {
          "Content-Type": "application/json",
          ...(requiresAuth ? buildAuthHeaders(requestToken) : {}),
          ...headers
        },
        ...init
      });
    } catch (error) {
      if (requiresAuth && isInvalidSessionError(error)) {
        onInvalidSession(requestToken, error);
      }

      throw error;
    }
  };
}