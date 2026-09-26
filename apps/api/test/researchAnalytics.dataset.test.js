const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  RESEARCH_ANALYTICS_METHODOLOGY,
  TRAINING_EXPOSURE_LEVELS,
  buildResearchAnalytics,
  buildResearchAnalyticsSummary,
  buildResearchParticipantDataset,
  formatParticipantId,
  isEligibleResearchUser
} = require("../src/services/researchAnalytics.dataset");
const {
  calculateTrainingExposure
} = require("../src/services/training.service");

// Minimal in-memory stand-in for the authoritative Mongoose models. It really
// applies the filter and the sort so the deterministic ordering guarantees of
// the dataset are exercised rather than assumed.
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

    if (condition !== null && typeof condition === "object" &&
      !Array.isArray(condition) && !(condition instanceof Date)) {
      const entries = Object.entries(condition);

      if (entries.length > 0 && entries.every(([key]) => key.startsWith("$"))) {
        return entries.every(([operator, operand]) => {
          const stored = document[field];

          if (operator === "$gt") {
            return stored > operand;
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

function compareIds(left, right) {
  return String(left).localeCompare(String(right));
}

function compareValues(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (typeof left === "object" && left !== null &&
    typeof right === "object" && right !== null) {
    return compareIds(left, right);
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
  const state = {
    filters: [],
    sorts: [],
    selects: []
  };

  const model = {
    state,

    find(filter) {
      state.filters.push(filter);

      let matched = documents;

      if (applyFilter) {
        matched = matched.filter((document) =>
          matchesFilter(document, filter)
        );
      }

      const query = {
        select(projection) {
          state.selects.push(projection);
          return query;
        },

        sort(sortSpec) {
          state.sorts.push(sortSpec);
          matched = applySort(matched, sortSpec);
          return query;
        },

        lean() {
          return query;
        },

        then(onFulfilled, onRejected) {
          return Promise.resolve(matched).then(onFulfilled, onRejected);
        }
      };

      return query;
    }
  };

  return model;
}

function createUser({
  id = new mongoose.Types.ObjectId(),
  name = "Research Participant",
  email = "participant@example.invalid",
  password = "bcrypt-hash-placeholder",
  role = "user",
  isActive = true,
  createdAt = new Date("2026-01-01T00:00:00.000Z"),
  passwordResetTokenHash = null,
  passwordResetExpiresAt = null
} = {}) {
  return {
    _id: id,
    name,
    email,
    password,
    role,
    isActive,
    createdAt,
    passwordResetTokenHash,
    passwordResetExpiresAt
  };
}

function createAwareness({
  id = new mongoose.Types.ObjectId(),
  user,
  score,
  completedAt = new Date("2026-01-01T00:00:00.000Z")
} = {}) {
  return { _id: id, user, score, completedAt };
}

function createTrainingCompletion({
  user,
  moduleId,
  completedAt = new Date("2026-01-01T00:00:00.000Z")
} = {}) {
  return { _id: new mongoose.Types.ObjectId(), user, moduleId, completedAt };
}

function buildHarness({ users = [], awareness = [], phishing = [], training = [], applyUserFilter = true } = {}) {
  const userModel = createFakeModel(users, { applyFilter: applyUserFilter });
  const awarenessModel = createFakeModel(awareness);
  const phishingModel = createFakeModel(phishing);
  const trainingModel = createFakeModel(training);

  return {
    models: {
      userModel,
      awarenessModel,
      phishingIdentificationModel: phishingModel,
      trainingCompletionModel: trainingModel
    },
    userModel,
    awarenessModel,
    phishingModel,
    trainingModel
  };
}

test("only active user accounts are eligible", async () => {
  const staff = createUser({ role: "staff" });
  const admin = createUser({ role: "admin" });
  const inactive = createUser({ isActive: false });
  const inactiveStaff = createUser({ role: "staff", isActive: false });
  const eligible = createUser();

  const harness = buildHarness({ users: [staff, admin, inactive, inactiveStaff, eligible] });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].participantId, "PG-R0001");

  assert.deepEqual(harness.userModel.state.filters, [
    { role: "user", isActive: true }
  ]);
  assert.equal(isEligibleResearchUser(eligible), true);
  assert.equal(isEligibleResearchUser(staff), false);
  assert.equal(isEligibleResearchUser(admin), false);
  assert.equal(isEligibleResearchUser(inactive), false);
});

test("eligibility is re-checked server-side even if a query returns extra accounts", async () => {
  const staff = createUser({ role: "staff" });
  const admin = createUser({ role: "admin" });
  const inactive = createUser({ isActive: false });
  const eligible = createUser();

  const harness = buildHarness({
    users: [staff, admin, inactive, eligible],
    applyUserFilter: false
  });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].participantId, "PG-R0001");
});

test("participants are ordered by createdAt then _id with pseudonymous ids", async () => {
  const second = createUser({ createdAt: new Date("2026-02-01T00:00:00.000Z") });
  const first = createUser({ createdAt: new Date("2026-01-01T00:00:00.000Z") });
  const tieB = createUser({ createdAt: new Date("2026-01-01T00:00:00.000Z") });
  const tieA = createUser({ createdAt: new Date("2026-01-01T00:00:00.000Z") });

  const harness = buildHarness({ users: [second, first, tieB, tieA] });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.deepEqual(
    participants.map((participant) => participant.participantId),
    ["PG-R0001", "PG-R0002", "PG-R0003", "PG-R0004"]
  );

  assert.deepEqual(
    harness.userModel.state.sorts,
    [{ createdAt: 1, _id: 1 }]
  );

  // Repeat construction over the same population is stable.
  const repeated = await buildResearchParticipantDataset(harness.models);

  assert.deepEqual(
    repeated.map((participant) => participant.participantId),
    participants.map((participant) => participant.participantId)
  );

  assert.equal(formatParticipantId(0), "PG-R0001");
  assert.equal(formatParticipantId(9), "PG-R0010");
  assert.equal(formatParticipantId(1233), "PG-R1234");
});

test("the latest awareness attempt is selected with deterministic tie-breaking", async () => {
  const user = createUser();

  const olderId = new mongoose.Types.ObjectId("000000000000000000000001");
  const newerId = new mongoose.Types.ObjectId("000000000000000000000002");
  const tieLowerId = new mongoose.Types.ObjectId("00000000000000000000000a");
  const tieHigherId = new mongoose.Types.ObjectId("00000000000000000000000b");

  const sameInstant = new Date("2026-03-01T12:00:00.000Z");

  const harness = buildHarness({
    users: [user],
    awareness: [
      createAwareness({ id: olderId, user: user._id, score: 10, completedAt: new Date("2026-01-01T00:00:00.000Z") }),
      createAwareness({ id: newerId, user: user._id, score: 90, completedAt: new Date("2026-05-01T00:00:00.000Z") }),
      createAwareness({ id: tieHigherId, user: user._id, score: 70, completedAt: sameInstant }),
      createAwareness({ id: tieLowerId, user: user._id, score: 30, completedAt: sameInstant })
    ]
  });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.equal(participants[0].awarenessScore, 90);
  assert.equal(
    participants[0].awarenessCompletedAt.toISOString(),
    "2026-05-01T00:00:00.000Z"
  );
  assert.deepEqual(harness.awarenessModel.state.sorts, [
    { completedAt: -1, _id: -1 }
  ]);

  const tieHarness = buildHarness({
    users: [user],
    awareness: [
      createAwareness({ id: tieLowerId, user: user._id, score: 30, completedAt: sameInstant }),
      createAwareness({ id: tieHigherId, user: user._id, score: 70, completedAt: sameInstant })
    ]
  });

  const tieParticipants = await buildResearchParticipantDataset(tieHarness.models);

  assert.equal(tieParticipants[0].awarenessScore, 70);
});

test("the latest phishing identification attempt is selected deterministically", async () => {
  const user = createUser();
  const sameInstant = new Date("2026-04-01T09:00:00.000Z");

  const harness = buildHarness({
    users: [user],
    phishing: [
      createAwareness({ id: new mongoose.Types.ObjectId("000000000000000000000030"), user: user._id, score: 95, completedAt: sameInstant }),
      createAwareness({ id: new mongoose.Types.ObjectId("00000000000000000000002f"), user: user._id, score: 40, completedAt: sameInstant }),
      createAwareness({ id: new mongoose.Types.ObjectId("000000000000000000000010"), user: user._id, score: 55, completedAt: new Date("2026-01-01T00:00:00.000Z") })
    ]
  });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.equal(participants[0].phishingIdentificationScore, 95);
  assert.deepEqual(harness.phishingModel.state.sorts, [
    { completedAt: -1, _id: -1 }
  ]);
});

test("missing assessment data stays null while training exposure 0 is measured", async () => {
  const harness = buildHarness({ users: [createUser()] });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.equal(participants[0].awarenessScore, null);
  assert.equal(participants[0].awarenessCompletedAt, null);
  assert.equal(participants[0].phishingIdentificationScore, null);
  assert.equal(participants[0].phishingIdentificationCompletedAt, null);
  assert.equal(participants[0].completedTrainingModules, 0);
  assert.equal(participants[0].trainingExposure, 0);
});

test("training exposure matches Training V1 values", async () => {
  const zero = createUser();
  const one = createUser();
  const two = createUser();
  const three = createUser();
  const duplicate = createUser();

  const harness = buildHarness({
    users: [zero, one, two, three, duplicate],
    training: [
      createTrainingCompletion({ user: one._id, moduleId: 1 }),
      createTrainingCompletion({ user: two._id, moduleId: 1 }),
      createTrainingCompletion({ user: two._id, moduleId: 2 }),
      createTrainingCompletion({ user: three._id, moduleId: 1 }),
      createTrainingCompletion({ user: three._id, moduleId: 2 }),
      createTrainingCompletion({ user: three._id, moduleId: 3 }),
      // Repeated completion of the same module must not be double counted.
      createTrainingCompletion({ user: duplicate._id, moduleId: 2 }),
      createTrainingCompletion({ user: duplicate._id, moduleId: 2 })
    ]
  });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.deepEqual(
    participants.map((participant) => participant.trainingExposure),
    [0, 33.33, 66.67, 100, 33.33]
  );
  assert.deepEqual(
    participants.map((participant) => participant.completedTrainingModules),
    [0, 1, 2, 3, 1]
  );

  assert.deepEqual(TRAINING_EXPOSURE_LEVELS, [0, 33.33, 66.67, 100]);
  assert.equal(calculateTrainingExposure(1), 33.33);
  assert.equal(calculateTrainingExposure(2), 66.67);
});

test("participant records contain only the research contract fields", async () => {
  const user = createUser({
    name: "Direct Identifier",
    email: "direct.identifier@example.invalid",
    password: "bcrypt-hash-placeholder",
    passwordResetTokenHash: "reset-hash-value",
    passwordResetExpiresAt: new Date("2026-06-01T00:00:00.000Z")
  });

  const harness = buildHarness({
    users: [user],
    awareness: [createAwareness({ user: user._id, score: 80 })],
    training: [
      createTrainingCompletion({ user: user._id, moduleId: 1 }),
      createTrainingCompletion({ user: user._id, moduleId: 2 }),
      createTrainingCompletion({ user: user._id, moduleId: 3 })
    ]
  });

  const participants = await buildResearchParticipantDataset(harness.models);
  const [participant] = participants;

  assert.deepEqual(Object.keys(participant).sort(), [
    "awarenessCompletedAt",
    "awarenessScore",
    "completedTrainingModules",
    "participantId",
    "phishingIdentificationCompletedAt",
    "phishingIdentificationScore",
    "trainingExposure"
  ]);

  const serialized = JSON.stringify(participant);

  for (const forbidden of [
    "Direct Identifier",
    "direct.identifier@example.invalid",
    "bcrypt-hash-placeholder",
    "reset-hash-value",
    "passwordReset",
    "analysis",
    "report",
    "url",
    String(user._id)
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Participant record must not expose ${forbidden}`
    );
  }

  assert.equal(participant.trainingExposure, 100);
  assert.equal(participant.completedTrainingModules, 3);
});

test("an empty eligible population produces an empty dataset", async () => {
  const harness = buildHarness({
    users: [createUser({ role: "admin" })]
  });

  const participants = await buildResearchParticipantDataset(harness.models);

  assert.deepEqual(participants, []);
  assert.equal(harness.awarenessModel.state.filters.length, 0);
  assert.equal(harness.trainingModel.state.filters.length, 0);
});

test("aggregate analytics report cohort counts and the training distribution", () => {
  const complete = createParticipant({
    awarenessScore: 80,
    phishingIdentificationScore: 90,
    trainingExposure: 100,
    completedTrainingModules: 3
  });
  const partial = createParticipant({
    awarenessScore: 40,
    phishingIdentificationScore: null,
    trainingExposure: 33.33,
    completedTrainingModules: 1
  });
  const untrained = createParticipant({
    awarenessScore: null,
    phishingIdentificationScore: null,
    trainingExposure: 0,
    completedTrainingModules: 0
  });
  const twoModules = createParticipant({
    awarenessScore: 60,
    phishingIdentificationScore: 50,
    trainingExposure: 66.67,
    completedTrainingModules: 2
  });

  const summary = buildResearchAnalyticsSummary([
    complete,
    partial,
    untrained,
    twoModules
  ]);

  assert.deepEqual(summary.cohort, {
    totalEligibleParticipants: 4,
    participantsWithAwareness: 3,
    participantsWithPhishingIdentification: 2,
    participantsWithTrainingExposure: 3,
    participantsWithFullTrainingExposure: 1,
    participantsWithAllVariables: 2
  });

  assert.deepEqual(summary.trainingExposureDistribution, [
    { trainingExposure: 0, count: 1 },
    { trainingExposure: 33.33, count: 1 },
    { trainingExposure: 66.67, count: 1 },
    { trainingExposure: 100, count: 1 }
  ]);

  const distributionTotal = summary.trainingExposureDistribution.reduce(
    (total, level) => total + level.count,
    0
  );

  assert.equal(
    distributionTotal,
    summary.cohort.totalEligibleParticipants
  );

  assert.deepEqual(summary.awareness, {
    n: 3,
    mean: 60,
    median: 60,
    min: 40,
    max: 80
  });

  assert.deepEqual(summary.phishingIdentification, {
    n: 2,
    mean: 70,
    median: 70,
    min: 50,
    max: 90
  });
});

test("aggregate analytics report all three required relationships", () => {
  const participants = [
    createParticipant({
      awarenessScore: 10,
      phishingIdentificationScore: 10,
      trainingExposure: 0,
      completedTrainingModules: 0
    }),
    createParticipant({
      awarenessScore: 20,
      phishingIdentificationScore: 20,
      trainingExposure: 33.33,
      completedTrainingModules: 1
    }),
    createParticipant({
      awarenessScore: 30,
      phishingIdentificationScore: 30,
      trainingExposure: 66.67,
      completedTrainingModules: 2
    }),
    createParticipant({
      awarenessScore: 40,
      phishingIdentificationScore: 40,
      trainingExposure: 100,
      completedTrainingModules: 3
    })
  ];

  const summary = buildResearchAnalyticsSummary(participants);

  assert.deepEqual(summary.relationships.awarenessPhishingIdentification, {
    variables: ["awarenessScore", "phishingIdentificationScore"],
    n: 4,
    r: 1
  });
  assert.deepEqual(
    summary.relationships.trainingExposureAwareness.variables,
    ["trainingExposure", "awarenessScore"]
  );
  assert.deepEqual(
    summary.relationships.trainingExposurePhishingIdentification
      .variables,
    ["trainingExposure", "phishingIdentificationScore"]
  );

  for (const relationship of Object.values(summary.relationships)) {
    assert.equal(relationship.n, 4);
    assert.equal(Number.isFinite(relationship.r), true);
    assert.equal(relationship.r > 0.9, true);

    for (const forbiddenField of [
      "label",
      "strength",
      "interpretation",
      "significant"
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          relationship,
          forbiddenField
        ),
        false
      );
    }
  }
});

test("relationships use pairwise complete observations and stay nullable", () => {
  const participants = [
    createParticipant({
      awarenessScore: 10,
      phishingIdentificationScore: null,
      trainingExposure: 0
    }),
    createParticipant({
      awarenessScore: 20,
      phishingIdentificationScore: 30,
      trainingExposure: 0
    }),
    createParticipant({
      awarenessScore: 30,
      phishingIdentificationScore: 40,
      trainingExposure: 0
    })
  ];

  const summary = buildResearchAnalyticsSummary(participants);

  assert.equal(
    summary.relationships.awarenessPhishingIdentification.n,
    2
  );
  assert.equal(
    summary.relationships.trainingExposureAwareness.n,
    3
  );
  // Training Exposure has zero variance here, so r is undefined.
  assert.equal(summary.relationships.trainingExposureAwareness.r, null);
  assert.equal(
    summary.relationships
      .trainingExposurePhishingIdentification.r,
    null
  );

  const emptySummary = buildResearchAnalyticsSummary([]);

  assert.deepEqual(emptySummary.cohort, {
    totalEligibleParticipants: 0,
    participantsWithAwareness: 0,
    participantsWithPhishingIdentification: 0,
    participantsWithTrainingExposure: 0,
    participantsWithFullTrainingExposure: 0,
    participantsWithAllVariables: 0
  });
  assert.deepEqual(emptySummary.awareness, {
    n: 0,
    mean: null,
    median: null,
    min: null,
    max: null
  });
  assert.deepEqual(
    emptySummary.relationships.awarenessPhishingIdentification,
    {
      variables: ["awarenessScore", "phishingIdentificationScore"],
      n: 0,
      r: null
    }
  );
});

test("aggregate analytics stay free of participant identifiers", () => {
  const summary = buildResearchAnalyticsSummary([
    createParticipant({
      participantId: "PG-R0001",
      awarenessScore: 50,
      phishingIdentificationScore: 50,
      trainingExposure: 33.33
    })
  ]);

  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes("PG-R0001"), false);
  assert.equal(serialized.includes("@"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(summary, "participants"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(summary, "methodology"),
    true
  );
});

test("buildResearchAnalytics returns the dataset and its aggregate summary", async () => {
  const user = createUser();

  const harness = buildHarness({
    users: [user],
    awareness: [createAwareness({ user: user._id, score: 75 })],
    phishing: [createAwareness({ user: user._id, score: 85 })],
    training: [createTrainingCompletion({ user: user._id, moduleId: 1 })]
  });

  const result = await buildResearchAnalytics(harness.models);

  assert.equal(result.participants.length, 1);
  assert.equal(result.participants[0].participantId, "PG-R0001");
  assert.equal(result.summary.cohort.totalEligibleParticipants, 1);
  assert.equal(result.summary.cohort.participantsWithAllVariables, 1);
  assert.equal(result.summary.awareness.n, 1);
  assert.equal(result.summary.phishingIdentification.n, 1);
  assert.equal(
    result.summary.trainingExposureDistribution[1].count,
    1
  );
});

test("methodology metadata explains the rules without causal claims", () => {
  const serialized = JSON.stringify(
    RESEARCH_ANALYTICS_METHODOLOGY
  ).toLowerCase();

  assert.equal(
    RESEARCH_ANALYTICS_METHODOLOGY.trainingExposureLevels.join(","),
    "0,33.33,66.67,100"
  );
  assert.equal(
    serialized.includes("association does not establish causation"),
    true
  );

  for (const forbidden of [
    "strong",
    "moderate",
    "weak correlation",
    "significant",
    "proves",
    "causes"
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Methodology must not claim ${forbidden}`
    );
  }
});

function createParticipant(overrides = {}) {
  return {
    participantId: "PG-R0001",
    awarenessScore: null,
    awarenessCompletedAt: null,
    phishingIdentificationScore: null,
    phishingIdentificationCompletedAt: null,
    completedTrainingModules: 0,
    trainingExposure: 0,
    ...overrides
  };
}
