import {
  getStoredToken,
  handleInvalidSessionForRequest,
  isInvalidSessionError,
  SIGN_IN_REQUIRED_MESSAGE
} from "./session";

import {
  ApiError,
  createJsonRequester,
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRequestCancelled,
  REQUEST_ERROR_KINDS,
  REQUEST_ERROR_MESSAGES,
  requestBlob,
  safeProductError,
  toSafeErrorMessage
} from "./apiTransport";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export {
  ApiError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRequestCancelled,
  REQUEST_ERROR_KINDS,
  REQUEST_ERROR_MESSAGES,
  safeProductError,
  toSafeErrorMessage
};

/**
 * The shared requester.
 *
 * `requiresAuth` keeps its existing meaning: it attaches the bearer token and
 * enables session-invalidation handling. Session invalidation fires only for a
 * recognized 403/401 rejection, which the transport preserves exactly, so this
 * behavior is unchanged from the previous inline implementation.
 */
const request = createJsonRequester({
  baseUrl: API_URL,
  fetchImpl: (...args) => globalThis.fetch(...args),
  getAuthToken: getStoredToken,
  buildAuthHeaders: getAuthHeaders,
  isInvalidSessionError,
  onInvalidSession: (requestToken) => {
    handleInvalidSessionForRequest(requestToken, {
      message: requestToken ? undefined : SIGN_IN_REQUIRED_MESSAGE
    });
  }
});

function getAuthHeaders(token = getStoredToken()) {
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

export function registerUser(name, email, password) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password
    })
  });
}

export function loginUser(email, password) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password
    })
  });
}

// Password reset requests are unauthenticated, so no Authorization header is
// sent. Only the documented field is submitted.
export function requestPasswordReset(email) {
  return request("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      email
    })
  });
}

// `confirmPassword` is a client-side concern and is never sent. The raw reset
// token is only used to build this request body and is never stored, logged, or
// displayed by the app.
export function resetPassword(token, password) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      token,
      password
    })
  });
}

// Profile & Change Password V1: authoritative account data. The profile is
// always read from the API; the stored user snapshot is not authoritative.
export function getCurrentProfile() {
  return request("/api/auth/me", {
    method: "GET",
    requiresAuth: true
  });
}

// Only the editable display name is submitted. Email, role, account id, and
// every other server-owned field are never part of this request.
export function updateProfileName(name) {
  return request("/api/auth/profile", {
    method: "PATCH",
    requiresAuth: true,
    body: JSON.stringify({
      name
    })
  });
}

// The exact error message the frozen contract returns for an incorrect current
// password. Matched literally so no other 401 is misread as a form error.
const CURRENT_PASSWORD_INCORRECT_MESSAGE = "Current password is incorrect";

// The confirmation password is a client-side concern and is never sent.
//
// The frozen contract answers 401 with the error message
// "Current password is incorrect" when the submitted current password is wrong.
// That is a form error rather than a session failure, so it is flagged here to
// keep the page from treating it as an expired session.
//
// Only that exact status-and-message pair is flagged for the form. Confirmed
// expired or revoked sessions are handled centrally by request().
export async function changePassword(currentPassword, newPassword) {
  try {
    return await request("/api/auth/change-password", {
      method: "POST",
      requiresAuth: true,
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });
  } catch (error) {
    // Narrow by design: a wrong current password is the only non-session 401
    // this endpoint produces, and it is identified by its exact message.
    error.isCurrentPasswordRejection =
      error?.status === 401 &&
      error?.message === CURRENT_PASSWORD_INCORRECT_MESSAGE;

    throw error;
  }
}

// Server-side logout. Best-effort token revocation: the shared requester
// captures the bearer token synchronously at this call, so the shell can clear
// local session state immediately afterwards without losing the credential.
// Every transport or HTTP failure here is swallowed by the caller — logout is
// complete client-side regardless, and no user-visible message ever claims
// server-side revocation for a failed request.
export function logoutUser() {
  return request("/api/auth/logout", {
    method: "POST",
    requiresAuth: true
  });
}

// Research Analytics V1: aggregate research analytics. Admin only; the backend
// enforces authorization. This endpoint returns aggregate values only and never
// returns participant-level records.
//
// Analytics Visualization V1: an optional Training Exposure filter. When
// `exposureLevel` is "all" the parameter is omitted entirely, so the request is
// byte-identical to the pre-existing unfiltered call and the backend returns its
// original response shape with no `filter` envelope. A selected level is sent as
// the completed-module count the API contract accepts.
export function getResearchAnalytics({ exposureLevel, signal } = {}) {
  const query =
    typeof exposureLevel === "string" &&
    exposureLevel.length > 0 &&
    exposureLevel !== "all"
      ? `?exposureLevel=${encodeURIComponent(exposureLevel)}`
      : "";

  return request(`/api/research/analytics${query}`, {
    method: "GET",
    requiresAuth: true,
    signal
  });
}

const RESEARCH_CSV_FALLBACK_FILENAME =
  "phishguard-research-data.csv";

// Only plain filename characters survive, so a server-provided name can never
// introduce path separators into the download attribute.
function resolveCsvFilename(contentDisposition) {
  if (typeof contentDisposition !== "string") {
    return RESEARCH_CSV_FALLBACK_FILENAME;
  }

  const encoded = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(
    contentDisposition
  );
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(contentDisposition);
  const candidate = (encoded?.[1] ?? plain?.[1] ?? "").trim();
  const safeName = candidate.replace(/[^\w.\- ]+/g, "_").trim();

  return safeName.length > 0
    ? safeName
    : RESEARCH_CSV_FALLBACK_FILENAME;
}

// The CSV endpoint is not JSON, so it reads a blob rather than forcing the
// payload through a JSON parser. The response is only read as a download blob:
// it is never parsed, logged, displayed, or stored. It is a read-only GET, so
// the shared full-lifecycle deadline applies — including the blob read — and no
// retry semantics are involved.
async function requestResearchCsv() {
  const requestToken = getStoredToken();

  try {
    const { blob, headers } = await requestBlob({
      baseUrl: API_URL,
      path: "/api/research/export.csv",
      fetchImpl: (...args) => globalThis.fetch(...args),
      headers: {
        ...getAuthHeaders(requestToken),
        Accept: "text/csv"
      }
    });

    return {
      blob,
      filename: resolveCsvFilename(headers.get("content-disposition"))
    };
  } catch (error) {
    if (isInvalidSessionError(error)) {
      handleInvalidSessionForRequest(requestToken, {
        message: requestToken ? undefined : SIGN_IN_REQUIRED_MESSAGE
      });
    }

    throw error;
  }
}

export async function downloadResearchCsv() {
  const { blob, filename } = await requestResearchCsv();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  try {
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return { filename };
}

// `toSafeErrorMessage` is the single choke point for user-visible error text.
// It is defined and documented in `apiTransport.js` so the whole failure
// contract lives in one testable place, and re-exported here because every
// page already imports it from this module.

export function analyzeUrl(url) {
  return request("/api/analyze", {
    method: "POST",
    requiresAuth: true,
    body: JSON.stringify({
      url
    })
  });
}

export function getAnalyses() {
  return request("/api/analyze", {
    method: "GET",
    requiresAuth: true
  });
}

export function getDashboardSummary() {
  return request("/api/dashboard/summary", {
    method: "GET",
    requiresAuth: true
  });
}

export function getProgress() {
  return request("/api/progress", {
    method: "GET",
    requiresAuth: true
  });
}

export function deleteAnalysis(id) {
  return request(`/api/analyze/${id}`, {
    method: "DELETE",
    requiresAuth: true
  });
}

export function getAwarenessQuestions() {
  return request("/api/awareness/questions", {
    method: "GET",
    requiresAuth: true
  });
}

export function submitAwarenessAssessment(answers) {
  return request("/api/awareness/submit", {
    method: "POST",
    requiresAuth: true,
    body: JSON.stringify({
      answers
    })
  });
}

export function getLatestAwarenessAssessment() {
  return request("/api/awareness/latest", {
    method: "GET",
    requiresAuth: true
  });
}

export function getPhishingIdentificationScenarios() {
  return request("/api/phishing-identification/scenarios", {
    method: "GET",
    requiresAuth: true
  });
}

export function submitPhishingIdentificationAssessment(answers) {
  return request("/api/phishing-identification/submit", {
    method: "POST",
    requiresAuth: true,
    body: JSON.stringify({
      answers
    })
  });
}

export function getLatestPhishingIdentificationAssessment() {
  return request("/api/phishing-identification/latest", {
    method: "GET",
    requiresAuth: true
  });
}

export function getTrainingModules() {
  return request("/api/training/modules", {
    method: "GET",
    requiresAuth: true
  });
}

export function getTrainingProgress() {
  return request("/api/training/progress", {
    method: "GET",
    requiresAuth: true
  });
}

export function completeTrainingModule(moduleId) {
  return request(
    `/api/training/modules/${encodeURIComponent(moduleId)}/complete`,
    {
      method: "POST",
      requiresAuth: true
    }
  );
}

function appendOptionalText(body, field, value) {
  if (value === undefined || value === null) {
    return body;
  }

  if (typeof value !== "string") {
    body[field] = value;
    return body;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > 0) {
    body[field] = normalizedValue;
  }

  return body;
}

export function createReport({ analysisId, reason, details } = {}) {
  const body = { analysisId, reason };

  appendOptionalText(body, "details", details);

  return request("/api/reports", {
    method: "POST",
    requiresAuth: true,
    body: JSON.stringify(body)
  });
}

export function getOwnReports() {
  return request("/api/reports", {
    method: "GET",
    requiresAuth: true
  });
}

export function getOwnReport(reportId) {
  return request(`/api/reports/${encodeURIComponent(reportId)}`, {
    method: "GET",
    requiresAuth: true
  });
}

export function getOwnReportMessages(reportId) {
  return request(
    `/api/reports/${encodeURIComponent(reportId)}/messages`,
    {
      method: "GET",
      requiresAuth: true
    }
  );
}

export function createOwnReportMessage({ reportId, message } = {}) {
  return request(
    `/api/reports/${encodeURIComponent(reportId)}/messages`,
    {
      method: "POST",
      requiresAuth: true,
      body: JSON.stringify({ message })
    }
  );
}

export function getReviewQueue() {
  return request("/api/reports/review", {
    method: "GET",
    requiresAuth: true
  });
}

export function getAssignmentCandidates() {
  return request("/api/reports/review/assignees", {
    method: "GET",
    requiresAuth: true
  });
}

export function getReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}`,
    {
      method: "GET",
      requiresAuth: true
    }
  );
}

export function getReviewReportMessages(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/messages`,
    {
      method: "GET",
      requiresAuth: true
    }
  );
}

export function createReviewReportMessage({ reportId, message } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/messages`,
    {
      method: "POST",
      requiresAuth: true,
      body: JSON.stringify({ message })
    }
  );
}

export function claimReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/claim`,
    {
      method: "PATCH",
      requiresAuth: true
    }
  );
}

export function assignReviewReport({ reportId, assignedTo } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/assignment`,
    {
      method: "PATCH",
      requiresAuth: true,
      body: JSON.stringify({ assignedTo })
    }
  );
}

export function updateReviewReportPriority({ reportId, priority } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/priority`,
    {
      method: "PATCH",
      requiresAuth: true,
      body: JSON.stringify({ priority })
    }
  );
}

export function startReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/start`,
    {
      method: "PATCH",
      requiresAuth: true
    }
  );
}

export function completeReviewReport({
  reportId,
  assessment,
  reviewerNote
} = {}) {
  const body = { assessment };

  appendOptionalText(body, "reviewerNote", reviewerNote);

  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/complete`,
    {
      method: "PATCH",
      requiresAuth: true,
      body: JSON.stringify(body)
    }
  );
}
