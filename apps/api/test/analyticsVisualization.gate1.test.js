const test = require("node:test");
const { after, before, test: nodeTest } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const errorHandler = require("../src/middleware/error.middleware");
const User = require("../src/models/User");
const researchRoutes = require("../src/routes/research.routes");
const { createResearchRouter } = researchRoutes;
const {
  createResearchController
} = require("../src/controllers/research.controller");
const {
  TRAINING_EXPOSURE_LEVELS,
  buildResearchAnalytics,
  buildResearchAnalyticsSummary,
  buildResearchParticipantDataset,
  filterParticipantsByExposureLevel,
  getTrainingExposureLabelForLevel
} = require("../src/services/researchAnalytics.dataset");
const {
  MINIMUM_REPORTABLE_OBSERVATIONS,
  applySmallCohortSuppression
} = require("../src/services/researchAnalytics.suppression");
const {
  EXPOSURE_LEVEL_ALL,
  validateAnalyticsQuery
} = require("../src/middleware/research.validate.middleware");

// Analytics Visualization V1 — Gate 1 (backend) tests.
//
// These exercise the REAL `buildResearchAnalytics` (filter -> summary ->
// suppression) and the REAL router/controller/validator chain. The existing
// Research Analytics stage 2 suite cannot do that: its service double calls
// `buildResearchAnalyticsSummary` directly and therefore bypasses both the
// filter and the suppression step entirely (note N6).
//
// Every fixture is synthetic and disposable. No real student record is read.

// ---------------------------------------------------------------------------
// Minimal in-memory model stand-ins. They apply filtering, sorting, and
// inclusion projections so dataset ownership and ordering are exercised.
// ---------------------------------------------------------------------------

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (
      condition !== null &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date) &&
      "$in" in condition
    ) {
      return condition.$in.some(
        (candidate) => String(candidate) === String(document[field])
      );
    }

    if (
      condition !== null &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date)
    ) {
      const entries = Object.entries(condition);

      if (entries.length > 0 && entries.every(([key]) => key.startsWith("$"))) {
        return entries.every(([operator, operand]) => {
          if (operator === "$gt") {
            return document[field] > operand;
          }

          throw new Error(`Unsupported fake query operator: ${operator}`);
        });
      }
    }

    const stored = document[field];

    if (stored instanceof Date || condition instanceof Date) {
      return (
        stored instanceof Date &&
        condition instanceof Date &&
        stored.getTime() === condition.getTime()
      );
    }

    return String(stored) === String(condition);
  });
}

function compareValues(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (typeof left === "object" && left !== null &&
      typeof right === "object" && right !== null) {
    return String(left).localeCompare(String(right));
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function applySort(documents, sortSpec) {
  if (!sortSpec) {
    return [...documents];
  }

  return [...documents].sort((left, right) => {
    for (const [field, direction] of Object.entries(sortSpec)) {
      const comparison = compareValues(left[field], right[field]);

      if (comparison !== 0) {
        return comparison * direction;
      }
    }

    return 0;
  });
}

function createFakeModel(documents = [], { applyFilter = true } = {}) {
  const model = {
    find(filter) {
      let matched = documents;

      if (applyFilter) {
        matched = matched.filter((document) =>
          matchesFilter(document, filter)
        );
      }

      let selectedFields;

      const query = {
        select(projection) {
          selectedFields = projection;
          return query;
        },
        sort(sortSpec) {
          matched = applySort(matched, sortSpec);
          return query;
        },
        lean() {
          return query;
        },
        then(onFulfilled, onRejected) {
          const projected = selectedFields
            ? matched.map((document) =>
                Object.fromEntries(
                  Object.entries(document).filter(([field]) =>
                    field === "_id"
                      ? selectedFields._id !== 0
                      : selectedFields[field] === 1
                  )
                )
              )
            : matched;

          return Promise.resolve(projected).then(onFulfilled, onRejected);
        }
      };

      return query;
    }
  };

  return model;
}

let idCounter = 0;

function createUser({
  role = "user",
  isActive = true,
  createdAt = new Date(`2026-01-0${(idCounter % 8) + 1}T00:00:00.000Z`)
} = {}) {
  idCounter += 1;

  return {
    _id: new mongoose.Types.ObjectId(),
    name: `Synthetic Participant ${idCounter}`,
    email: `synthetic.${idCounter}@example.invalid`,
    password: "bcrypt-hash-placeholder",
    role,
    isActive,
    createdAt
  };
}

function createAssessment(score, completedAt) {
  return {
    _id: new mongoose.Types.ObjectId(),
    score,
    completedAt: completedAt || new Date("2026-02-01T00:00:00.000Z")
  };
}

function createCompletion(completedAt) {
  return {
    _id: new mongoose.Types.ObjectId(),
    moduleId: 1,
    completedAt: completedAt || new Date("2026-02-01T00:00:00.000Z")
  };
}

function buildHarness({ users = [], awareness = [], phishing = [], training = [] } = {}) {
  return {
    userModel: createFakeModel(users),
    awarenessModel: createFakeModel(awareness),
    phishingIdentificationModel: createFakeModel(phishing),
    trainingCompletionModel: createFakeModel(training)
  };
}

// Builds one synthetic user with a chosen exposure level and chosen assessment
// availability. Scores are percent values on the existing 0-100 scale.
function buildPopulation({ users, plan }) {
  const awareness = [];
  const phishing = [];
  const training = [];

  for (const entry of plan) {
    const { exposure, awarenessScore, phishingScore, repeatAwareness = false } =
      entry;

    for (let moduleId = 1; moduleId <= exposure; moduleId += 1) {
      training.push({
        ...createCompletion(),
        user: entry.user._id,
        moduleId
      });
    }

    if (awarenessScore !== null && awarenessScore !== undefined) {
      awareness.push({
        ...createAssessment(awarenessScore),
        user: entry.user._id
      });

      // A repeated attempt must be collapsed to the latest one.
      if (repeatAwareness) {
        awareness.push({
          ...createAssessment(
            Math.min(100, awarenessScore + 20),
            new Date("2026-06-01T00:00:00.000Z")
          ),
          user: entry.user._id
        });
      }
    }

    if (phishingScore !== null && phishingScore !== undefined) {
      phishing.push({
        ...createAssessment(phishingScore),
        user: entry.user._id
      });
    }
  }

  return buildHarness({ users, awareness, phishing, training });
}

// A reusable population: 24 eligible users, six at each of the four levels.
// Six per level keeps every level's valid observation count at or above the
// reporting threshold, so the filtering assertions below observe real
// statistics rather than suppressed ones. Suppression is exercised separately
// with deliberately small fixtures.
function buildStandardPopulation() {
  const plan = [];
  const levelCounts = [6, 6, 6, 6];

  for (let level = 0; level <= 3; level += 1) {
    for (let index = 0; index < levelCounts[level]; index += 1) {
      plan.push({
        user: createUser(),
        exposure: level,
        awarenessScore: 40 + level * 10 + index * 5,
        phishingScore: 30 + level * 12 + index * 4
      });
    }
  }

  return buildPopulation({ users: plan.map((entry) => entry.user), plan });
}

// ---------------------------------------------------------------------------
// HTTP harness: real router, real controller, real service, synthetic models.
// ---------------------------------------------------------------------------

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const ADMIN_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const STAFF_ID = new mongoose.Types.ObjectId();

let httpServer;
let baseUrl;
let standardModels;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api/research",
  createResearchRouter(
    createResearchController({
      buildResearchAnalytics: (options = {}) =>
        buildResearchAnalytics({ ...standardModels, ...options }),
      buildResearchParticipantDataset: () =>
        buildResearchParticipantDataset(standardModels)
    })
  )
);
app.use(errorHandler);

before(() => {
  const activeAccounts = new Map([
    [ADMIN_ID.toString(), "admin"],
    [USER_ID.toString(), "user"],
    [STAFF_ID.toString(), "staff"]
  ]);

  const originalFindOne = User.findOne.bind(User);

  User.findOne = (filter) => {
    const role = activeAccounts.get(String(filter?._id));

    if (!role) {
      return originalFindOne(filter);
    }

    const query = {
      select() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(String(filter._id)),
          role,
          isActive: true,
          tokenVersion: 0
        }).then(onFulfilled, onRejected);
      }
    };

    return query;
  };

  standardModels = buildStandardPopulation();

  httpServer = http.createServer(app);

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  }).then(() => {
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  });
});

after(() => {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  }).then(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  });
});

function authHeaders(id, role) {
  const token = jwt.sign(
    { userId: String(id), role, tokenVersion: 0 },
    testJwtSecret,
    { expiresIn: "1h" }
  );

  return { Authorization: `Bearer ${token}` };
}

function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { method: "GET", headers });
}

// ---------------------------------------------------------------------------
// Query validation
// ---------------------------------------------------------------------------

const ACCEPTED_VALUES = ["all", "0", "1", "2", "3"];

for (const value of ACCEPTED_VALUES) {
  test(`accepted exposure level "${value}" reaches the analytics response`, async () => {
    const response = await get(
      `/api/research/analytics?exposureLevel=${value}`,
      authHeaders(ADMIN_ID, "admin")
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}

const REJECTED_QUERIES = [
  ["?exposureLevel=", "blank value"],
  ["?exposureLevel", "bare parameter"],
  ["?exposureLevel=4", "out-of-range level"],
  ["?exposureLevel=-1", "negative level"],
  ["?exposureLevel=1.5", "decimal level"],
  ["?exposureLevel=alll", "misspelled all"],
  ["?exposureLevel=NULL", "literal null"],
  ["?exposureLevel=true", "boolean literal"],
  ["?exposureLevel=0&exposureLevel=1", "duplicate conflicting parameters"],
  ["?exposureLevel[]=2", "bracketed parameter"],
  ["?role=admin", "role parameter"],
  ["?userIds=1", "user list parameter"],
  ["?cohort=all", "cohort parameter"],
  ["?$where=1", "operator-style parameter"],
  ["?foo=1", "unknown parameter"]
];

for (const [queryString, description] of REJECTED_QUERIES) {
  test(`rejects ${description}: ${queryString}`, async () => {
    const response = await get(
      `/api/research/analytics${queryString}`,
      authHeaders(ADMIN_ID, "admin")
    );

    assert.equal(response.status, 400);

    const body = await response.json();

    assert.equal(body.success, false);
    assert.equal(typeof body.error, "string");
    assert.equal(body.error.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "cohort"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "methodology"), false);
  });
}

// ---------------------------------------------------------------------------
// Authorization still precedes validation (spec section 3)
// ---------------------------------------------------------------------------

test("authorization runs before query validation and never discloses analytics", async () => {
  const unauthenticated = await get(
    "/api/research/analytics?exposureLevel=0"
  );

  assert.equal(unauthenticated.status, 401);

  for (const [id, role] of [[USER_ID, "user"], [STAFF_ID, "staff"]]) {
    const denied = await get(
      "/api/research/analytics?exposureLevel=0",
      authHeaders(id, role)
    );

    assert.equal(denied.status, 403);
  }

  // An invalid parameter must not leak whether validation ran: a non-admin is
  // still rejected for authorization, never for the query.
  const deniedWithInvalidQuery = await get(
    "/api/research/analytics?exposureLevel=9999",
    authHeaders(USER_ID, "user")
  );

  assert.equal(deniedWithInvalidQuery.status, 403);
});

test("the CSV export route ignores query parameters exactly as before", async () => {
  const ignored = await get(
    "/api/research/export.csv?exposureLevel=0&foo=bar",
    authHeaders(ADMIN_ID, "admin")
  );

  assert.equal(ignored.status, 200);
  assert.equal(ignored.headers.get("content-type"), "text/csv; charset=utf-8");

  const plain = await get(
    "/api/research/export.csv",
    authHeaders(ADMIN_ID, "admin")
  );

  assert.equal(plain.status, 200);
  assert.equal(await ignored.text(), await plain.text());
});

// ---------------------------------------------------------------------------
// Envelope inclusion rules
// ---------------------------------------------------------------------------

test("an omitted parameter omits the filter envelope entirely", async () => {
  const response = await get(
    "/api/research/analytics",
    authHeaders(ADMIN_ID, "admin")
  );

  const body = await response.json();

  assert.equal(
    Object.prototype.hasOwnProperty.call(body, "filter"),
    false
  );

  assert.deepEqual(Object.keys(body).sort(), [
    "awareness",
    "cohort",
    "methodology",
    "phishingIdentification",
    "relationships",
    "success",
    "trainingExposureDistribution"
  ]);
});

test("an explicit all returns unfiltered data plus the envelope", async () => {
  const omitted = await (
    await get("/api/research/analytics", authHeaders(ADMIN_ID, "admin"))
  ).json();

  const explicit = await (
    await get(
      "/api/research/analytics?exposureLevel=all",
      authHeaders(ADMIN_ID, "admin")
    )
  ).json();

  assert.deepEqual(explicit.filter, {
    exposureLevel: "all",
    label: "All",
    applied: false,
    scope: "in_app_eligible_users"
  });

  // N2: `all` never carries reporting metadata and is never suppressed.
  assert.equal(
    Object.prototype.hasOwnProperty.call(explicit.filter, "minimumStatisticN"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      explicit.filter,
      "statisticsSuppressed"
    ),
    false
  );

  for (const key of [
    "cohort",
    "awareness",
    "phishingIdentification",
    "trainingExposureDistribution",
    "relationships",
    "methodology"
  ]) {
    assert.deepEqual(explicit[key], omitted[key], `key ${key} must match`);
  }
});

test("a selected level carries reporting metadata and a derived label", async () => {
  const expectations = [
    { query: "0", exposureLevel: "0", label: "0%" },
    { query: "1", exposureLevel: "1", label: "33.3%" },
    { query: "2", exposureLevel: "2", label: "66.7%" },
    { query: "3", exposureLevel: "3", label: "100%" }
  ];

  for (const expectation of expectations) {
    const body = await (
      await get(
        `/api/research/analytics?exposureLevel=${expectation.query}`,
        authHeaders(ADMIN_ID, "admin")
      )
    ).json();

    assert.equal(body.filter.exposureLevel, expectation.exposureLevel);
    assert.equal(body.filter.label, expectation.label);
    assert.equal(body.filter.applied, true);
    assert.equal(body.filter.scope, "in_app_eligible_users");
    assert.equal(body.filter.minimumStatisticN, 5);

    // Never the canonical float, only the display label.
    assert.equal(String(expectation.label).includes("33.33"), false);
  }
});

// ---------------------------------------------------------------------------
// Filtering correctness
// ---------------------------------------------------------------------------

test("each exposure level selects exactly its own completed-module subset", async () => {
  const unfiltered = await (
    await get("/api/research/analytics", authHeaders(ADMIN_ID, "admin"))
  ).json();

  // Level sizes come from `buildStandardPopulation`: six users per level.
  // awareness = 40 + level*10 + index*5, phishing = 30 + level*12 + index*4,
  // for index 0 through 5. Every level therefore has valid n of 6, which is at
  // or above the reporting threshold, so nothing is suppressed here.
  const expectedCounts = { "0": 6, "1": 6, "2": 6, "3": 6 };
  const expectedAwarenessMeans = { "0": 52.5, "1": 62.5, "2": 72.5, "3": 82.5 };
  const expectedPhishingMeans = { "0": 40, "1": 52, "2": 64, "3": 76 };

  for (const level of ["0", "1", "2", "3"]) {
    const body = await (
      await get(
        `/api/research/analytics?exposureLevel=${level}`,
        authHeaders(ADMIN_ID, "admin")
      )
    ).json();

    assert.equal(body.cohort.totalEligibleParticipants, expectedCounts[level]);

    assert.equal(body.awareness.mean, expectedAwarenessMeans[level]);
    assert.equal(
      body.phishingIdentification.mean,
      expectedPhishingMeans[level]
    );

    // Distribution keeps all four canonical categories in fixed order.
    assert.deepEqual(
      body.trainingExposureDistribution.map((entry) => entry.trainingExposure),
      TRAINING_EXPOSURE_LEVELS
    );

    // Only the selected category is populated.
    const populated = body.trainingExposureDistribution.filter(
      (entry) => entry.count > 0
    );

    assert.equal(populated.length, 1);
    assert.equal(populated[0].trainingExposure, TRAINING_EXPOSURE_LEVELS[Number(level)]);

    // Sum invariant.
    const total = body.trainingExposureDistribution.reduce(
      (sum, entry) => sum + entry.count,
      0
    );

    assert.equal(total, body.cohort.totalEligibleParticipants);
    assert.ok(body.cohort.totalEligibleParticipants <= unfiltered.cohort.totalEligibleParticipants);
  }
});

test("a filtered response never widens the cohort and keeps counts honest", async () => {
  const unfiltered = await (
    await get("/api/research/analytics", authHeaders(ADMIN_ID, "admin"))
  ).json();

  const levelTotals = [];

  for (const level of ["0", "1", "2", "3"]) {
    const body = await (
      await get(
        `/api/research/analytics?exposureLevel=${level}`,
        authHeaders(ADMIN_ID, "admin")
      )
    ).json();

    assert.ok(
      body.cohort.totalEligibleParticipants <=
        unfiltered.cohort.totalEligibleParticipants
    );

    levelTotals.push(body.cohort.totalEligibleParticipants);
  }

  const sum = levelTotals.reduce((total, count) => total + count, 0);

  assert.deepEqual(levelTotals, [6, 6, 6, 6]);
  assert.equal(sum, 24);
  assert.equal(unfiltered.cohort.totalEligibleParticipants, 24);
});

test("repeated assessment attempts collapse to the latest attempt", async () => {
  // A dedicated fixture: one level-3 user submits twice, another once.
  const repeated = createUser();
  const single = createUser();

  const models = buildPopulation({
    users: [repeated, single],
    plan: [
      {
        user: repeated,
        exposure: 3,
        awarenessScore: 50,
        phishingScore: 60,
        repeatAwareness: true
      },
      {
        user: single,
        exposure: 3,
        awarenessScore: 70,
        phishingScore: 80
      }
    ]
  });

  const { summary } = await buildResearchAnalytics({
    ...models,
    exposureLevel: 3
  });

  // Two users, so n is 2 and the statistics are suppressed. The point of this
  // assertion is the COUNT: the repeated submitter is one participant, not two.
  assert.equal(summary.cohort.totalEligibleParticipants, 2);
  assert.equal(summary.awareness.n, 2);
  assert.equal(summary.awareness.mean, null);

  // Prove the latest attempt was the one kept, by inspecting the unsuppressed
  // summary for the same two users.
  const unsuppressed = buildResearchAnalyticsSummary(
    await buildResearchParticipantDataset(models)
  );

  assert.equal(unsuppressed.awareness.n, 2);
  assert.equal(unsuppressed.awareness.mean, 70);
  assert.equal(unsuppressed.awareness.max, 70);
});

// ---------------------------------------------------------------------------
// Fixed-exposure correlation behaviour
// ---------------------------------------------------------------------------

test("a selected exposure level never reports a correlation for exposure itself", async () => {
  // Exposure is constant within a selected level, so both exposure-related
  // coefficients are undefined by definition. This is checked directly through
  // the real service at several sample sizes, because the defect it guards
  // against only appeared from about n = 6 upward and only for the exposure
  // values that are not exactly representable in binary (33.33, and 66.67 at
  // some sizes). 0 and 100 were always correct.
  const expectations = [
    { level: 0, members: 6 },
    { level: 1, members: 6 },
    { level: 1, members: 10 },
    { level: 2, members: 6 },
    { level: 3, members: 6 }
  ];

  for (const { level, members } of expectations) {
    const users = [];
    const plan = [];

    for (let index = 0; index < members; index += 1) {
      const user = createUser();
      users.push(user);
      plan.push({
        user,
        exposure: level,
        awarenessScore: 40 + index * 5,
        phishingScore: 50 + index * 4
      });
    }

    const models = buildPopulation({ users, plan });

    const { summary } = await buildResearchAnalytics({
      ...models,
      exposureLevel: level
    });

    assert.equal(summary.cohort.totalEligibleParticipants, members);

    for (const key of [
      "trainingExposureAwareness",
      "trainingExposurePhishingIdentification"
    ]) {
      assert.equal(
        summary.relationships[key].r,
        null,
        `${key} at level ${level} with n=${members} must be null`
      );
    }

    // Constant exposure must not suppress a genuinely varying relationship.
    assert.equal(typeof summary.relationships.awarenessPhishingIdentification.r, "number");
  }
});

test("a fixed exposure level reports unavailable, never zero, exposure correlations", async () => {
  // Regression test for the Pearson zero-variance defect found during Gate 1.
  //
  // `computePearsonCorrelation` guarded the zero-variance case with an exact
  // `denominator === 0` test. For six or more identical exposure values the
  // running mean does not round-trip, the accumulated variance was a residue of
  // roughly 3e-28 rather than exactly zero, the guard was skipped, and a
  // fabricated `r: 0` was reported where the honest answer is `null`.
  //
  // The filter made this routine: every selected exposure level with enough
  // members hit it. It was already reachable before the filter, whenever every
  // eligible user happened to share one exposure level.
  for (const level of ["0", "1", "2", "3"]) {
    const body = await (
      await get(
        `/api/research/analytics?exposureLevel=${level}`,
        authHeaders(ADMIN_ID, "admin")
      )
    ).json();

    for (const key of [
      "trainingExposureAwareness",
      "trainingExposurePhishingIdentification"
    ]) {
      assert.equal(
        body.relationships[key].r,
        null,
        `${key} at level ${level} must be null, never 0`
      );
    }

    // The non-exposure relationship is a genuine, reportable computation and
    // must not be suppressed by the constancy check.
    assert.equal(typeof body.relationships.awarenessPhishingIdentification.r, "number");
    assert.ok(Math.abs(body.relationships.awarenessPhishingIdentification.r) <= 1);
  }
});

// ---------------------------------------------------------------------------
// Per-metric suppression (spec section 5.1, notes N1 and N2)
// ---------------------------------------------------------------------------

test("n of zero is reported as no observations, never as suppressed", async () => {
  const user = createUser();
  const models = buildPopulation({
    users: [user],
    plan: [
      {
        user,
        exposure: 2,
        awarenessScore: null,
        phishingScore: null
      }
    ]
  });

  const { summary, statisticsSuppressed } = await buildResearchAnalytics({
    ...models,
    exposureLevel: 2
  });

  // n is 0 and the statistics layer already produced nulls. N1: this is a
  // fact, so nothing is suppressed and the flag stays false.
  assert.equal(summary.awareness.n, 0);
  assert.equal(summary.awareness.mean, null);
  assert.equal(summary.phishingIdentification.n, 0);
  assert.equal(statisticsSuppressed, false);

  for (const relationship of Object.values(summary.relationships)) {
    assert.equal(relationship.r, null);
  }
});

test("valid n between one and four suppresses the values but preserves n", async () => {
  for (const validN of [1, 2, 3, 4]) {
    const users = [];
    const plan = [];

    for (let index = 0; index < validN; index += 1) {
      const user = createUser();
      users.push(user);
      plan.push({
        user,
        exposure: 1,
        awarenessScore: 50 + index,
        phishingScore: 60 + index
      });
    }

    // Untrained filler members raise the cohort size above the threshold so
    // the test proves suppression follows valid n, not headcount.
    for (let index = 0; index < 6; index += 1) {
      const user = createUser();
      users.push(user);
      plan.push({
        user,
        exposure: 1,
        awarenessScore: null,
        phishingScore: null
      });
    }

    const models = buildPopulation({ users, plan });

    const result = await buildResearchAnalytics({
      ...models,
      exposureLevel: 1
    });

    assert.equal(result.summary.cohort.totalEligibleParticipants, validN + 6);
    assert.ok(result.summary.cohort.totalEligibleParticipants >= 5);

    assert.equal(result.summary.awareness.n, validN);
    assert.equal(result.summary.awareness.mean, null);
    assert.equal(result.summary.awareness.median, null);
    assert.equal(result.summary.awareness.min, null);
    assert.equal(result.summary.awareness.max, null);

    assert.equal(result.summary.phishingIdentification.n, validN);
    assert.equal(result.summary.phishingIdentification.mean, null);

    for (const relationship of Object.values(result.summary.relationships)) {
      assert.equal(relationship.n, validN);
      assert.equal(relationship.r, null);
    }

    assert.equal(result.statisticsSuppressed, true);
    assert.equal(result.minimumStatisticN, MINIMUM_REPORTABLE_OBSERVATIONS);
  }
});

test("valid n of five or more keeps every statistic intact", async () => {
  const users = [];
  const plan = [];

  for (let index = 0; index < 5; index += 1) {
    const user = createUser();
    users.push(user);
    plan.push({
      user,
      exposure: 3,
      awarenessScore: 40 + index * 10,
      phishingScore: 50 + index * 8
    });
  }

  const models = buildPopulation({ users, plan });

  const result = await buildResearchAnalytics({
    ...models,
    exposureLevel: 3
  });

  assert.equal(result.summary.awareness.n, 5);
  assert.equal(result.summary.awareness.mean, 60);
  assert.equal(result.summary.awareness.min, 40);
  assert.equal(result.summary.awareness.max, 80);
  assert.equal(result.summary.phishingIdentification.mean, 66);
  assert.equal(result.statisticsSuppressed, false);

  // Both exposure correlations are still undefined, because exposure itself is
  // constant. That is a fact about the data, not a suppression.
  assert.equal(result.summary.relationships.trainingExposureAwareness.r, null);
  assert.equal(result.summary.relationships.awarenessPhishingIdentification.r, 1);
});

test("suppression is per metric, never all-or-nothing", async () => {
  // Six members at level 2: five have awareness, only two have phishing
  // identification. Awareness must survive; phishing identification must not.
  const users = [];
  const plan = [];

  for (let index = 0; index < 6; index += 1) {
    const user = createUser();
    users.push(user);
    plan.push({
      user,
      exposure: 2,
      awarenessScore: 40 + index * 5,
      phishingScore: index < 2 ? 50 + index * 5 : null
    });
  }

  const models = buildPopulation({ users, plan });

  const result = await buildResearchAnalytics({
    ...models,
    exposureLevel: 2
  });

  assert.equal(result.summary.awareness.n, 6);
  assert.equal(result.summary.awareness.mean, 52.5);

  assert.equal(result.summary.phishingIdentification.n, 2);
  assert.equal(result.summary.phishingIdentification.mean, null);
  assert.equal(result.summary.phishingIdentification.n, 2);

  assert.equal(result.statisticsSuppressed, true);
});

test("the suppression helper never mutates its input", () => {
  const original = buildResearchAnalyticsSummary([
    {
      participantId: "PG-R0001",
      awarenessScore: 50,
      awarenessCompletedAt: null,
      phishingIdentificationScore: 40,
      phishingIdentificationCompletedAt: null,
      completedTrainingModules: 2,
      trainingExposure: 66.67
    }
  ]);

  const snapshot = JSON.parse(JSON.stringify(original));

  const { summary, statisticsSuppressed } = applySmallCohortSuppression(original);

  assert.deepEqual(original, snapshot);
  assert.equal(statisticsSuppressed, true);
  assert.equal(summary.awareness.n, 1);
  assert.equal(summary.awareness.mean, null);
});

test("the one-argument summary behavior is unchanged for small fixtures", () => {
  const participants = [
    {
      participantId: "PG-R0001",
      awarenessScore: 80,
      awarenessCompletedAt: null,
      phishingIdentificationScore: 90,
      phishingIdentificationCompletedAt: null,
      completedTrainingModules: 3,
      trainingExposure: 100
    },
    {
      participantId: "PG-R0002",
      awarenessScore: 40,
      awarenessCompletedAt: null,
      phishingIdentificationScore: null,
      phishingIdentificationCompletedAt: null,
      completedTrainingModules: 1,
      trainingExposure: 33.33
    },
    {
      participantId: "PG-R0003",
      awarenessScore: null,
      awarenessCompletedAt: null,
      phishingIdentificationScore: null,
      phishingIdentificationCompletedAt: null,
      completedTrainingModules: 0,
      trainingExposure: 0
    },
    {
      participantId: "PG-R0004",
      awarenessScore: 60,
      awarenessCompletedAt: null,
      phishingIdentificationScore: 50,
      phishingIdentificationCompletedAt: null,
      completedTrainingModules: 2,
      trainingExposure: 66.67
    }
  ];

  const summary = buildResearchAnalyticsSummary(participants);

  // These are the exact values the pre-existing pinned tests assert.
  assert.deepEqual(summary.awareness, {
    n: 3,
    mean: 60,
    median: 60,
    min: 40,
    max: 80
  });
  assert.equal(summary.cohort.totalEligibleParticipants, 4);
});

// ---------------------------------------------------------------------------
// Empty cohort and serialization safety
// ---------------------------------------------------------------------------

test("an empty filtered cohort is a valid, non-throwing zero state", async () => {
  const emptyModels = buildHarness({
    users: [],
    awareness: [],
    phishing: [],
    training: []
  });

  const result = await buildResearchAnalytics({
    ...emptyModels,
    exposureLevel: 2
  });

  assert.equal(result.summary.cohort.totalEligibleParticipants, 0);
  assert.equal(result.summary.awareness.n, 0);
  assert.equal(result.summary.awareness.mean, null);
  assert.equal(result.summary.phishingIdentification.mean, null);

  for (const relationship of Object.values(result.summary.relationships)) {
    assert.equal(relationship.r, null);
  }

  // Every canonical category is still present with a zero count.
  assert.deepEqual(
    result.summary.trainingExposureDistribution,
    TRAINING_EXPOSURE_LEVELS.map((level) => ({
      trainingExposure: level,
      count: 0
    }))
  );

  // n = 0 is not a suppression.
  assert.equal(result.statisticsSuppressed, false);
});

for (const level of ["0", "1", "2", "3"]) {
  test(`a filtered response at level ${level} never serializes NaN or Infinity`, async () => {
    const response = await get(
      `/api/research/analytics?exposureLevel=${level}`,
      authHeaders(ADMIN_ID, "admin")
    );

    const text = await response.text();

    assert.equal(text.includes("NaN"), false);
    assert.equal(text.includes("Infinity"), false);
    assert.equal(text.includes("undefined"), false);
    assert.equal(text.includes("null"), true);
  });
}

// ---------------------------------------------------------------------------
// Label derivation and filter helper
// ---------------------------------------------------------------------------

test("display labels are derived from the canonical level list", () => {
  assert.equal(getTrainingExposureLabelForLevel(0), "0%");
  assert.equal(getTrainingExposureLabelForLevel(1), "33.3%");
  assert.equal(getTrainingExposureLabelForLevel(2), "66.7%");
  assert.equal(getTrainingExposureLabelForLevel(3), "100%");
  assert.equal(getTrainingExposureLabelForLevel(4), null);
  assert.equal(getTrainingExposureLabelForLevel(-1), null);
  assert.equal(getTrainingExposureLabelForLevel(null), null);

  // The canonical percentages themselves are untouched.
  assert.deepEqual(TRAINING_EXPOSURE_LEVELS, [0, 33.33, 66.67, 100]);
});

test("the filter helper selects by completed-module count and tolerates no filter", () => {
  const participants = [
    { completedTrainingModules: 0 },
    { completedTrainingModules: 1 },
    { completedTrainingModules: 1 },
    { completedTrainingModules: 3 }
  ];

  assert.equal(filterParticipantsByExposureLevel(participants, null).length, 4);
  assert.equal(filterParticipantsByExposureLevel(participants, undefined).length, 4);
  assert.equal(filterParticipantsByExposureLevel(participants, 1).length, 2);
  assert.equal(filterParticipantsByExposureLevel(participants, 2).length, 0);
  assert.equal(filterParticipantsByExposureLevel(participants, 3).length, 1);
  assert.deepEqual(filterParticipantsByExposureLevel(null, 1), []);
});

test("the validator exposes the constant used by the response envelope", () => {
  assert.equal(EXPOSURE_LEVEL_ALL, "all");
  assert.equal(typeof validateAnalyticsQuery, "function");
});

// ---------------------------------------------------------------------------
// No identity leakage on any filtered path
// ---------------------------------------------------------------------------

test("no filtered response leaks participant identity", async () => {
  for (const level of ["0", "1", "2", "3"]) {
    const response = await get(
      `/api/research/analytics?exposureLevel=${level}`,
      authHeaders(ADMIN_ID, "admin")
    );

    const text = await response.text();

    assert.equal(
      Object.prototype.hasOwnProperty.call(JSON.parse(text), "participants"),
      false
    );

    for (const forbidden of [
      "PG-R",
      "@example.invalid",
      "password",
      String(ADMIN_ID)
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `level ${level} must not contain ${forbidden}`
      );
    }
  }
});
