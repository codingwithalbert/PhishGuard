const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong");

    error.status = response.status;

    throw error;
  }

  return data;
}

function getAuthHeaders() {
  const token = localStorage.getItem("token");

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

// Research Analytics V1: aggregate research analytics. Admin only; the backend
// enforces authorization. This endpoint returns aggregate values only and never
// returns participant-level records.
export function getResearchAnalytics() {
  return request("/api/research/analytics", {
    method: "GET",
    headers: getAuthHeaders()
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

// The CSV endpoint is not JSON, so it bypasses request() instead of being
// forced through a JSON parser. The response is only read as a download blob:
// it is never parsed, logged, displayed, or stored.
async function requestResearchCsv() {
  const response = await fetch(`${API_URL}/api/research/export.csv`, {
    method: "GET",
    headers: {
      ...getAuthHeaders(),
      Accept: "text/csv"
    }
  });

  if (!response.ok) {
    const error = new Error("The research export could not be downloaded.");
    error.status = response.status;

    try {
      const data = await response.json();

      if (typeof data?.error === "string" && data.error.length > 0) {
        error.message = data.error;
      }
    } catch {
      // A non-JSON error body is ignored; the safe default message stands.
    }

    throw error;
  }

  return {
    blob: await response.blob(),
    filename: resolveCsvFilename(
      response.headers.get("content-disposition")
    )
  };
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

// Only client-facing 4xx messages produced by the API are surfaced. Network
// failures, unexpected response bodies, and server errors fall back to the
// caller's safe message so internal details are never displayed.
export function toSafeErrorMessage(error, fallback) {
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

export function analyzeUrl(url) {
  return request("/api/analyze", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      url
    })
  });
}

export function getAnalyses() {
  return request("/api/analyze", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getDashboardSummary() {
  return request("/api/dashboard/summary", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getProgress() {
  return request("/api/progress", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function updateAnalysis(id, status) {
  return request(`/api/analyze/${id}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      status
    })
  });
}

export function deleteAnalysis(id) {
  return request(`/api/analyze/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders()
  });
}

export function getAwarenessQuestions() {
  return request("/api/awareness/questions", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function submitAwarenessAssessment(answers) {
  return request("/api/awareness/submit", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      answers
    })
  });
}

export function getLatestAwarenessAssessment() {
  return request("/api/awareness/latest", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getPhishingIdentificationScenarios() {
  return request("/api/phishing-identification/scenarios", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function submitPhishingIdentificationAssessment(answers) {
  return request("/api/phishing-identification/submit", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      answers
    })
  });
}

export function getLatestPhishingIdentificationAssessment() {
  return request("/api/phishing-identification/latest", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getTrainingModules() {
  return request("/api/training/modules", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getTrainingProgress() {
  return request("/api/training/progress", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function completeTrainingModule(moduleId) {
  return request(
    `/api/training/modules/${encodeURIComponent(moduleId)}/complete`,
    {
      method: "POST",
      headers: getAuthHeaders()
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
    headers: getAuthHeaders(),
    body: JSON.stringify(body)
  });
}

export function getOwnReports() {
  return request("/api/reports", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getOwnReport(reportId) {
  return request(`/api/reports/${encodeURIComponent(reportId)}`, {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getOwnReportMessages(reportId) {
  return request(
    `/api/reports/${encodeURIComponent(reportId)}/messages`,
    {
      method: "GET",
      headers: getAuthHeaders()
    }
  );
}

export function createOwnReportMessage({ reportId, message } = {}) {
  return request(
    `/api/reports/${encodeURIComponent(reportId)}/messages`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ message })
    }
  );
}

export function getReviewQueue() {
  return request("/api/reports/review", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getAssignmentCandidates() {
  return request("/api/reports/review/assignees", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function getReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}`,
    {
      method: "GET",
      headers: getAuthHeaders()
    }
  );
}

export function getReviewReportMessages(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/messages`,
    {
      method: "GET",
      headers: getAuthHeaders()
    }
  );
}

export function createReviewReportMessage({ reportId, message } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/messages`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ message })
    }
  );
}

export function claimReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/claim`,
    {
      method: "PATCH",
      headers: getAuthHeaders()
    }
  );
}

export function assignReviewReport({ reportId, assignedTo } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/assignment`,
    {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ assignedTo })
    }
  );
}

export function updateReviewReportPriority({ reportId, priority } = {}) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/priority`,
    {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ priority })
    }
  );
}

export function startReviewReport(reportId) {
  return request(
    `/api/reports/review/${encodeURIComponent(reportId)}/start`,
    {
      method: "PATCH",
      headers: getAuthHeaders()
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
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    }
  );
}
