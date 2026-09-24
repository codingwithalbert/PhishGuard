require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:5000";

let authToken;

async function login() {
  if (authToken) {
    return authToken;
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "user@test.com",
      password: "TestPassword123!"
    })
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(data.token);

  authToken = data.token;

  return authToken;
}

function makeTokenForUser(userId) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      userId,
      role: "user"
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h"
    }
  );
}

async function analyze(body, token) {
  return fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

test("POST /api/analyze rejects a request without authentication", async () => {
  const response = await fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: "https://example.com"
    })
  });

  assert.equal(response.status, 401);

  const data = await response.json();

  assert.equal(data.success, false);
});

test("POST /api/analyze returns low risk for a normal HTTPS URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "https://example.com"
    },
    token
  );

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.analysis.url, "https://example.com");
  assert.equal(data.analysis.risk, "low");
  assert.equal(data.analysis.score, 0);
  assert.deepEqual(data.analysis.indicators, []);
  assert.deepEqual(data.analysis.findings, []);
  assert.equal(data.analysis.status, "active");
  assert.ok(data.analysis.id);
});

test("POST /api/analyze returns high risk for a suspicious URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "http://192.168.1.1/login"
    },
    token
  );

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.analysis.risk, "high");
  assert.equal(data.analysis.score, 50);
  assert.equal(data.analysis.indicators.length, 3);
  assert.equal(data.analysis.findings.length, 3);
  assert.equal(
    data.analysis.findings.reduce(
      (total, finding) => total + finding.scoreContribution,
      0
    ),
    data.analysis.score
  );
});

test("POST /api/analyze rejects a missing URL", async () => {
  const token = await login();

  const response = await analyze({}, token);

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL is required");
});

test("POST /api/analyze rejects a non-string URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: 12345
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL must be a string");
});

test("POST /api/analyze rejects an invalid URL", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "not-a-valid-url"
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "Invalid URL");
});

test("POST /api/analyze rejects unsupported protocols", async () => {
  const token = await login();

  const response = await analyze(
    {
      url: "ftp://example.com"
    },
    token
  );

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "URL must use HTTP or HTTPS");
});

test("GET and PATCH expose and preserve findings for stored analyses", async () => {
  const token = await login();
  const createResponse = await analyze(
    {
      url: "https://history.example/login"
    },
    token
  );

  assert.equal(createResponse.status, 201);

  const createData = await createResponse.json();
  const analysisId = String(createData.analysis.id);
  const expectedFinding = {
    type: "suspicious_keyword",
    title: "Suspicious keyword(s)",
    explanation:
      "Words related to login, verification, or account activity can appear in deceptive URLs, but they can also occur on legitimate websites.",
    scoreContribution: 5
  };

  try {
    const historyResponse = await fetch(`${BASE_URL}/api/analyze`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    assert.equal(historyResponse.status, 200);

    const historyData = await historyResponse.json();
    const historyAnalysis = historyData.analyses.find(
      (analysis) => String(analysis._id) === analysisId
    );

    assert.ok(historyAnalysis);
    assert.deepEqual(historyAnalysis.indicators, [
      "Contains suspicious keyword(s): login"
    ]);
    assert.deepEqual(historyAnalysis.findings, [expectedFinding]);

    const updateResponse = await fetch(
      `${BASE_URL}/api/analyze/${analysisId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: "reviewed" })
      }
    );

    assert.equal(updateResponse.status, 200);

    const updateData = await updateResponse.json();

    assert.equal(updateData.analysis.status, "reviewed");
    assert.deepEqual(updateData.analysis.findings, [expectedFinding]);

    const otherUserId = new mongoose.Types.ObjectId().toString();
    const otherToken = makeTokenForUser(otherUserId);
    const otherHistoryResponse = await fetch(`${BASE_URL}/api/analyze`, {
      headers: {
        Authorization: `Bearer ${otherToken}`
      }
    });

    assert.equal(otherHistoryResponse.status, 200);

    const otherHistoryData = await otherHistoryResponse.json();

    assert.equal(
      otherHistoryData.analyses.some(
        (analysis) => String(analysis._id) === analysisId
      ),
      false
    );

    const otherUpdateResponse = await fetch(
      `${BASE_URL}/api/analyze/${analysisId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${otherToken}`
        },
        body: JSON.stringify({ status: "archived" })
      }
    );

    assert.equal(otherUpdateResponse.status, 404);

    const otherDeleteResponse = await fetch(
      `${BASE_URL}/api/analyze/${analysisId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${otherToken}`
        }
      }
    );

    assert.equal(otherDeleteResponse.status, 403);
  } finally {
    await fetch(`${BASE_URL}/api/analyze/${analysisId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  }
});
