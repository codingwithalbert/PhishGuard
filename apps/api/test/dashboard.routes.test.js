require("dotenv").config();

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Analysis = require("../src/models/Analysis");
const AwarenessAssessment = require("../src/models/AwarenessAssessment");
const PhishingIdentificationAssessment = require("../src/models/PhishingIdentificationAssessment");
const TrainingCompletion = require("../src/models/TrainingCompletion");

const BASE_URL = "http://localhost:5000";
const trackedUserIds = new Set();

function createUserId() {
  const userId = new mongoose.Types.ObjectId();
  trackedUserIds.add(userId.toString());
  return userId;
}

function makeToken(userId, role = "user") {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      userId: userId.toString(),
      role
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

async function getSummary(token, query = "") {
  return request(`/api/dashboard/summary${query}`, {
    headers: authHeaders(token)
  });
}

function makeAnswers(idField) {
  return Array.from({ length: 10 }, (_, index) => ({
    [idField]: index + 1,
    selectedAnswer: "A"
  }));
}

async function insertAwarenessAssessment({
  userId,
  id = new mongoose.Types.ObjectId(),
  rawScore = 8,
  score = 80,
  completedAt = new Date()
}) {
  const document = {
    _id: id,
    user: userId,
    answers: makeAnswers("questionId"),
    rawScore,
    score,
    totalQuestions: 10,
    completedAt,
    createdAt: completedAt,
    updatedAt: completedAt
  };

  await AwarenessAssessment.collection.insertOne(document);
  return document;
}

async function insertPhishingIdentificationAssessment({
  userId,
  id = new mongoose.Types.ObjectId(),
  rawScore = 5,
  score = 50,
  completedAt = new Date()
}) {
  const document = {
    _id: id,
    user: userId,
    answers: makeAnswers("scenarioId"),
    rawScore,
    score,
    totalScenarios: 10,
    completedAt,
    createdAt: completedAt,
    updatedAt: completedAt
  };

  await PhishingIdentificationAssessment.collection.insertOne(document);
  return document;
}

async function insertAnalysis({
  userId,
  id = new mongoose.Types.ObjectId(),
  url = "https://example.com",
  risk = "low",
  score = 0,
  status = "active",
  createdAt = new Date(),
  indicators = []
}) {
  const document = {
    _id: id,
    user: userId,
    url,
    risk,
    score,
    indicators,
    status,
    createdAt,
    updatedAt: createdAt
  };

  await Analysis.collection.insertOne(document);
  return document;
}

async function insertTrainingCompletion(userId, moduleId) {
  return TrainingCompletion.create({
    user: userId,
    moduleId,
    completedAt: new Date()
  });
}

function getStateCounts(userId) {
  return Promise.all([
    AwarenessAssessment.countDocuments({ user: userId }),
    PhishingIdentificationAssessment.countDocuments({ user: userId }),
    TrainingCompletion.countDocuments({ user: userId }),
    Analysis.countDocuments({ user: userId })
  ]);
}

before(async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured");
  }

  await mongoose.connect(process.env.MONGODB_URI);
});

after(async () => {
  const userIds = [...trackedUserIds];

  if (userIds.length > 0) {
    const ownerFilter = { user: { $in: userIds } };

    await Promise.all([
      AwarenessAssessment.deleteMany(ownerFilter),
      PhishingIdentificationAssessment.deleteMany(ownerFilter),
      TrainingCompletion.deleteMany(ownerFilter),
      Analysis.deleteMany(ownerFilter)
    ]);
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test("GET /api/dashboard/summary requires authentication", async () => {
  const response = await request("/api/dashboard/summary");

  assert.equal(response.status, 401);

  const data = await response.json();

  assert.deepEqual(data, {
    success: false,
    error: "Authentication required"
  });
});

test("GET /api/dashboard/summary rejects an invalid JWT", async () => {
  const response = await request("/api/dashboard/summary", {
    headers: authHeaders("invalid-token")
  });

  assert.equal(response.status, 403);

  const data = await response.json();

  assert.deepEqual(data, {
    success: false,
    error: "Invalid or expired token"
  });
});

test("Dashboard summary does not register mutating routes", async () => {
  const userId = createUserId();
  const token = makeToken(userId);

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await request("/api/dashboard/summary", {
      method,
      headers: authHeaders(token)
    });

    assert.equal(response.status, 404);
  }
});

test("returns the exact empty summary for a new authenticated user", async () => {
  const userId = createUserId();
  const response = await getSummary(makeToken(userId));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const data = await response.json();

  assert.deepEqual(Object.keys(data).sort(), [
    "latestAwarenessAssessment",
    "latestPhishingIdentificationAssessment",
    "success",
    "trainingProgress",
    "urlAnalyses"
  ]);
  assert.deepEqual(data, {
    success: true,
    latestAwarenessAssessment: null,
    latestPhishingIdentificationAssessment: null,
    trainingProgress: {
      completedModules: 0,
      totalModules: 3,
      trainingExposure: 0
    },
    urlAnalyses: {
      total: 0,
      recent: []
    }
  });
});

test("keeps missing assessments null and completed zero scores as results", async () => {
  const awarenessUserId = createUserId();
  const phishingUserId = createUserId();
  const otherUserId = createUserId();
  const awarenessResult = await insertAwarenessAssessment({
    userId: awarenessUserId,
    rawScore: 0,
    score: 0
  });

  const phishingResult = await insertPhishingIdentificationAssessment({
    userId: phishingUserId
  });

  await insertAwarenessAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100,
    completedAt: new Date(Date.now() + 1000)
  });

  const awarenessResponse = await getSummary(
    makeToken(awarenessUserId)
  );
  const awarenessData = await awarenessResponse.json();

  assert.equal(awarenessData.latestAwarenessAssessment.score, 0);
  assert.equal(
    awarenessData.latestAwarenessAssessment.id,
    awarenessResult._id.toString()
  );
  assert.equal(
    awarenessData.latestPhishingIdentificationAssessment,
    null
  );

  const phishingResponse = await getSummary(makeToken(phishingUserId));
  const phishingData = await phishingResponse.json();

  assert.equal(phishingData.latestAwarenessAssessment, null);
  assert.equal(
    phishingData.latestPhishingIdentificationAssessment.score,
    50
  );
  assert.equal(
    phishingData.latestPhishingIdentificationAssessment.id,
    phishingResult._id.toString()
  );
});

test("uses deterministic ID ordering when Awareness completion times match", async () => {
  const userId = createUserId();
  const [lowerId, higherId] = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId()
  ].sort((left, right) =>
    left.toString().localeCompare(right.toString())
  );
  const completedAt = new Date("2026-01-01T00:00:00.000Z");

  await insertAwarenessAssessment({
    userId,
    id: lowerId,
    rawScore: 5,
    score: 50,
    completedAt
  });
  await insertAwarenessAssessment({
    userId,
    id: higherId,
    rawScore: 10,
    score: 100,
    completedAt
  });

  const response = await getSummary(makeToken(userId));
  const data = await response.json();

  assert.equal(data.latestAwarenessAssessment.id, higherId.toString());
  assert.equal(data.latestAwarenessAssessment.score, 100);
  assert.deepEqual(Object.keys(data.latestAwarenessAssessment).sort(), [
    "completedAt",
    "id",
    "rawScore",
    "score",
    "totalQuestions"
  ]);

  const serialized = JSON.stringify(data.latestAwarenessAssessment);

  assert.equal(serialized.includes('"user"'), false);
  assert.equal(serialized.includes('"answers"'), false);
  assert.equal(serialized.includes("answerKey"), false);
  assert.equal(serialized.includes("correctness"), false);
});

test("uses deterministic ID ordering when phishing completion times match", async () => {
  const userId = createUserId();
  const [lowerId, higherId] = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId()
  ].sort((left, right) =>
    left.toString().localeCompare(right.toString())
  );
  const completedAt = new Date("2026-01-01T00:00:00.000Z");

  await insertPhishingIdentificationAssessment({
    userId,
    id: lowerId,
    rawScore: 5,
    score: 50,
    completedAt
  });
  await insertPhishingIdentificationAssessment({
    userId,
    id: higherId,
    rawScore: 8,
    score: 80,
    completedAt
  });

  const response = await getSummary(makeToken(userId));
  const data = await response.json();

  assert.equal(
    data.latestPhishingIdentificationAssessment.id,
    higherId.toString()
  );
  assert.equal(
    data.latestPhishingIdentificationAssessment.score,
    80
  );
  assert.deepEqual(
    Object.keys(data.latestPhishingIdentificationAssessment).sort(),
    [
      "completedAt",
      "id",
      "rawScore",
      "score",
      "totalScenarios"
    ]
  );

  const serialized = JSON.stringify(
    data.latestPhishingIdentificationAssessment
  );

  assert.equal(serialized.includes('"user"'), false);
  assert.equal(serialized.includes('"answers"'), false);
  assert.equal(serialized.includes("answerKey"), false);
  assert.equal(serialized.includes("correctness"), false);
});

test("returns backend-authoritative Training Exposure at every V1 level", async () => {
  const userId = createUserId();
  const otherUserId = createUserId();
  const expectedProgress = [
    { completedModules: 0, totalModules: 3, trainingExposure: 0 },
    { completedModules: 1, totalModules: 3, trainingExposure: 33.33 },
    { completedModules: 2, totalModules: 3, trainingExposure: 66.67 },
    { completedModules: 3, totalModules: 3, trainingExposure: 100 }
  ];

  for (const moduleId of [1, 2, 3]) {
    await insertTrainingCompletion(otherUserId, moduleId);
  }

  let latestData;

  for (let index = 0; index < expectedProgress.length; index += 1) {
    if (index > 0) {
      await insertTrainingCompletion(userId, index);
    }

    const response = await getSummary(makeToken(userId));
    latestData = await response.json();

    assert.deepEqual(
      latestData.trainingProgress,
      expectedProgress[index]
    );
  }

  const serialized = JSON.stringify(latestData);
  assert.equal(serialized.includes("modules"), false);
});

test("returns an owner-scoped count and exactly five deterministic recent analyses", async () => {
  const userId = createUserId();
  const otherUserId = createUserId();
  const analysisIds = Array.from(
    { length: 7 },
    () => new mongoose.Types.ObjectId()
  ).sort((left, right) =>
    left.toString().localeCompare(right.toString())
  );
  const statuses = [
    "active",
    "reviewed",
    "archived",
    "active",
    "reviewed",
    "archived",
    "active"
  ];

  for (let index = 0; index < analysisIds.length; index += 1) {
    await insertAnalysis({
      userId,
      id: analysisIds[index],
      url: `https://owned-${index}.example`,
      risk: index % 3 === 0 ? "low" : "medium",
      score: index * 5,
      status: statuses[index],
      indicators: [`Private indicator ${index}`],
      createdAt: new Date(`2026-02-0${index + 1}T00:00:00.000Z`)
    });
  }

  const tiedCreatedAt = new Date("2026-03-01T00:00:00.000Z");
  const [lowerId, higherId] = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId()
  ].sort((left, right) =>
    left.toString().localeCompare(right.toString())
  );

  await insertAnalysis({
    userId,
    id: lowerId,
    url: "https://tied-lower.example",
    createdAt: tiedCreatedAt
  });
  await insertAnalysis({
    userId,
    id: higherId,
    url: "https://tied-higher.example",
    createdAt: tiedCreatedAt
  });

  for (let index = 0; index < 2; index += 1) {
    await insertAnalysis({
      userId: otherUserId,
      url: `https://other-${index}.example`,
      createdAt: new Date(`2026-04-0${index + 1}T00:00:00.000Z`)
    });
  }

  await insertAwarenessAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100
  });
  await insertPhishingIdentificationAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100
  });
  for (const moduleId of [1, 2, 3]) {
    await insertTrainingCompletion(otherUserId, moduleId);
  }

  const stateBefore = await getStateCounts(userId);
  const response = await getSummary(
    makeToken(userId),
    `?userId=${otherUserId.toString()}&limit=50`
  );
  const stateAfter = await getStateCounts(userId);

  assert.equal(response.status, 200);
  assert.deepEqual(stateAfter, stateBefore);

  const data = await response.json();

  assert.equal(data.latestAwarenessAssessment, null);
  assert.equal(data.latestPhishingIdentificationAssessment, null);
  assert.equal(data.trainingProgress.completedModules, 0);
  assert.equal(data.urlAnalyses.total, 9);
  assert.equal(data.urlAnalyses.recent.length, 5);
  assert.deepEqual(
    data.urlAnalyses.recent.map(({ id }) => id),
    [higherId, lowerId, ...analysisIds.slice(4).reverse()].map((id) =>
      id.toString()
    )
  );

  for (const analysis of data.urlAnalyses.recent) {
    assert.deepEqual(Object.keys(analysis).sort(), [
      "createdAt",
      "id",
      "risk",
      "score",
      "status",
      "url"
    ]);
  }

  const updateResponse = await request(
    `/api/analyze/${higherId.toString()}`,
    {
      method: "PATCH",
      headers: authHeaders(makeToken(userId)),
      body: JSON.stringify({ status: "archived" })
    }
  );

  assert.equal(updateResponse.status, 200);

  const afterUpdateResponse = await getSummary(makeToken(userId));
  const afterUpdateData = await afterUpdateResponse.json();

  assert.deepEqual(
    afterUpdateData.urlAnalyses.recent.map(({ id }) => id),
    data.urlAnalyses.recent.map(({ id }) => id)
  );
  assert.equal(afterUpdateData.urlAnalyses.recent[0].status, "archived");

  const deleteResponse = await request(
    `/api/analyze/${analysisIds[0].toString()}`,
    {
      method: "DELETE",
      headers: authHeaders(makeToken(userId))
    }
  );

  assert.equal(deleteResponse.status, 200);

  const afterDeleteResponse = await getSummary(makeToken(userId));
  const afterDeleteData = await afterDeleteResponse.json();

  assert.equal(afterDeleteData.urlAnalyses.total, 8);

  const serialized = JSON.stringify(data);

  assert.equal(serialized.includes('"user"'), false);
  assert.equal(serialized.includes('"answers"'), false);
  assert.equal(serialized.includes('"indicators"'), false);
  assert.equal(serialized.includes('"__v"'), false);
  assert.equal(serialized.includes("answerKey"), false);
  assert.equal(serialized.includes("correctness"), false);
});

test("preserves the existing owner-scoped full-history Analysis contract", async () => {
  const userId = createUserId();
  const token = makeToken(userId);

  for (const url of [
    "https://history-one.example",
    "https://history-two.example"
  ]) {
    const response = await request("/api/analyze", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ url })
    });

    assert.equal(response.status, 201);
  }

  const response = await request("/api/analyze", {
    headers: authHeaders(token)
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.count, 2);
  assert.equal(data.analyses.length, 2);

  for (const analysis of data.analyses) {
    assert.ok(analysis._id);
    assert.equal(analysis.user, userId.toString());
    assert.equal(typeof analysis.url, "string");
    assert.ok(Array.isArray(analysis.indicators));
    assert.ok(Object.hasOwn(analysis, "status"));
    assert.ok(Object.hasOwn(analysis, "createdAt"));
    assert.ok(Object.hasOwn(analysis, "updatedAt"));
    assert.ok(Object.hasOwn(analysis, "__v"));
  }
});
