"use strict";

/**
 * Synthetic fixture plan for the disposable integration-test database.
 *
 * This module is PURE. It imports no database driver, opens no connection, and
 * reads no file. It answers one question: "if an operator ran these stages, what
 * documents would exist, what would it require, and how large would the research
 * cohort be?"
 *
 * That separation is what makes the fixture strategy reviewable before anything
 * is created. `seedTestFixtures.js` consumes this plan to materialise documents;
 * `test/testFixturePlan.test.js` verifies the arithmetic offline.
 *
 * WHY THE COHORT ARITHMETIC IS THE INTERESTING PART
 *
 * `buildResearchParticipantDataset()` selects every ACTIVE account holding the
 * `user` role. Nothing else is excluded. In particular the account that
 * `analysis.routes.test.js` requires - `user@test.com` - has the role `user` and
 * is active, so it IS a cohort member.
 *
 * Small-cohort suppression engages below five observations
 * (`MINIMUM_REPORTABLE_OBSERVATIONS`). A plan that creates "four participants"
 * while also creating `user@test.com` therefore produces a cohort of five, which
 * does NOT suppress. Getting this wrong costs a whole verification cycle and,
 * worse, produces a screenshot that looks like a suppression test but is not.
 *
 * The stage names below are expressed as COHORT TOTALS for that reason.
 */

// Kept in step with `researchAnalytics.suppression.js`. Duplicated rather than
// imported so that this module stays free of model and service imports; a test
// asserts the two cannot drift.
const MINIMUM_REPORTABLE_OBSERVATIONS = 5;

// Only this role enters the research cohort.
const COHORT_MEMBER_ROLE = "user";

// The account `analysis.routes.test.js` logs in as. It is a cohort member.
const REQUIRED_ANALYSIS_USER_EMAIL = "user@test.com";

// Fixture ticket numbers use a reserved year block so they can never collide
// with a real ticket sequence, even in the impossible event that a disposable
// database were ever shared.
const FIXTURE_TICKET_YEAR = "9999";

const STAGES = Object.freeze({
  roles: "roles",
  cohortSuppression: "cohort-suppression",
  cohortReportable: "cohort-reportable",
  analyses: "analyses",
  reports: "reports"
});

const STAGE_ORDER = Object.freeze([
  STAGES.roles,
  STAGES.cohortSuppression,
  STAGES.cohortReportable,
  STAGES.analyses,
  STAGES.reports
]);

const STAGE_PREREQUISITES = Object.freeze({
  [STAGES.roles]: Object.freeze([]),
  [STAGES.cohortSuppression]: Object.freeze([STAGES.roles]),
  [STAGES.cohortReportable]: Object.freeze([STAGES.roles, STAGES.cohortSuppression]),
  [STAGES.analyses]: Object.freeze([STAGES.roles, STAGES.cohortSuppression]),
  [STAGES.reports]: Object.freeze([STAGES.roles])
});

/** Accounts created by the `roles` stage, in creation order. */
const ROLE_ACCOUNTS = Object.freeze([
  {
    key: "analysis-user",
    email: REQUIRED_ANALYSIS_USER_EMAIL,
    name: "S5 Integration User",
    role: COHORT_MEMBER_ROLE,
    passwordVariable: "PHISHGUARD_TEST_FIXTURE_PASSWORD",
    joinsCohort: true,
    purpose:
      "Required by analysis.routes.test.js, which logs in with a fixed email and password. This stage is what makes that suite runnable."
  },
  {
    key: "staff",
    email: "staff@test.com",
    name: "S5 Integration Staff",
    role: "staff",
    passwordVariable: "PHISHGUARD_TEST_STAFF_PASSWORD",
    joinsCohort: false,
    purpose:
      "Required for the IT Review Queue and IT Review detail browser workflows. Frontend role gating is a usability control only; the backend remains the security boundary."
  },
  {
    key: "admin",
    email: "admin@test.com",
    name: "S5 Integration Admin",
    role: "admin",
    passwordVariable: "PHISHGUARD_TEST_ADMIN_PASSWORD",
    joinsCohort: false,
    purpose:
      "Required for the Research Analytics browser workflow and the CSV export. Admin also joins the Account group, not the research cohort."
  }
]);

/**
 * Research-cohort participants. Each carries assessment and training records so
 * the statistics are non-degenerate: a cohort whose variables are all identical
 * produces undefined correlations and proves nothing about the chart rendering.
 */
const PARTICIPANTS = Object.freeze([
  { ordinal: 1, awarenessCorrect: 10, phishingCorrect: 10, trainingModules: 3 },
  { ordinal: 2, awarenessCorrect: 9, phishingCorrect: 7, trainingModules: 3 },
  { ordinal: 3, awarenessCorrect: 7, phishingCorrect: 9, trainingModules: 2 },
  { ordinal: 4, awarenessCorrect: 6, phishingCorrect: 6, trainingModules: 2 },
  { ordinal: 5, awarenessCorrect: 4, phishingCorrect: 5, trainingModules: 1 },
  { ordinal: 6, awarenessCorrect: 2, phishingCorrect: 3, trainingModules: 1 }
]);

function participantEmail(ordinal) {
  return `s5-participant-${String(ordinal).padStart(2, "0")}@test.invalid`;
}

function normaliseStages(stages) {
  if (stages === undefined || stages === null) {
    return [...STAGE_ORDER];
  }

  const requested = Array.isArray(stages) ? stages : [stages];

  return requested.map((stage) => String(stage).trim());
}

function isKnownStage(stage) {
  return STAGE_ORDER.includes(stage);
}

/**
 * Cohort arithmetic for a set of stages, counting only accounts that the research
 * dataset would actually select: active, role `user`.
 */
function projectCohortSize(stages) {
  const selected = new Set(stages);

  let size = 0;

  if (selected.has(STAGES.roles)) {
    size += ROLE_ACCOUNTS.filter((account) => account.joinsCohort).length;
  }

  if (selected.has(STAGES.cohortSuppression)) {
    size += 3;
  }

  if (selected.has(STAGES.cohortReportable)) {
    // Adds two more on top of the suppression stage's three, reaching five
    // participants in total.
    size += 2;
  }

  return size;
}

function suppressionExpectation(cohortSize) {
  if (cohortSize === 0) {
    return "No cohort members exist yet, so analytics responses carry no observations.";
  }

  if (cohortSize < MINIMUM_REPORTABLE_OBSERVATIONS) {
    return `Suppression engages: ${cohortSize} observation(s) is below the threshold of ${MINIMUM_REPORTABLE_OBSERVATIONS}. Aggregates are withheld while the observation count is preserved.`;
  }

  return `Aggregates are reportable: ${cohortSize} observation(s) meets the threshold of ${MINIMUM_REPORTABLE_OBSERVATIONS}.`;
}

function describeStage(stage, runId) {
  switch (stage) {
    case STAGES.roles:
      return {
        name: stage,
        description: "Base accounts required by the route suites and by reviewer browser workflows.",
        creates: {
          users: ROLE_ACCOUNTS.map((account) => ({
            key: account.key,
            email: account.email,
            role: account.role,
            joinsCohort: account.joinsCohort,
            passwordFromEnvironment: account.passwordVariable,
            purpose: account.purpose
          }))
        },
        requiresCredentials: ROLE_ACCOUNTS.map((account) => account.passwordVariable),
        notes: [
          "Privileged roles are written directly onto the account document by this fixture. No route in the application can assign them, and this fixture does not call registration.",
          "No password is hardcoded. Each is read from its own environment variable."
        ]
      };

    case STAGES.cohortSuppression:
      return {
        name: stage,
        description:
          "Three research-cohort participants. Together with the analysis user from the roles stage this produces a cohort of four, which is below the suppression threshold.",
        creates: {
          users: PARTICIPANTS.slice(0, 3).map((participant) => ({
            email: participantEmail(participant.ordinal),
            role: COHORT_MEMBER_ROLE,
            awarenessScore: participant.awarenessCorrect * 10,
            phishingIdentificationScore: participant.phishingCorrect * 10,
            trainingModulesCompleted: participant.trainingModules
          })),
          awarenessAssessments: 3,
          phishingIdentificationAssessments: 3,
          trainingCompletions: PARTICIPANTS.slice(0, 3).reduce(
            (total, participant) => total + participant.trainingModules,
            0
          )
        },
        requiresCredentials: [],
        notes: [
          "Three participants, NOT four: `user@test.com` is also an active `user` account and therefore also counts. Three plus one is the requested cohort of four."
        ]
      };

    case STAGES.cohortReportable:
      return {
        name: stage,
        description:
          "Two further participants, raising the cohort to six and clearing the suppression threshold so the charts render their reportable state.",
        creates: {
          users: PARTICIPANTS.slice(3, 5).map((participant) => ({
            email: participantEmail(participant.ordinal),
            role: COHORT_MEMBER_ROLE,
            awarenessScore: participant.awarenessCorrect * 10,
            phishingIdentificationScore: participant.phishingCorrect * 10,
            trainingModulesCompleted: participant.trainingModules
          })),
          awarenessAssessments: 2,
          phishingIdentificationAssessments: 2,
          trainingCompletions: PARTICIPANTS.slice(3, 5).reduce(
            (total, participant) => total + participant.trainingModules,
            0
          )
        },
        requiresCredentials: [],
        notes: [
          "Run after the suppression stage and after the suppressed-state screenshot has been captured.",
          "Scores and completed-module counts vary across participants so correlations are defined rather than degenerate."
        ]
      };

    case STAGES.analyses:
      return {
        name: stage,
        description:
          "Analysis records for one participant, so the owner-history and dashboard-recents queries return a result set large enough to make an index-usage comparison meaningful.",
        creates: {
          analysesFor: participantEmail(1),
          analysisCount: "PHISHGUARD_TEST_ANALYSIS_COUNT (default 200)",
          analysesPerRiskLevel: "spread across low, medium, and high"
        },
        requiresCredentials: [],
        notes: [
          "A realistic result set matters: with three or four documents MongoDB will answer from an in-memory sort and the planner has no reason to prefer an index.",
          "These records belong to a participant account, so they also appear in the owner's Analysis History during browser verification."
        ]
      };

    case STAGES.reports:
      return {
        name: stage,
        description:
          "A synthetic incident report with an immutable analysis snapshot and one reviewer message, plus the assessment records the report and dashboard surfaces read.",
        creates: {
          reports: 1,
          reportMessages: 1,
          ticketNumbers: `PG-${FIXTURE_TICKET_YEAR}-000001 (reserved fixture year block)`,
          reportStatus: "submitted",
          humanITAssessment: "pending"
        },
        requiresCredentials: [],
        notes: [
          "The snapshot is copied from the analysis the way the application copies it, so the reviewer surface shows a frozen piece of evidence.",
          "The human IT assessment is left pending. A completed assessment is created only when the reviewer workflow itself is being exercised in a browser, so the browser run can perform that step itself."
        ]
      };

    default:
      return {
        name: stage,
        description: "Unrecognised stage.",
        creates: {},
        requiresCredentials: [],
        notes: []
      };
  }
}

/**
 * Builds the full plan. Never throws; unrecoverable problems are returned as
 * `blockers` so a caller can print them all at once.
 */
function buildFixturePlan({ env = {}, stages = undefined, completedStages = [], runId = "unassigned" } = {}) {
  const requestedStages = normaliseStages(stages);
  const blockers = [];

  for (const stage of requestedStages) {
    if (!isKnownStage(stage)) {
      blockers.push(
        `Unknown fixture stage "${stage}". Known stages: ${STAGE_ORDER.join(", ")}.`
      );
    }
  }

  const knownStages = requestedStages.filter(isKnownStage);

  const availableStages = new Set([...completedStages, ...knownStages]);

  for (const stage of knownStages) {
    const missing = STAGE_PREREQUISITES[stage].filter((required) => !availableStages.has(required));
    if (missing.length > 0) blockers.push(`Fixture stage "${stage}" requires completed stage(s): ${missing.join(", ")}.`);
  }

  for (const stage of knownStages) {
    if (completedStages.includes(stage)) blockers.push(`Fixture stage "${stage}" is already complete.`);
  }

  const requiredCredentials = [];

  for (const stage of knownStages) {
    for (const variable of describeStage(stage, runId).requiresCredentials) {
      if (!requiredCredentials.includes(variable)) {
        requiredCredentials.push(variable);
      }
    }
  }

  const missingCredentials = requiredCredentials.filter(
    (variable) => typeof env[variable] !== "string" || env[variable].length === 0
  );

  for (const variable of missingCredentials) {
    blockers.push(
      `Missing credential variable ${variable}. Passwords are never hardcoded and never defaulted.`
    );
  }

  const cohortStages = [...new Set([...completedStages, ...knownStages])];
  const cohortSize = projectCohortSize(cohortStages);

  return {
    runId,
    stages: knownStages.map((stage) => describeStage(stage, runId)),
    cohort: {
      memberRole: COHORT_MEMBER_ROLE,
      sizeAfterStages: cohortSize,
      minimumReportableObservations: MINIMUM_REPORTABLE_OBSERVATIONS,
      expectation: suppressionExpectation(cohortSize),
      suppressed: cohortSize > 0 && cohortSize < MINIMUM_REPORTABLE_OBSERVATIONS,
      countedAccounts: [
        ...(cohortStages.includes(STAGES.roles)
          ? ROLE_ACCOUNTS.filter((account) => account.joinsCohort).map(
              (account) => account.email
            )
          : []),
        ...(cohortStages.includes(STAGES.cohortSuppression)
          ? PARTICIPANTS.slice(0, 3).map((participant) => participantEmail(participant.ordinal))
          : []),
        ...(cohortStages.includes(STAGES.cohortReportable)
          ? PARTICIPANTS.slice(3, 5).map((participant) => participantEmail(participant.ordinal))
          : [])
      ]
    },
    requiredCredentials,
    missingCredentials,
    blockers,
    ready: blockers.length === 0
  };
}

module.exports = {
  COHORT_MEMBER_ROLE,
  FIXTURE_TICKET_YEAR,
  MINIMUM_REPORTABLE_OBSERVATIONS,
  PARTICIPANTS,
  REQUIRED_ANALYSIS_USER_EMAIL,
  ROLE_ACCOUNTS,
  STAGES,
  STAGE_ORDER,
  STAGE_PREREQUISITES,
  buildFixturePlan,
  participantEmail,
  projectCohortSize,
  suppressionExpectation
};
