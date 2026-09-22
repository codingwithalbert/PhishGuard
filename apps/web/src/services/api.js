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
    throw new Error(data.error || "Something went wrong");
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

export function verifyStaffAccess() {
  return request("/api/auth/staff-test", {
    method: "GET",
    headers: getAuthHeaders()
  });
}

export function verifyAdminAccess() {
  return request("/api/auth/admin-test", {
    method: "GET",
    headers: getAuthHeaders()
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