const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const BASE_URL = "http://localhost:5000";

const correctAnswers = [
  "B",
  "C",
  "D",
  "A",
  "B",
  "A",
  "C",
  "B",
  "D",
  "A"
];

function makeAnswers(correctCount = correctAnswers.length) {
  const answers = correctAnswers.map((selectedAnswer, index) => ({
    questionId: index + 1,
    selectedAnswer
  }));

  for (let index = correctCount; index < answers.length; index += 1) {
    answers[index].selectedAnswer =
      answers[index].selectedAnswer === "A" ? "B" : "A";
  }

  return answers;
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

async function createAuthenticatedUser() {
  const credentials = {
    name: "Awareness Test User",
    email: `awareness-${crypto.randomUUID()}@test.invalid`,
    password: crypto.randomBytes(24).toString("hex")
  };

  const registerResponse = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials)
  });

  assert.equal(registerResponse.status, 201);

  const loginResponse = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password
    })
  });

  assert.equal(loginResponse.status, 200);

  const loginData = await loginResponse.json();

  assert.equal(loginData.success, true);
  assert.ok(loginData.token);

  return {
    token: loginData.token,
    userId: loginData.user.id
  };
}

let primaryUserPromise;
let ownershipFirstUserPromise;
let ownershipSecondUserPromise;
let emptyUserPromise;

function getPrimaryUser() {
  if (!primaryUserPromise) {
    primaryUserPromise = createAuthenticatedUser();
  }

  return primaryUserPromise;
}

function getOwnershipFirstUser() {
  if (!ownershipFirstUserPromise) {
    ownershipFirstUserPromise = createAuthenticatedUser();
  }

  return ownershipFirstUserPromise;
}

function getOwnershipSecondUser() {
  if (!ownershipSecondUserPromise) {
    ownershipSecondUserPromise = createAuthenticatedUser();
  }

  return ownershipSecondUserPromise;
}

function getEmptyUser() {
  if (!emptyUserPromise) {
    emptyUserPromise = createAuthenticatedUser();
  }

  return emptyUserPromise;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function submit(token, body) {
  return request("/api/awareness/submit", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body)
  });
}

async function getLatest(token) {
  return request("/api/awareness/latest", {
    headers: authHeaders(token)
  });
}

test("GET /api/awareness/questions requires authentication", async () => {
  const response = await request("/api/awareness/questions");

  assert.equal(response.status, 401);
});

test("POST /api/awareness/submit requires authentication", async () => {
  const response = await request("/api/awareness/submit", {
    method: "POST",
    body: JSON.stringify({ answers: makeAnswers() })
  });

  assert.equal(response.status, 401);
});

test("GET /api/awareness/latest requires authentication", async () => {
  const response = await request("/api/awareness/latest");

  assert.equal(response.status, 401);
});

test("rejects an invalid awareness token", async () => {
  const response = await request("/api/awareness/questions", {
    headers: {
      Authorization: "Bearer invalid-token"
    }
  });

  assert.equal(response.status, 403);
});

test("returns sanitized awareness questions", async () => {
  const { token } = await getPrimaryUser();
  const response = await request("/api/awareness/questions", {
    headers: authHeaders(token)
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.questions.length, 10);
  assert.equal(data.questions[0].questionId, 1);
  assert.equal(
    data.questions[0].text,
    "Which password practice provides better account security?"
  );
  assert.equal(data.questions[0].choices.length, 4);
  assert.equal(JSON.stringify(data.questions).includes("correctAnswer"), false);
  assert.equal(JSON.stringify(data.questions).includes("answerKey"), false);
});

test("submits and stores an authoritatively scored assessment", async () => {
  const { token } = await getPrimaryUser();
  const response = await submit(token, { answers: makeAnswers() });

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.assessment.rawScore, 10);
  assert.equal(data.assessment.score, 100);
  assert.equal(data.assessment.totalQuestions, 10);
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
});

test("returns the authenticated user's latest result without crossing ownership", async () => {
  const firstUser = await getOwnershipFirstUser();
  const secondUser = await getOwnershipSecondUser();

  const firstPerfectResponse = await submit(firstUser.token, {
    answers: makeAnswers()
  });

  assert.equal(firstPerfectResponse.status, 201);

  const firstPartialResponse = await submit(firstUser.token, {
    answers: makeAnswers(8)
  });

  assert.equal(firstPartialResponse.status, 201);

  const secondPerfectResponse = await submit(secondUser.token, {
    answers: makeAnswers()
  });

  assert.equal(secondPerfectResponse.status, 201);

  const firstLatestResponse = await getLatest(firstUser.token);

  assert.equal(firstLatestResponse.status, 200);

  const firstLatest = await firstLatestResponse.json();

  assert.equal(firstLatest.assessment.rawScore, 8);
  assert.equal(firstLatest.assessment.score, 80);

  const secondLatestResponse = await getLatest(secondUser.token);

  assert.equal(secondLatestResponse.status, 200);

  const secondLatest = await secondLatestResponse.json();

  assert.equal(secondLatest.assessment.rawScore, 10);
  assert.equal(secondLatest.assessment.score, 100);
});

test("returns a controlled response when the user has no assessment", async () => {
  const { token } = await getEmptyUser();
  const response = await getLatest(token);

  assert.equal(response.status, 404);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(data.error, "No awareness assessment found");
});

test("rejects server-owned fields and does not persist invalid submissions", async () => {
  const { token } = await getEmptyUser();
  const response = await submit(token, {
    answers: makeAnswers(),
    user: "another-user-id",
    rawScore: 0,
    score: 0,
    totalQuestions: 1,
    completedAt: "2000-01-01T00:00:00.000Z"
  });

  assert.equal(response.status, 400);

  const latestResponse = await getLatest(token);

  assert.equal(latestResponse.status, 404);
});
