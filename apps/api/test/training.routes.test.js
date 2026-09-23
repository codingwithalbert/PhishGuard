require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:5000";

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

async function getModules(token) {
  return request("/api/training/modules", {
    headers: authHeaders(token)
  });
}

async function getProgress(token) {
  return request("/api/training/progress", {
    headers: authHeaders(token)
  });
}

async function completeModule(token, moduleId, body) {
  const options = {
    method: "POST",
    headers: authHeaders(token)
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return request(`/api/training/modules/${moduleId}/complete`, options);
}

test("GET /api/training/modules requires authentication", async () => {
  const response = await request("/api/training/modules");

  assert.equal(response.status, 401);
});

test("GET /api/training/progress requires authentication", async () => {
  const response = await request("/api/training/progress");

  assert.equal(response.status, 401);
});

test("POST /api/training/modules/:moduleId/complete requires authentication", async () => {
  const response = await request("/api/training/modules/1/complete", {
    method: "POST"
  });

  assert.equal(response.status, 401);
});

test("rejects an invalid training token", async () => {
  const response = await getModules("invalid-token");

  assert.equal(response.status, 403);
});

test("returns the exact sanitized modules response", async () => {
  const response = await getModules(makeToken());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.deepEqual(Object.keys(data), ["modules"]);
  assert.equal(data.modules.length, 3);
  assert.deepEqual(
    data.modules.map(({ moduleId }) => moduleId),
    [1, 2, 3]
  );

  for (const module of data.modules) {
    assert.deepEqual(Object.keys(module).sort(), [
      "completed",
      "completedAt",
      "content",
      "learningObjective",
      "moduleId",
      "title"
    ]);
    assert.equal(module.completed, false);
    assert.equal(module.completedAt, null);
  }

  const serializedModules = JSON.stringify(data);

  assert.equal(serializedModules.includes("trainingExposure"), false);
  assert.equal(serializedModules.includes("answerKey"), false);
  assert.equal(serializedModules.includes('"user":'), false);
});

test("returns the exact initial progress response", async () => {
  const response = await getProgress(makeToken());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.deepEqual(data, {
    progress: {
      completedModules: 0,
      totalModules: 3,
      trainingExposure: 0
    }
  });
});

test("completes a module first with 201 and an empty object body with 201", async () => {
  const token = makeToken();
  const noBodyResponse = await completeModule(token, 1);
  assert.equal(noBodyResponse.status, 201);

  const emptyObjectResponse = await completeModule(token, 2, {});
  assert.equal(emptyObjectResponse.status, 201);

  const modulesResponse = await getModules(token);
  const modulesData = await modulesResponse.json();

  assert.equal(modulesData.modules[0].completed, true);
  assert.equal(modulesData.modules[1].completed, true);
  assert.equal(modulesData.modules[2].completed, false);
});

test("returns 200 for a repeated completion and preserves completedAt", async () => {
  const token = makeToken();
  const firstResponse = await completeModule(token, 1);
  const firstData = await firstResponse.json();

  const repeatedResponse = await completeModule(token, 1, {});
  const repeatedData = await repeatedResponse.json();

  assert.equal(firstResponse.status, 201);
  assert.equal(repeatedResponse.status, 200);
  assert.equal(
    repeatedData.completion.completedAt,
    firstData.completion.completedAt
  );
  assert.deepEqual(repeatedData.progress, {
    completedModules: 1,
    totalModules: 3,
    trainingExposure: 33.33
  });
});

test("rejects non-empty completion bodies", async () => {
  const token = makeToken();
  const response = await completeModule(token, 1, {
    user: makeUserId(),
    completedAt: "2000-01-01T00:00:00.000Z",
    completedModules: 3,
    totalModules: 3,
    trainingExposure: 100,
    role: "admin"
  });

  assert.equal(response.status, 400);

  const data = await response.json();

  assert.equal(data.success, false);
  assert.equal(typeof data.error, "string");
});

test("rejects arrays, strings, and null completion bodies", async () => {
  const token = makeToken();

  for (const body of [[], "body", null]) {
    const response = await completeModule(token, 1, body);
    assert.equal(response.status, 400);
  }
});

test("derives progress at 0, 1, 2, and 3 completions", async () => {
  const token = makeToken();

  let response = await getProgress(token);
  let data = await response.json();
  assert.equal(data.progress.trainingExposure, 0);

  for (const moduleId of [1, 2, 3]) {
    response = await completeModule(token, moduleId);
    assert.equal(response.status, 201);
    data = await response.json();

    assert.equal(data.progress.completedModules, moduleId);
    assert.deepEqual(data.progress.trainingExposure, [
      33.33,
      66.67,
      100
    ][moduleId - 1]);
  }
});

test("keeps training completions isolated between users", async () => {
  const firstToken = makeToken();
  const secondToken = makeToken();

  const firstResponse = await completeModule(firstToken, 1);
  assert.equal(firstResponse.status, 201);

  const secondProgressResponse = await getProgress(secondToken);
  const secondProgress = await secondProgressResponse.json();
  assert.equal(secondProgress.progress.completedModules, 0);
  assert.equal(secondProgress.progress.trainingExposure, 0);

  const secondModulesResponse = await getModules(secondToken);
  const secondModules = await secondModulesResponse.json();
  assert.equal(secondModules.modules[0].completed, false);
});

test("rejects malformed and unknown canonical module IDs", async () => {
  const token = makeToken();

  for (const moduleId of ["0", "4", "01", "1.0", "+1", "-1", "abc"]) {
    const response = await completeModule(token, moduleId);
    assert.equal(response.status, 400);
  }
});

test("handles concurrent duplicate completion idempotently", async () => {
  const token = makeToken();
  const responses = await Promise.all([
    completeModule(token, 1),
    completeModule(token, 1, {})
  ]);

  const statuses = responses.map(({ status }) => status).sort();
  assert.deepEqual(statuses, [200, 201]);

  const bodies = await Promise.all(
    responses.map((response) => response.json())
  );
  assert.equal(
    bodies[0].completion.completedAt,
    bodies[1].completion.completedAt
  );

  const progressResponse = await getProgress(token);
  const progress = await progressResponse.json();

  assert.deepEqual(progress.progress, {
    completedModules: 1,
    totalModules: 3,
    trainingExposure: 33.33
  });
});

test("returns no interpretation categories in training responses", async () => {
  const token = makeToken();
  const response = await completeModule(token, 1);
  const data = await response.json();
  const serialized = JSON.stringify(data);

  for (const category of [
    "category",
    "interpretation",
    "level",
    "rank",
    "ranking",
    "comparison"
  ]) {
    assert.equal(serialized.includes(category), false);
  }
});
