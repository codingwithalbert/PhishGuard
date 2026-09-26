const AwarenessAssessment = require("../models/AwarenessAssessment");
const PhishingIdentificationAssessment =
  require("../models/PhishingIdentificationAssessment");
const TrainingCompletion = require("../models/TrainingCompletion");
const User = require("../models/User");
const {
  calculateTrainingExposure,
  getTrainingModuleIds
} = require("./training.service");
const {
  computeDescriptiveStatistics,
  computePearsonCorrelation,
  isFiniteNumber
} = require("./researchAnalytics.statistics");

// Research Analytics V1 dataset and statistics layer (spec 3, 4, 5, 6, 7, 8,
// 9, 10, 11, and 12).
//
// The dataset is derived from the existing authoritative collections. Nothing
// is persisted: participant identifiers are transient, and a participant record
// carries only the research variables the frozen contract requires.
// Authoritative Training V1 module identifiers, reused rather than redefined.
const TRAINING_MODULE_IDS = getTrainingModuleIds();
const TRAINING_MODULE_ID_SET = new Set(TRAINING_MODULE_IDS);

const RESEARCH_PARTICIPANT_ROLE = "user";
const PARTICIPANT_ID_PREFIX = "PG-R";
const PARTICIPANT_ID_DIGITS = 4;
const TRAINING_EXPOSURE_LEVELS = Object.freeze([
  0, 33.33, 66.67, 100
]);
const FULL_TRAINING_EXPOSURE = 100;

// Spec 4.1 and 4.2 reuse the ordering already used by the assessment and
// progress services: completedAt descending, then _id descending.
const LATEST_ATTEMPT_SORT = Object.freeze({
  completedAt: -1,
  _id: -1
});

// Spec 12: deterministic participant ordering.
const PARTICIPANT_ORDER_SORT = Object.freeze({
  createdAt: 1,
  _id: 1
});

const RESEARCH_ANALYTICS_METHODOLOGY = Object.freeze({
  population:
    "Active PhishGuard accounts with the user role. Staff, admin, and inactive accounts are excluded.",
  variables: Object.freeze([
    "awarenessScore",
    "phishingIdentificationScore",
    "trainingExposure"
  ]),
  latestAttemptRule:
    "The latest completed attempt is used: completedAt descending, then _id descending as a deterministic tie-breaker.",
  trainingExposureRule:
    "Training Exposure is the authoritative Training V1 value: completed modules out of three, expressed as a percentage rounded to two decimals.",
  trainingExposureLevels: TRAINING_EXPOSURE_LEVELS,
  participantIdRule:
    "Transient pseudonymous identifiers assigned in deterministic participant order and used only for research dataset organization.",
  missingDataRule:
    "Assessment variables are null when never completed. Training Exposure of 0 is a measured value, not missing data.",
  statisticsRule:
    "Descriptive statistics and pairwise associations use only participants with available values for the variable or relationship.",
  relationshipRule:
    "Pearson correlation is reported with its sample size and is null when it is not mathematically defined. No qualitative strength label is assigned.",
  interpretationRule:
    "Results are descriptive and exploratory. Association does not establish causation."
});

function formatParticipantId(index) {
  return `${PARTICIPANT_ID_PREFIX}${String(
    index + 1
  ).padStart(PARTICIPANT_ID_DIGITS, "0")}`;
}

function isEligibleResearchUser(user) {
  return (
    user?.role === RESEARCH_PARTICIPANT_ROLE &&
    user?.isActive === true
  );
}

function normalizeId(value) {
  return value === undefined || value === null
    ? null
    : String(value);
}

function resolveUserId(user) {
  return normalizeId(user?._id ?? user?.id);
}

// Assessment and training documents reference their owner through `user`, so
// their own `_id` must never be used as the participant key.
function resolveOwnerId(document) {
  return normalizeId(document?.user);
}

function indexByOwnerId(documents) {
  const byUserId = new Map();

  for (const document of documents) {
    const userId = resolveOwnerId(document);

    if (userId !== null && !byUserId.has(userId)) {
      byUserId.set(userId, document);
    }
  }

  return byUserId;
}

function selectLatestByUser(documents) {
  // The query already returns documents in the deterministic latest-attempt
  // order, so the first document per participant is the latest attempt.
  return indexByOwnerId(documents);
}

function countCompletedModulesByUser(completions) {
  const moduleIdsByUser = new Map();

  for (const completion of completions) {
    const userId = resolveOwnerId(completion);
    const { moduleId } = completion;

    if (userId === null || !TRAINING_MODULE_ID_SET.has(moduleId)) {
      continue;
    }

    if (!moduleIdsByUser.has(userId)) {
      moduleIdsByUser.set(userId, new Set());
    }

    moduleIdsByUser.get(userId).add(moduleId);
  }

  const completedByUser = new Map();

  for (const [userId, moduleIds] of moduleIdsByUser) {
    completedByUser.set(userId, moduleIds.size);
  }

  return completedByUser;
}

function createParticipantRecord({
  index,
  awarenessAttempt,
  phishingIdentificationAttempt,
  completedTrainingModules
}) {
  return {
    participantId: formatParticipantId(index),
    awarenessScore: isFiniteNumber(awarenessAttempt?.score)
      ? awarenessAttempt.score
      : null,
    awarenessCompletedAt: awarenessAttempt?.completedAt ?? null,
    phishingIdentificationScore: isFiniteNumber(
      phishingIdentificationAttempt?.score
    )
      ? phishingIdentificationAttempt.score
      : null,
    phishingIdentificationCompletedAt:
      phishingIdentificationAttempt?.completedAt ?? null,
    completedTrainingModules,
    trainingExposure: calculateTrainingExposure(completedTrainingModules)
  };
}

// Spec 3, 4, 5, and 12. Returns one transient, de-identified record per
// eligible participant in deterministic order.
async function buildResearchParticipantDataset({
  userModel = User,
  awarenessModel = AwarenessAssessment,
  phishingIdentificationModel = PhishingIdentificationAssessment,
  trainingCompletionModel = TrainingCompletion
} = {}) {
  const users = await userModel
    .find({
      role: RESEARCH_PARTICIPANT_ROLE,
      isActive: true
    })
    .select({ role: 1, isActive: 1, createdAt: 1 })
    .sort(PARTICIPANT_ORDER_SORT)
    .lean();

  const eligibleUsers = users.filter(isEligibleResearchUser);

  if (eligibleUsers.length === 0) {
    return [];
  }

  const userIds = eligibleUsers
    .map(resolveUserId)
    .filter((userId) => userId !== null);

  const [
    awarenessAttempts,
    phishingIdentificationAttempts,
    trainingCompletions
  ] = await Promise.all([
    awarenessModel
      .find({ user: { $in: userIds } })
      .select({ score: 1, completedAt: 1 })
      .sort(LATEST_ATTEMPT_SORT)
      .lean(),
    phishingIdentificationModel
      .find({ user: { $in: userIds } })
      .select({ score: 1, completedAt: 1 })
      .sort(LATEST_ATTEMPT_SORT)
      .lean(),
    trainingCompletionModel
      .find({ user: { $in: userIds }, moduleId: { $in: TRAINING_MODULE_IDS } })
      .select({ moduleId: 1 })
      .lean()
  ]);

  const latestAwarenessByUser =
    selectLatestByUser(awarenessAttempts);
  const latestPhishingByUser =
    selectLatestByUser(phishingIdentificationAttempts);
  const completedModulesByUser =
    countCompletedModulesByUser(trainingCompletions);

  return eligibleUsers.map((user, index) => {
    const userId = resolveUserId(user);

    return createParticipantRecord({
      index,
      awarenessAttempt: latestAwarenessByUser.get(userId) ?? null,
      phishingIdentificationAttempt:
        latestPhishingByUser.get(userId) ?? null,
      completedTrainingModules: completedModulesByUser.get(userId) ?? 0
    });
  });
}

function countWhere(participants, predicate) {
  return participants.filter(predicate).length;
}

function buildCohortOverview(participants) {
  return {
    totalEligibleParticipants: participants.length,
    participantsWithAwareness: countWhere(
      participants,
      (participant) => participant.awarenessScore !== null
    ),
    participantsWithPhishingIdentification: countWhere(
      participants,
      (participant) =>
        participant.phishingIdentificationScore !== null
    ),
    participantsWithTrainingExposure: countWhere(
      participants,
      (participant) => participant.trainingExposure > 0
    ),
    participantsWithFullTrainingExposure: countWhere(
      participants,
      (participant) =>
        participant.trainingExposure === FULL_TRAINING_EXPOSURE
    ),
    participantsWithAllVariables: countWhere(
      participants,
      (participant) =>
        participant.awarenessScore !== null &&
        participant.phishingIdentificationScore !== null &&
        participant.trainingExposure !== null
    )
  };
}

function buildTrainingExposureDistribution(participants) {
  const counts = new Map(
    TRAINING_EXPOSURE_LEVELS.map((level) => [level, 0])
  );

  for (const participant of participants) {
    const level = TRAINING_EXPOSURE_LEVELS.find(
      (candidate) => candidate === participant.trainingExposure
    );

    if (level !== undefined) {
      counts.set(level, counts.get(level) + 1);
    }
  }

  return TRAINING_EXPOSURE_LEVELS.map((level) => ({
    trainingExposure: level,
    count: counts.get(level)
  }));
}

function toPairs(leftAccessor, rightAccessor, participants) {
  return participants
    .map((participant) => [
      leftAccessor(participant),
      rightAccessor(participant)
    ])
    .filter(
      ([left, right]) =>
        typeof left === "number" &&
        typeof right === "number" &&
        Number.isFinite(left) &&
        Number.isFinite(right)
    );
}

// Spec 6, 7, 8, 9, and 10. Every result exposes its applicable sample size, and
// no qualitative interpretation is attached.
function buildResearchAnalyticsSummary(participants = []) {
  const safeParticipants = Array.isArray(participants)
    ? participants
    : [];

  const awarenessStatistics = computeDescriptiveStatistics(
    safeParticipants.map((participant) => participant.awarenessScore)
  );
  const phishingIdentificationStatistics =
    computeDescriptiveStatistics(
      safeParticipants.map(
        (participant) => participant.phishingIdentificationScore
      )
    );

  return {
    cohort: buildCohortOverview(safeParticipants),
    awareness: awarenessStatistics,
    phishingIdentification: phishingIdentificationStatistics,
    trainingExposureDistribution:
      buildTrainingExposureDistribution(safeParticipants),
    relationships: {
      awarenessPhishingIdentification: {
        variables: ["awarenessScore", "phishingIdentificationScore"],
        ...computePearsonCorrelation(
          toPairs(
            (participant) => participant.awarenessScore,
            (participant) => participant.phishingIdentificationScore,
            safeParticipants
          )
        )
      },
      trainingExposureAwareness: {
        variables: ["trainingExposure", "awarenessScore"],
        ...computePearsonCorrelation(
          toPairs(
            (participant) => participant.trainingExposure,
            (participant) => participant.awarenessScore,
            safeParticipants
          )
        )
      },
      trainingExposurePhishingIdentification: {
        variables: [
          "trainingExposure",
          "phishingIdentificationScore"
        ],
        ...computePearsonCorrelation(
          toPairs(
            (participant) => participant.trainingExposure,
            (participant) =>
              participant.phishingIdentificationScore,
            safeParticipants
          )
        )
      }
    },
    methodology: RESEARCH_ANALYTICS_METHODOLOGY
  };
}

async function buildResearchAnalytics({
  userModel,
  awarenessModel,
  phishingIdentificationModel,
  trainingCompletionModel
} = {}) {
  const participants = await buildResearchParticipantDataset({
    userModel,
    awarenessModel,
    phishingIdentificationModel,
    trainingCompletionModel
  });

  return {
    participants,
    summary: buildResearchAnalyticsSummary(participants)
  };
}

module.exports = {
  FULL_TRAINING_EXPOSURE,
  PARTICIPANT_ID_PREFIX,
  RESEARCH_ANALYTICS_METHODOLOGY,
  RESEARCH_PARTICIPANT_ROLE,
  TRAINING_EXPOSURE_LEVELS,
  buildResearchAnalytics,
  buildResearchAnalyticsSummary,
  buildResearchParticipantDataset,
  formatParticipantId,
  isEligibleResearchUser
};
