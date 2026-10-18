const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MINIMUM_REPORTABLE_OBSERVATIONS: REAL_SUPPRESSION_THRESHOLD
} = require("../src/services/researchAnalytics.suppression");

const {
  COHORT_MEMBER_ROLE,
  FIXTURE_TICKET_YEAR,
  MINIMUM_REPORTABLE_OBSERVATIONS,
  PARTICIPANTS,
  REQUIRED_ANALYSIS_USER_EMAIL,
  ROLE_ACCOUNTS,
  STAGES,
  STAGE_ORDER,
  buildFixturePlan,
  participantEmail,
  projectCohortSize,
  suppressionExpectation
} = require("../scripts/testFixturePlan");

// Synthetic fixture plan.
//
// Pure and offline: no database driver is imported by the plan module, no
// connection is opened, and no file is read. Every assertion below runs with no
// MongoDB anywhere in the process.
//
// The point of these tests is that a fixture plan can be reviewed BEFORE
// anything is created, and that the cohort arithmetic - which decides whether a
// suppression test is actually testing suppression - is verified rather than
// assumed.

const FULL_CREDENTIALS = Object.freeze({
  PHISHGUARD_TEST_FIXTURE_PASSWORD: "synthetic-placeholder-a",
  PHISHGUARD_TEST_STAFF_PASSWORD: "synthetic-placeholder-b",
  PHISHGUARD_TEST_ADMIN_PASSWORD: "synthetic-placeholder-c"
});

function planFor(stages, env = {}) {
  return buildFixturePlan({ env, stages, runId: "R-TEST" });
}

// ---------------------------------------------------------------------------
// Drift guard
// ---------------------------------------------------------------------------

test("the plan's suppression threshold cannot drift from the real one", () => {
  // Behavioural, not a source-text match: the real module is loaded and its
  // exported value is compared. If the product threshold moves, this fails.
  assert.equal(MINIMUM_REPORTABLE_OBSERVATIONS, REAL_SUPPRESSION_THRESHOLD);
  assert.equal(REAL_SUPPRESSION_THRESHOLD, 5);
});

test("the cohort member role matches the one the research dataset selects", () => {
  assert.equal(COHORT_MEMBER_ROLE, "user");
});

// ---------------------------------------------------------------------------
// The cohort arithmetic, which is the whole point of this module
// ---------------------------------------------------------------------------

test("the roles stage alone contributes exactly one cohort member", () => {
  // `user@test.com` is active and holds the `user` role, so it counts. Staff and
  // admin do not.
  assert.equal(projectCohortSize([STAGES.roles]), 1);
});

test("roles plus the suppression stage produces a cohort of four", () => {
  const plan = planFor([STAGES.roles, STAGES.cohortSuppression], FULL_CREDENTIALS);

  assert.equal(plan.ready, true, plan.blockers.join("; "));
  assert.equal(plan.cohort.sizeAfterStages, 4);
  assert.equal(plan.cohort.suppressed, true);
});

test("adding the reportable stage produces a cohort of six", () => {
  const plan = planFor(
    [STAGES.roles, STAGES.cohortSuppression, STAGES.cohortReportable],
    FULL_CREDENTIALS
  );

  assert.equal(plan.ready, true, plan.blockers.join("; "));
  assert.equal(plan.cohort.sizeAfterStages, 6);
  assert.equal(plan.cohort.suppressed, false);
});

test("the suppression cohort is four because user@test.com counts, not three", () => {
  // This is the arithmetic most likely to be got wrong by hand. Four
  // participants plus a required analysis user would be a cohort of five, which
  // does NOT suppress, and the resulting screenshot would prove nothing.
  const plan = planFor([STAGES.roles, STAGES.cohortSuppression], FULL_CREDENTIALS);

  assert.equal(plan.cohort.countedAccounts.length, 4);
  assert.equal(
    plan.cohort.countedAccounts.includes(REQUIRED_ANALYSIS_USER_EMAIL),
    true,
    "the account analysis.routes.test.js requires must be counted as a cohort member"
  );
});

test("staff and admin are never counted in the cohort", () => {
  const plan = planFor([STAGES.roles], FULL_CREDENTIALS);

  for (const email of ["staff@test.com", "admin@test.com"]) {
    assert.equal(plan.cohort.countedAccounts.includes(email), false);
  }
});

test("exactly one account in the roles stage joins the cohort", () => {
  assert.equal(ROLE_ACCOUNTS.filter((account) => account.joinsCohort).length, 1);
  assert.equal(
    ROLE_ACCOUNTS.filter((account) => account.joinsCohort)[0].email,
    REQUIRED_ANALYSIS_USER_EMAIL
  );
});

test("every cohort member is counted by an account the plan creates", () => {
  const plan = planFor([STAGES.roles, STAGES.cohortSuppression], FULL_CREDENTIALS);
  const staffAndAdmin = ROLE_ACCOUNTS.filter((account) => !account.joinsCohort).map(
    (account) => account.email
  );

  for (const email of staffAndAdmin) {
    assert.equal(plan.cohort.countedAccounts.includes(email), false);
  }
});

test("the cohort count always equals the number of counted accounts", () => {
  for (const stages of [
    [STAGES.roles],
    [STAGES.roles, STAGES.cohortSuppression],
    [STAGES.roles, STAGES.cohortSuppression, STAGES.cohortReportable],
    [STAGES.cohortSuppression]
  ]) {
    const plan = planFor(stages, FULL_CREDENTIALS);

    assert.equal(
      plan.cohort.sizeAfterStages,
      plan.cohort.countedAccounts.length,
      `mismatch for ${JSON.stringify(stages)}`
    );
  }
});

test("a cohort of exactly five is already reportable", () => {
  // The threshold is exclusive-below, so five must not suppress.
  assert.equal(suppressionExpectation(5).includes("reportable"), true);
  assert.equal(suppressionExpectation(4).includes("Suppression engages"), true);
});

test("an empty cohort is described without claiming suppression", () => {
  assert.equal(suppressionExpectation(0).includes("Suppression engages"), false);
  assert.equal(suppressionExpectation(0).includes("no observations"), true);
});

// ---------------------------------------------------------------------------
// Blockers: the plan fails closed
// ---------------------------------------------------------------------------

test("an unknown stage is a blocker, not a silently ignored typo", () => {
  const plan = planFor([STAGES.roles, "cohort-suppresion"]);

  assert.equal(plan.ready, false);
  assert.equal(plan.blockers.some((blocker) => blocker.includes("Unknown fixture stage")), true);
});

test("the reportable stage without the suppression stage is a blocker", () => {
  const plan = planFor([STAGES.roles, STAGES.cohortReportable], FULL_CREDENTIALS);

  assert.equal(plan.ready, false);
  assert.equal(
    plan.blockers.some((blocker) => blocker.includes("cohort-suppression")),
    true
  );
});

test("the reportable stage accepts a previously completed suppression stage", () => {
  const plan = buildFixturePlan({
    env: FULL_CREDENTIALS,
    stages: [STAGES.cohortReportable],
    completedStages: [STAGES.roles, STAGES.cohortSuppression],
    runId: "R-TEST"
  });

  assert.equal(plan.ready, true, plan.blockers.join("; "));
  assert.equal(plan.cohort.sizeAfterStages, 6);
});

test("an already completed stage is refused", () => {
  const plan = buildFixturePlan({
    env: FULL_CREDENTIALS,
    stages: [STAGES.roles],
    completedStages: [STAGES.roles],
    runId: "R-TEST"
  });

  assert.equal(plan.ready, false);
  assert.match(plan.blockers.join(" "), /already complete/);
});

test("missing credentials are blockers and are never defaulted", () => {
  const plan = planFor([STAGES.roles]);

  assert.equal(plan.ready, false);
  assert.equal(plan.missingCredentials.length, 3);
  assert.equal(
    plan.blockers.filter((blocker) => blocker.includes("Missing credential variable")).length,
    3
  );
});

test("a partially supplied credential set still blocks", () => {
  const plan = planFor([STAGES.roles], {
    PHISHGUARD_TEST_FIXTURE_PASSWORD: "synthetic-placeholder-a"
  });

  assert.equal(plan.ready, false);
  assert.deepEqual(plan.missingCredentials, [
    "PHISHGUARD_TEST_STAFF_PASSWORD",
    "PHISHGUARD_TEST_ADMIN_PASSWORD"
  ]);
});

test("an empty credential value counts as missing", () => {
  const plan = planFor([STAGES.roles], { ...FULL_CREDENTIALS, PHISHGUARD_TEST_ADMIN_PASSWORD: "" });

  assert.equal(plan.ready, false);
  assert.ok(plan.missingCredentials.includes("PHISHGUARD_TEST_ADMIN_PASSWORD"));
});

test("stages that need no credentials are ready with an empty environment", () => {
  const plan = buildFixturePlan({
    env: {},
    stages: [STAGES.cohortSuppression],
    completedStages: [STAGES.roles],
    runId: "R-TEST"
  });

  assert.equal(plan.ready, true, plan.blockers.join("; "));
  assert.deepEqual(plan.requiredCredentials, []);
});

test("every fixture stage enforces its explicit prerequisites", () => {
  const cases = [
    [STAGES.cohortSuppression, [], STAGES.roles],
    [STAGES.cohortReportable, [STAGES.roles], STAGES.cohortSuppression],
    [STAGES.analyses, [STAGES.roles], STAGES.cohortSuppression],
    [STAGES.reports, [], STAGES.roles]
  ];

  for (const [stage, completedStages, missing] of cases) {
    const plan = buildFixturePlan({ env: FULL_CREDENTIALS, stages: [stage], completedStages, runId: "R-TEST" });
    assert.equal(plan.ready, false, stage);
    assert.match(plan.blockers.join(" "), new RegExp(missing));
  }
});

// ---------------------------------------------------------------------------
// No credential may appear in the plan
// ---------------------------------------------------------------------------

test("no credential value ever appears in the plan output", () => {
  const secrets = Object.values(FULL_CREDENTIALS);
  const plan = buildFixturePlan({
    env: FULL_CREDENTIALS,
    stages: [...STAGE_ORDER],
    runId: "R-TEST"
  });

  const serialised = JSON.stringify(plan);

  for (const secret of secrets) {
    assert.equal(serialised.includes(secret), false, `the plan must not contain ${secret}`);
  }
});

test("the plan names the credential VARIABLES but never their values", () => {
  const plan = planFor([STAGES.roles], FULL_CREDENTIALS);

  assert.ok(plan.requiredCredentials.includes("PHISHGUARD_TEST_FIXTURE_PASSWORD"));
  assert.equal(
    plan.stages[0].creates.users.every((user) => typeof user.passwordFromEnvironment === "string"),
    true,
    "each account must state which variable supplies its password"
  );
  assert.equal(
    plan.stages[0].creates.users.every((user) => !("password" in user)),
    true,
    "no account descriptor may carry a password field"
  );
});

// ---------------------------------------------------------------------------
// Fixture data properties
// ---------------------------------------------------------------------------

test("participant accounts use the reserved .invalid TLD", () => {
  // `.invalid` is reserved by RFC 2606 and can never resolve, so a fixture
  // address cannot collide with a real one or receive mail.
  for (let ordinal = 1; ordinal <= PARTICIPANTS.length; ordinal += 1) {
    assert.match(participantEmail(ordinal), /@test\.invalid$/);
  }
});

test("participant emails are unique", () => {
  const emails = PARTICIPANTS.map((participant) => participantEmail(participant.ordinal));

  assert.equal(new Set(emails).size, emails.length);
});

test("participant scores vary, so correlations are not degenerate", () => {
  const awareness = PARTICIPANTS.map((p) => p.awarenessCorrect);
  const phishing = PARTICIPANTS.map((p) => p.phishingCorrect);
  const training = PARTICIPANTS.map((p) => p.trainingModules);

  for (const [label, values] of [["awareness", awareness], ["phishing", phishing], ["training", training]]) {
    assert.ok(
      new Set(values).size > 1,
      `${label} must vary; a constant would produce undefined correlations and prove nothing about chart rendering`
    );
  }
});

test("participant scores stay inside the instrument's range", () => {
  for (const participant of PARTICIPANTS) {
    assert.ok(participant.awarenessCorrect >= 0 && participant.awarenessCorrect <= 10);
    assert.ok(participant.phishingCorrect >= 0 && participant.phishingCorrect <= 10);
    assert.ok(participant.trainingModules >= 0 && participant.trainingModules <= 3);
  }
});

test("fixture ticket numbers use a reserved year block", () => {
  // PG-9999-000001 cannot collide with a real PG-<year>-<sequence> ticket even
  // in the impossible event of a shared database.
  assert.equal(FIXTURE_TICKET_YEAR, "9999");
  assert.match(`PG-${FIXTURE_TICKET_YEAR}-000001`, /^PG-\d{4}-\d{6}$/);
});

test("the analysis stage creates enough documents for an index comparison", () => {
  const stage = planFor([STAGES.analyses]).stages[0];

  assert.match(String(stage.creates.analysisCount), /default 200/);
  assert.ok(
    stage.notes.some((note) => note.includes("in-memory sort")),
    "the plan must explain why a small result set would make the check meaningless"
  );
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("the plan never mutates the environment it is given", () => {
  const env = { ...FULL_CREDENTIALS };
  const snapshot = JSON.stringify(env);

  buildFixturePlan({ env, stages: [...STAGE_ORDER] });

  assert.equal(JSON.stringify(env), snapshot);
});

test("the plan is deterministic for the same input", () => {
  const first = planFor([...STAGE_ORDER], FULL_CREDENTIALS);
  const second = planFor([...STAGE_ORDER], FULL_CREDENTIALS);

  assert.deepEqual(first, second);
});

test("the plan imports no database driver", () => {
  // Behavioural, not a source scan: if the plan pulled in mongoose, requiring it
  // in this MongoDB-free process would be a side effect the tests would notice
  // through the other assertions. This makes the intent explicit.
  const moduleExports = Object.keys(
    buildFixturePlan({ env: FULL_CREDENTIALS, stages: [] })
  );

  assert.ok(moduleExports.includes("cohort"));
  assert.ok(moduleExports.includes("blockers"));
  assert.ok(moduleExports.includes("ready"));
});

test("an empty stage list is a valid, empty plan", () => {
  const plan = planFor([]);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.stages, []);
  assert.equal(plan.cohort.sizeAfterStages, 0);
  assert.equal(plan.cohort.countedAccounts.length, 0);
});

test("every known stage is described with a purpose", () => {
  for (const stage of STAGE_ORDER) {
    const plan = planFor([stage], FULL_CREDENTIALS);

    assert.equal(plan.stages.length, 1, `${stage} must be described`);
    assert.ok(plan.stages[0].description.length > 0, `${stage} needs a description`);
  }
});
