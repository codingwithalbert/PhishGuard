require("dotenv").config();

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

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

async function getProgress(token, query = "") {
  return request(`/api/progress${query}`, {
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
  completedAt = new Date(),
  internalMarker = "private-awareness-marker"
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
    updatedAt: completedAt,
    __v: 0,
    internalMarker
  };

  await AwarenessAssessment.collection.insertOne(document);
  return document;
}

async function insertPhishingIdentificationAssessment({
  userId,
  id = new mongoose.Types.ObjectId(),
  rawScore = 5,
  score = 50,
  completedAt = new Date(),
  internalMarker = "private-phishing-marker"
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
    updatedAt: completedAt,
    __v: 0,
    internalMarker
  };

  await PhishingIdentificationAssessment.collection.insertOne(document);
  return document;
}

async function insertTrainingCompletion(userId, moduleId) {
  return TrainingCompletion.create({
    user: userId,
    moduleId,
    completedAt: new Date()
  });
}

async function getStateCounts(userId) {
  return Promise.all([
    AwarenessAssessment.countDocuments({ user: userId }),
    PhishingIdentificationAssessment.countDocuments({ user: userId }),
    TrainingCompletion.countDocuments({ user: userId })
  ]);
}

function assertSafeAwarenessDto(assessment) {
  assert.deepEqual(Object.keys(assessment).sort(), [
    "completedAt",
    "id",
    "rawScore",
    "score",
    "totalQuestions"
  ]);
}

function assertSafePhishingDto(assessment) {
  assert.deepEqual(Object.keys(assessment).sort(), [
    "completedAt",
    "id",
    "rawScore",
    "score",
    "totalScenarios"
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
      TrainingCompletion.deleteMany(ownerFilter)
    ]);
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test("GET /api/progress requires authentication", async () => {
  const response = await request("/api/progress");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Authentication required"
  });
});

test("GET /api/progress rejects an invalid JWT", async () => {
  const response = await request("/api/progress", {
    headers: authHeaders("invalid-token")
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Invalid or expired token"
  });
});

test("returns the exact empty Progress state for a new user", async () => {
  const userId = createUserId();
  const response = await getProgress(makeToken(userId));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(data).sort(), [
    "awareness",
    "phishingIdentification",
    "success",
    "training"
  ]);
  assert.equal(data.success, true);
  assert.deepEqual(data.awareness, {
    latest: null,
    history: []
  });
  assert.deepEqual(data.phishingIdentification, {
    latest: null,
    history: []
  });
  assert.equal(data.training.completedModules, 0);
  assert.equal(data.training.totalModules, 3);
  assert.equal(data.training.trainingExposure, 0);
  assert.equal(data.training.modules.length, 3);
  assert.ok(
    data.training.modules.every(
      (module) => module.completed === false && module.completedAt === null
    )
  );
});

test("returns bounded, deterministic, owner-scoped Progress with safe DTOs", async () => {
  const userId = createUserId();
  const otherUserId = createUserId();
  const awarenessAttempts = [];
  const phishingAttempts = [];

  for (let index = 0; index < 11; index += 1) {
    const completedAt = new Date(
      `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
    );
    const isLatest = index === 10;

    awarenessAttempts.push(
      await insertAwarenessAssessment({
        userId,
        rawScore: isLatest ? 0 : index,
        score: isLatest ? 0 : index * 10,
        completedAt
      })
    );

    phishingAttempts.push(
      await insertPhishingIdentificationAssessment({
        userId,
        rawScore: isLatest ? 0 : index,
        score: isLatest ? 0 : index * 10,
        completedAt
      })
    );
  }

  await insertAwarenessAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100,
    completedAt: new Date("2027-01-01T00:00:00.000Z"),
    internalMarker: "other-user-private-awareness"
  });
  await insertPhishingIdentificationAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100,
    completedAt: new Date("2027-01-01T00:00:00.000Z"),
    internalMarker: "other-user-private-phishing"
  });
  for (const moduleId of [1, 2, 3]) {
    await insertTrainingCompletion(otherUserId, moduleId);
  }
  await insertTrainingCompletion(userId, 1);
  await insertTrainingCompletion(userId, 3);

  const countsBefore = await getStateCounts(userId);
  const response = await getProgress(
    makeToken(userId),
    `?userId=${otherUserId.toString()}&limit=50`
  );
  const data = await response.json();
  const countsAfter = await getStateCounts(userId);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(countsAfter, countsBefore);
  assert.deepEqual(Object.keys(data).sort(), [
    "awareness",
    "phishingIdentification",
    "success",
    "training"
  ]);
  assert.equal(data.success, true);

  assert.equal(data.awareness.history.length, 10);
  assert.equal(data.phishingIdentification.history.length, 10);
  assert.deepEqual(
    data.awareness.history.map(({ id }) => id),
    awarenessAttempts
      .slice(1)
      .reverse()
      .map(({ _id }) => _id.toString())
  );
  assert.deepEqual(
    data.phishingIdentification.history.map(({ id }) => id),
    phishingAttempts
      .slice(1)
      .reverse()
      .map(({ _id }) => _id.toString())
  );

  assert.deepEqual(data.awareness.latest, data.awareness.history[0]);
  assert.deepEqual(
    data.phishingIdentification.latest,
    data.phishingIdentification.history[0]
  );
  assert.equal(data.awareness.latest.rawScore, 0);
  assert.equal(data.awareness.latest.score, 0);
  assert.equal(data.phishingIdentification.latest.rawScore, 0);
  assert.equal(data.phishingIdentification.latest.score, 0);

  for (const assessment of data.awareness.history) {
    assertSafeAwarenessDto(assessment);
  }

  for (const assessment of data.phishingIdentification.history) {
    assertSafePhishingDto(assessment);
  }

  assert.deepEqual(
    {
      completedModules: data.training.completedModules,
      totalModules: data.training.totalModules,
      trainingExposure: data.training.trainingExposure
    },
    {
      completedModules: 2,
      totalModules: 3,
      trainingExposure: 66.67
    }
  );
  assert.equal(data.training.modules.length, 3);
  assert.deepEqual(
    data.training.modules.map(({ moduleId }) => moduleId),
    [1, 2, 3]
  );
  assert.deepEqual(
    data.training.modules.map(({ completed }) => completed),
    [true, false, true]
  );

  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('"user":'), false);
  assert.equal(serialized.includes('"answers":'), false);
  assert.equal(serialized.includes('"__v":'), false);
  assert.equal(serialized.includes("answerKey"), false);
  assert.equal(serialized.includes("correctness"), false);
  assert.equal(serialized.includes("private-awareness-marker"), false);
  assert.equal(serialized.includes("private-phishing-marker"), false);
  assert.equal(serialized.includes(otherUserId.toString()), false);
});

test("uses descending _id to break equal completion timestamps", async () => {
  const userId = createUserId();
  const [lowerId, higherId] = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId()
  ].sort((left, right) => left.toString().localeCompare(right.toString()));
  const completedAt = new Date("2026-02-01T00:00:00.000Z");

  await insertAwarenessAssessment({
    userId,
    id: lowerId,
    completedAt
  });
  await insertAwarenessAssessment({
    userId,
    id: higherId,
    completedAt
  });
  await insertPhishingIdentificationAssessment({
    userId,
    id: lowerId,
    completedAt
  });
  await insertPhishingIdentificationAssessment({
    userId,
    id: higherId,
    completedAt
  });

  const response = await getProgress(makeToken(userId));
  const data = await response.json();

  assert.deepEqual(
    data.awareness.history.map(({ id }) => id),
    [higherId.toString(), lowerId.toString()]
  );
  assert.deepEqual(
    data.phishingIdentification.history.map(({ id }) => id),
    [higherId.toString(), lowerId.toString()]
  );
  assert.equal(data.awareness.latest.id, higherId.toString());
  assert.equal(
    data.phishingIdentification.latest.id,
    higherId.toString()
  );
});

test("allows user, staff, and admin roles to read only their own Progress", async () => {
  const userId = createUserId();
  const otherUserId = createUserId();
  const userAssessment = await insertAwarenessAssessment({
    userId,
    rawScore: 3,
    score: 30
  });
  const otherAssessment = await insertAwarenessAssessment({
    userId: otherUserId,
    rawScore: 10,
    score: 100
  });

  for (const role of ["user", "staff", "admin"]) {
    const response = await getProgress(makeToken(userId, role));
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.awareness.latest.id, userAssessment._id.toString());
    assert.equal(data.phishingIdentification.latest, null);
    assert.equal(
      data.awareness.latest.id === otherAssessment._id.toString(),
      false
    );
  }
});
