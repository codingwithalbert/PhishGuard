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
