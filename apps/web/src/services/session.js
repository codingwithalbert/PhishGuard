const TOKEN_STORAGE_KEY = "token";
const USER_STORAGE_KEY = "user";

export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";
export const SESSION_EXPIRED_EVENT = "phishguard:session-expired";
export const SIGN_IN_REQUIRED_MESSAGE = "Please sign in to continue.";

const INVALID_TOKEN_MESSAGE = "Invalid or expired token";
const AUTHENTICATION_REQUIRED_MESSAGE = "Authentication required";
const MISSING_AUTHENTICATION_NOTIFICATION = "missing-authentication";

const notifiedInvalidatedTokens = new Set();

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function getStoredUser() {
  try {
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);

    if (!storedUser) {
      return null;
    }

    const parsedUser = JSON.parse(storedUser);

    return parsedUser && typeof parsedUser === "object"
      ? parsedUser
      : null;
  } catch {
    return null;
  }
}

export function getStoredUserRole() {
  const storedUser = getStoredUser();

  return typeof storedUser?.role === "string" ? storedUser.role : null;
}

export function storeSession(token, user) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  notifiedInvalidatedTokens.clear();
}

export function storeUserSnapshot(user) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}

export function isInvalidSessionError(error) {
  if (!error || typeof error.status !== "number") {
    return false;
  }

  if (error.status === 403 && error.message === INVALID_TOKEN_MESSAGE) {
    return true;
  }

  return (
    error.status === 401 &&
    error.message === AUTHENTICATION_REQUIRED_MESSAGE
  );
}

export function handleInvalidSessionForRequest(
  requestToken,
  { message = SESSION_EXPIRED_MESSAGE } = {}
) {
  const currentToken = getStoredToken();

  if (requestToken && currentToken !== requestToken) {
    return false;
  }

  if (!requestToken) {
    if (currentToken) {
      return false;
    }

    clearStoredSession();

    if (notifiedInvalidatedTokens.has(MISSING_AUTHENTICATION_NOTIFICATION)) {
      return true;
    }

    notifiedInvalidatedTokens.add(MISSING_AUTHENTICATION_NOTIFICATION);
    window.dispatchEvent(
      new CustomEvent(SESSION_EXPIRED_EVENT, {
        detail: {
          message
        }
      })
    );

    return true;
  }

  clearStoredSession();

  if (notifiedInvalidatedTokens.has(requestToken)) {
    return true;
  }

  notifiedInvalidatedTokens.add(requestToken);
  window.dispatchEvent(
    new CustomEvent(SESSION_EXPIRED_EVENT, {
      detail: {
        message: SESSION_EXPIRED_MESSAGE
      }
    })
  );

  return true;
}

export function isTokenRemovalStorageEvent(event) {
  return (
    event.storageArea === localStorage &&
    event.key === TOKEN_STORAGE_KEY &&
    typeof event.oldValue === "string" &&
    event.oldValue.length > 0 &&
    event.newValue === null
  );
}
