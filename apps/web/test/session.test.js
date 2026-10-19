/*
 * Focused automated coverage for session invalidation detection.
 *
 * `session.js` reads `localStorage` and dispatches on `window`, neither of
 * which exists in a plain Node test. Both are installed here as minimal stubs
 * BEFORE the module is imported, so the real module logic runs unmodified
 * against synthetic browser state.
 *
 * Every fixture is synthetic. No real token, credential, or account is used.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  messageForKind,
  REQUEST_ERROR_KINDS
} from "../src/services/apiTransport.js";

/** Minimal localStorage stand-in with the surface `session.js` uses. */
function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    }
  };
}

const dispatchedEvents = [];

globalThis.localStorage = createMemoryStorage();
globalThis.window = {
  dispatchEvent(event) {
    dispatchedEvents.push(event);

    return true;
  }
};

/*
 * `session.js` keeps a module-level de-duplication Set so one notification is
 * emitted per token. A plain top-level import would therefore share that Set
 * across every test in this file, making assertions order-dependent.
 *
 * Each test therefore receives a FRESH module instance, via an ESM
 * cache-busting specifier. Nothing in the module is stubbed or reset by hand;
 * the real logic simply runs against a clean instance and synthetic storage.
 */
let instanceCounter = 0;

async function loadFreshSession() {
  instanceCounter += 1;

  const module = await import(
    `../src/services/session.js?instance=${instanceCounter}`
  );

  return {
    SESSION_EXPIRED_EVENT: module.SESSION_EXPIRED_EVENT,
    SESSION_EXPIRED_MESSAGE: module.SESSION_EXPIRED_MESSAGE,
    clearStoredSession: module.clearStoredSession,
    getStoredToken: module.getStoredToken,
    handleInvalidSessionForRequest: module.handleInvalidSessionForRequest,
    isInvalidSessionError: module.isInvalidSessionError,
    isTokenRemovalStorageEvent: module.isTokenRemovalStorageEvent,
    storeSession: module.storeSession
  };
}

function reset() {
  globalThis.localStorage.removeItem("token");
  globalThis.localStorage.removeItem("user");
  dispatchedEvents.length = 0;
}

const SYNTHETIC_USER = Object.freeze({
  id: "u1",
  name: "Synthetic",
  email: "synthetic@test.invalid",
  role: "user"
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

test("a 403 invalid-token rejection is detected as an invalid session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError("Invalid or expired token", { status: 403 });

  assert.equal(isInvalidSessionError(error), true);
});

test("a 401 missing-credentials rejection is detected as an invalid session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError("Authentication required", { status: 401 });

  assert.equal(isInvalidSessionError(error), true);
});

test("a timeout is never mistaken for an expired session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError(messageForKind(REQUEST_ERROR_KINDS.timeout), {
    kind: REQUEST_ERROR_KINDS.timeout
  });

  assert.equal(isInvalidSessionError(error), false);
});

test("a network failure is never mistaken for an expired session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError(messageForKind(REQUEST_ERROR_KINDS.network), {
    kind: REQUEST_ERROR_KINDS.network
  });

  assert.equal(isInvalidSessionError(error), false);
});

test("an unexpected response is never mistaken for an expired session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError(
    messageForKind(REQUEST_ERROR_KINDS.unexpectedResponse),
    { kind: REQUEST_ERROR_KINDS.unexpectedResponse }
  );

  assert.equal(isInvalidSessionError(error), false);
});

test("a caller cancellation is never mistaken for an expired session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError(messageForKind(REQUEST_ERROR_KINDS.cancelled), {
    kind: REQUEST_ERROR_KINDS.cancelled,
    name: "AbortError"
  });

  assert.equal(isInvalidSessionError(error), false);
});

test("a 403 carrying a different message is not an invalid session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  const error = new ApiError("Something else entirely", { status: 403 });

  assert.equal(isInvalidSessionError(error), false);
});

test("a browser network TypeError is not an invalid session", async () => {
  const { isInvalidSessionError } = await loadFreshSession();

  assert.equal(isInvalidSessionError(new TypeError("Failed to fetch")), false);
  assert.equal(isInvalidSessionError(undefined), false);
  assert.equal(isInvalidSessionError(null), false);
});

// ---------------------------------------------------------------------------
// Reaction
// ---------------------------------------------------------------------------

test("an expired session clears the stored session and notifies once per token", async () => {
  const {
    SESSION_EXPIRED_EVENT,
    SESSION_EXPIRED_MESSAGE,
    getStoredToken,
    handleInvalidSessionForRequest,
    storeSession
  } = await loadFreshSession();

  reset();
  storeSession("token-a", SYNTHETIC_USER);

  assert.equal(getStoredToken(), "token-a");

  handleInvalidSessionForRequest("token-a");

  assert.equal(getStoredToken(), null, "the stored token must be removed");
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, SESSION_EXPIRED_EVENT);
  assert.equal(dispatchedEvents[0].detail.message, SESSION_EXPIRED_MESSAGE);

  // A second failure for the same already-cleared token must not re-notify.
  handleInvalidSessionForRequest("token-a");

  assert.equal(dispatchedEvents.length, 1, "notification is de-duplicated per token");
});

test("a stale failure for a superseded token is ignored and leaves the session intact", async () => {
  const { getStoredToken, handleInvalidSessionForRequest, storeSession } =
    await loadFreshSession();

  reset();
  storeSession("token-b", SYNTHETIC_USER);

  const handled = handleInvalidSessionForRequest("token-a");

  assert.equal(handled, false);
  assert.equal(getStoredToken(), "token-b", "the current session must survive a stale rejection");
  assert.equal(dispatchedEvents.length, 0);
});

test("a missing-credentials failure without a stored session notifies once", async () => {
  const { handleInvalidSessionForRequest } = await loadFreshSession();

  reset();

  const handled = handleInvalidSessionForRequest(null);

  assert.equal(handled, true);
  assert.equal(dispatchedEvents.length, 1);

  handleInvalidSessionForRequest(null);

  assert.equal(dispatchedEvents.length, 1, "missing-authentication is de-duplicated");
});

test("a missing-credentials failure while a token is present is ignored", async () => {
  const { getStoredToken, handleInvalidSessionForRequest, storeSession } =
    await loadFreshSession();

  reset();
  storeSession("token-c", SYNTHETIC_USER);

  const handled = handleInvalidSessionForRequest(null);

  assert.equal(handled, false);
  assert.equal(getStoredToken(), "token-c");
  assert.equal(dispatchedEvents.length, 0);
});

test("the de-duplication Set does not leak between module instances", async () => {
  // Proves the isolation fix: a fresh instance must notify again for the same
  // null token, which a shared module-level Set would have suppressed.
  const first = await loadFreshSession();
  reset();
  first.handleInvalidSessionForRequest(null);
  assert.equal(dispatchedEvents.length, 1);

  const second = await loadFreshSession();
  reset();
  second.handleInvalidSessionForRequest(null);

  assert.equal(
    dispatchedEvents.length,
    1,
    "a fresh module instance must start with an empty de-duplication Set"
  );
});

// ---------------------------------------------------------------------------
// Cross-tab detection
// ---------------------------------------------------------------------------

test("a storage event removing a token is recognised as a cross-tab sign-out", async () => {
  const { isTokenRemovalStorageEvent } = await loadFreshSession();

  const event = {
    storageArea: globalThis.localStorage,
    key: "token",
    oldValue: "token-d",
    newValue: null
  };

  assert.equal(isTokenRemovalStorageEvent(event), true);
});

test("an unrelated storage event is not treated as a sign-out", async () => {
  const { isTokenRemovalStorageEvent } = await loadFreshSession();

  assert.equal(
    isTokenRemovalStorageEvent({
      storageArea: globalThis.localStorage,
      key: "user",
      oldValue: "{}",
      newValue: null
    }),
    false
  );
  assert.equal(
    isTokenRemovalStorageEvent({
      storageArea: globalThis.localStorage,
      key: "token",
      oldValue: "",
      newValue: null
    }),
    false
  );
  assert.equal(isTokenRemovalStorageEvent({}), false);
});