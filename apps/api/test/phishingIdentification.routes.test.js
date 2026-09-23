require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:5000";

const correctAnswers = [
  "B",
  "C",
  "A",
  "D",
  "B",
  "A",
  "C",
  "B",
  "D",
  "A"
];

function makeAnswers(correctCount = correctAnswers.length) {
  const answers = correctAnswers.map((selectedAnswer, index) => ({
    scenarioId: index + 1,
    selectedAnswer
  }));

  for (let index = correctCount; index < answers.length; index += 1) {
    answers[index].selectedAnswer =
      answers[index].selectedAnswer === "A" ? "B" : "A";
  }

  return answers;
}

function makeUserId() {
  return crypto.randomBytes(12).toString("hex");
}

function makeToken(userId = makeUserId()) {
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

async function request(path, options = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function getScenarios(token) {
  return request("/api/phishing-identification/scenarios", {
    headers: authHeaders(token)
  });
}

async function submit(token, body) {
  return request("/api/phishing-identification/submit", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body)
  });
}

async function getLatest(token) {
  return request("/api/phishing-identification/latest", {
    headers: authHeaders(token)
  });
}

test("GET /api/phishing-identification/scenarios requires authentication", async () => {
  const response = await request(
    "/api/phishing-identification/scenarios"
  );

  assert.equal(response.status, 401);
});

test("POST /api/phishing-identification/submit requires authentication", async () => {
  const response = await request("/api/phishing-identification/submit", {
    method: "POST",
    body: JSON.stringify({ answers: makeAnswers() })
  });

  assert.equal(response.status, 401);
});

test("GET /api/phishing-identification/latest requires authentication", async () => {
  const response = await request("/api/phishing-identification/latest");

  assert.equal(response.status, 401);
});

test("rejects an invalid phishing identification token", async () => {
  const response = await getScenarios("invalid-token");

  assert.equal(response.status, 403);
});

test("returns sanitized phishing identification scenarios", async () => {
  const response = await getScenarios(makeToken());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.scenarios.length, 10);
  assert.equal(data.scenarios[0].scenarioId, 1);
  assert.equal(
    data.scenarios[0].scenario,
    "You receive an email that appears to be from your school's IT department. The display name says \"Campus IT Support,\" but the sender address is `support@campus-security-help.example`."
  );
  assert.deepEqual(
    data.scenarios[0].choices.map(({ value }) => value),
    ["A", "B", "C", "D"]
  );

  const serializedScenarios = JSON.stringify(data.scenarios);

  assert.equal(serializedScenarios.includes("correctAnswer"), false);
  assert.equal(serializedScenarios.includes("answerKey"), false);
  assert.equal(serializedScenarios.includes("correctness"), false);
});

test("submits and stores an authoritatively scored assessment", async () => {
  const response = await submit(makeToken(), {
    answers: makeAnswers().reverse()
  });

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.assessment.rawScore, 10);
  assert.equal(data.assessment.score, 100);
  assert.equal(data.assessment.totalScenarios, 10);
  assert.ok(data.assessment.id);
  assert.ok(Date.parse(data.assessment.completedAt));
  assert.equal(
    Object.prototype.hasOwnProperty.call(data.assessment, "answers"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(data.assessment, "user"),
    false
  );
  assert.equal(
    JSON.stringify(data.assessment).includes("answerKey"),
    false
  );
});

test("returns each user's latest attempt without crossing ownership", async () => {
  const firstToken = makeToken();
  const secondToken = makeToken();

  const firstPartialResponse = await submit(firstToken, {
    answers: makeAnswers(8)
  });

  assert.equal(firstPartialResponse.status, 201);

  const firstPerfectResponse = await submit(firstToken, {
    answers: makeAnswers()
  });

  assert.equal(firstPerfectResponse.status, 201);

  const secondPartialResponse = await submit(secondToken, {
    answers: makeAnswers(5)
  });

  assert.equal(secondPartialResponse.status, 201);

  const firstLatestResponse = await getLatest(firstToken);

  assert.equal(firstLatestResponse.status, 200);

  const firstLatest = await firstLatestResponse.json();

  assert.equal(firstLatest.assessment.rawScore, 10);
  assert.equal(firstLatest.assessment.score, 100);

  const secondLatestResponse = await getLatest(secondToken);

  assert.equal(secondLatestResponse.status, 200);

  const secondLatest = await secondLatestResponse.json();

  assert.equal(secondLatest.assessment.rawScore, 5);
  assert.equal(secondLatest.assessment.score, 50);
});

test("returns a controlled response when the user has no assessment", async () => {
  const response = await getLatest(makeToken());

  assert.equal(response.status, 404);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "No phishing identification assessment found");
});

test("rejects server-owned fields and does not persist invalid submissions", async () => {
  const token = makeToken();
  const response = await submit(token, {
    answers: makeAnswers(),
    user: makeUserId(),
    rawScore: 0,
    score: 0,
    totalScenarios: 1,
    completedAt: "2000-01-01T00:00:00.000Z",
    role: "admin"
  });

  assert.equal(response.status, 400);

  const latestResponse = await getLatest(token);

  assert.equal(latestResponse.status, 404);
});
