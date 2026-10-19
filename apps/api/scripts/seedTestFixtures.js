#!/usr/bin/env node
"use strict";

/**
 * Synthetic fixture preparation for the disposable integration-test database.
 *
 * PREPARATION VERSUS EXECUTION
 *
 * With no arguments this script performs PREPARATION only: it evaluates the
 * isolation gate, builds the fixture plan, and prints it. It opens NO
 * connection, reads no credential beyond what the gate and plan already require,
 * and writes nothing. That default is deliberate, so that running this file by
 * accident cannot create a record.
 *
 * EXECUTION requires all three of:
 *
 *   --apply                      an explicit opt-in
 *   --stage=<name>               which stage to create
 *   a passing isolation gate     verified inside this process, immediately
 *                                before connecting
 *
 * Usage
 *
 *   node scripts/seedTestFixtures.js                                   plan only
 *   node scripts/seedTestFixtures.js --stage=roles --apply             create base accounts
 *   node scripts/seedTestFixtures.js --cleanup                         remove this run's records
 *
 * PRIVILEGED ROLES
 *
 * The staff and admin roles are written directly onto the account document.
 * No application route can assign them - public registration discards a
 * client-supplied role - and this fixture deliberately does not call the
 * registration endpoint, so application authentication behaviour is untouched
 * and the roles cannot be obtained by replaying a registration request.
 *
 * CREDENTIALS
 *
 * No password is hardcoded, defaulted, or logged. Each account's password is
 * read from its own environment variable and stored as a bcrypt hash at the same
 * cost factor the product uses.
 *
 * CLEANUP
 *
 * Every document this script creates is recorded by `_id` in a run manifest held
 * OUTSIDE the repository, in the operating system temp directory. Cleanup
 * deletes exactly those identifiers and nothing else. There is no truncate, no
 * collection drop, and no query broader than "these ids".
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { evaluateTestDatabaseEnvironment } = require("./testDatabaseIsolation");
const {
  acquireLifecycleLock,
  classifyMissingManifest,
  lifecyclePath,
  openManifest,
  matchesExpectedIdentity,
  readManifest,
  readLifecycle,
  recoverLifecycleLock,
  releaseLifecycleLock,
  writeLifecycle,
  updateManifest
} = require("./testFixtureManifest");
const {
  COHORT_MEMBER_ROLE,
  FIXTURE_TICKET_YEAR,
  PARTICIPANTS,
  REQUIRED_ANALYSIS_USER_EMAIL,
  ROLE_ACCOUNTS,
  STAGES,
  STAGE_ORDER,
  buildFixturePlan,
  participantEmail
} = require("./testFixturePlan");

const DEFAULT_ANALYSIS_COUNT = 200;
const ANALYSIS_URL_POOL = Object.freeze([
  "https://portal.example.edu/signin",
  "http://portal.example.edu/signin",
  "https://secure-verify.example.net/account/login",
  "https://shared-docs.example.org/login",
  "http://xn--paypl-secure-example.com/verify",
  "https://mail-update.example.co/account/confirm?ref=1"
]);

function resolveManifestPath(env) {
  return (
    env.PHISHGUARD_TEST_MANIFEST ||
    path.join(os.tmpdir(), "phishguard-s5-run-manifest.json")
  );
}

function resolveRunId(env) {
  return env.PHISHGUARD_TEST_RUN_ID || crypto.randomUUID().slice(0, 8);
}

function resolveAnalysisCount(env) {
  const raw = Number.parseInt(env.PHISHGUARD_TEST_ANALYSIS_COUNT ?? "", 10);

  if (!Number.isInteger(raw) || raw < 1) {
    return DEFAULT_ANALYSIS_COUNT;
  }

  return Math.min(raw, 5000);
}

function parseArguments(argv) {
  const stageValues = [];
  let apply = false;
  let cleanup = false;
  let recoverLock = false;

  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
    } else if (argument === "--cleanup") {
      cleanup = true;
    } else if (argument === "--recover-lock") {
      recoverLock = true;
    } else if (argument.startsWith("--stage=")) {
      stageValues.push(argument.slice("--stage=".length));
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else {
      return { error: `Unrecognised argument "${argument}".` };
    }
  }

  if ([apply, cleanup, recoverLock].filter(Boolean).length > 1) {
    return { error: "Choose exactly one fixture operation." };
  }

  return { apply, cleanup, recoverLock, stages: stageValues };
}

function buildAnswerSet(prefix, correctCount) {
  const answers = [];

  for (let index = 1; index <= 10; index += 1) {
    // A deterministic pattern, varied by the participant's correct count, so a
    // fixture cohort produces defined rather than degenerate statistics.
    const isCorrect = index <= correctCount;

    answers.push({
      [prefix]: index,
      selectedAnswer: isCorrect ? "A" : "B"
    });
  }

  return answers;
}

/**
 * Creates the documents for one stage.
 *
 * Every model is required lazily, inside the apply path, so that a dry run never
 * loads mongoose and therefore never touches the driver.
 */
async function materialiseStage(stage, context) {
  const mongoose = require("mongoose");
  const bcrypt = require("bcrypt");

  const { User } = context.models;
  const createFixture = async (collection, identity, Model, data) => {
    const id = context.reserve(collection, identity);
    return Model.create({ _id: id, ...data });
  };

  const passwordHash = async (variable) =>
    bcrypt.hash(context.env[variable], 12);

  switch (stage) {
    case STAGES.roles: {
      for (const account of ROLE_ACCOUNTS) {
        await createFixture("users", { email: account.email, role: account.role }, User, {
          email: account.email,
          name: account.name,
          // Assigned here, on the document. This is the ONLY place a privileged
          // role is ever set, and it is deliberately not a registration call.
          role: account.role,
          isActive: true,
          password: await passwordHash(account.passwordVariable)
        });

      }

      return { created: ROLE_ACCOUNTS.length };
    }

    case STAGES.cohortSuppression:
    case STAGES.cohortReportable: {
      const window =
        stage === STAGES.cohortSuppression
          ? PARTICIPANTS.slice(0, 3)
          : PARTICIPANTS.slice(3, 5);

      for (const participant of window) {
        const email = participantEmail(participant.ordinal);
        const user = await createFixture("users", { email, role: COHORT_MEMBER_ROLE }, User, {
          email,
          name: `S5 Participant ${String(participant.ordinal).padStart(2, "0")}`,
          role: COHORT_MEMBER_ROLE,
          isActive: true,
          // Cohort accounts exist only to populate the research dataset. The
          // password is random, never printed, and never used.
          password: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12)
        });

        await createFixture("awarenessAssessments", {
          user: String(user._id), score: participant.awarenessCorrect * 10, totalQuestions: 10
        }, context.models.AwarenessAssessment, {
          user: user._id,
          answers: buildAnswerSet("questionId", participant.awarenessCorrect),
          rawScore: participant.awarenessCorrect,
          score: participant.awarenessCorrect * 10,
          totalQuestions: 10,
          completedAt: new Date()
        });

        await createFixture("phishingIdentificationAssessments", {
          user: String(user._id), score: participant.phishingCorrect * 10, totalScenarios: 10
        }, context.models.PhishingIdentificationAssessment, {
          user: user._id,
          answers: buildAnswerSet("scenarioId", participant.phishingCorrect),
          rawScore: participant.phishingCorrect,
          score: participant.phishingCorrect * 10,
          totalScenarios: 10,
          completedAt: new Date()
        });

        for (
          let moduleId = 1;
          moduleId <= participant.trainingModules;
          moduleId += 1
        ) {
          await createFixture("trainingCompletions", {
            user: String(user._id), moduleId
          }, context.models.TrainingCompletion, {
            user: user._id,
            moduleId,
            completedAt: new Date()
          });

        }
      }

      return { created: window.length };
    }

    case STAGES.analyses: {
      const owner = await User.findOne({ email: participantEmail(1) });

      if (!owner) {
        throw new Error(
          "The analyses stage needs the cohort participant created by an earlier stage."
        );
      }

      const count = resolveAnalysisCount(context.env);
      const riskCycle = ["low", "medium", "high"];

      for (let index = 0; index < count; index += 1) {
        const risk = riskCycle[index % riskCycle.length];
        const score = risk === "high" ? 70 : risk === "medium" ? 35 : 10;

        await createFixture("analyses", {
          user: String(owner._id),
          url: ANALYSIS_URL_POOL[index % ANALYSIS_URL_POOL.length], risk, score
        }, context.models.Analysis, {
          user: owner._id,
          url: ANALYSIS_URL_POOL[index % ANALYSIS_URL_POOL.length],
          risk,
          score,
          indicators: []
        });

      }

      return { created: count };
    }

    case STAGES.reports: {
      const owner = await User.findOne({ email: REQUIRED_ANALYSIS_USER_EMAIL });

      if (!owner) {
        throw new Error("The reports stage needs the roles stage to have run.");
      }

      const analysisIdentity = {
        user: String(owner._id), url: "http://portal.example.edu/signin", risk: "medium", score: 35
      };
      const analysis = await createFixture("analyses", analysisIdentity, context.models.Analysis, {
        user: owner._id,
        url: "http://portal.example.edu/signin",
        risk: "medium",
        score: 35,
        indicators: ["Connection does not use HTTPS", "Contains suspicious keyword(s): signin"]
      });

      const ticketNumber = `PG-${FIXTURE_TICKET_YEAR}-${String(context.ticketSequence).padStart(6, "0")}`;
      const report = await createFixture("reports", {
        ticketNumber, user: String(owner._id)
      }, context.models.Report, {
        user: owner._id,
        analysis: analysis._id,
        // The snapshot is the immutable evidence copy, exactly as the application
        // writes it when a student files a report.
        analysisSnapshot: {
          url: analysis.url,
          risk: analysis.risk,
          score: analysis.score,
          indicators: analysis.indicators
        },
        url: analysis.url,
        risk: analysis.risk,
        score: analysis.score,
        indicators: analysis.indicators,
        // Reserved fixture year block, so it cannot collide with a real ticket.
        ticketNumber,
        reason: "suspected_phishing",
        details: "Synthetic S5 fixture report. No real student data.",
        status: "submitted",
        priority: "normal"
      });

      const body = "Synthetic S5 fixture message. No real student data.";
      await createFixture("reportMessages", {
        report: String(report._id), sender: String(owner._id), message: body
      }, context.models.ReportMessage, {
        report: report._id,
        sender: owner._id,
        senderRole: "user",
        message: body
      });

      return { created: 1 };
    }

    default:
      throw new Error(`Stage "${stage}" has no materialisation routine.`);
  }
}

function loadModels() {
  /* eslint-disable global-require */
  const User = require("../src/models/User");
  const Analysis = require("../src/models/Analysis");
  const Report = require("../src/models/Report");
  const ReportMessage = require("../src/models/ReportMessage");
  const AwarenessAssessment = require("../src/models/AwarenessAssessment");
  const PhishingIdentificationAssessment =
    require("../src/models/PhishingIdentificationAssessment");
  const TrainingCompletion = require("../src/models/TrainingCompletion");
  /* eslint-enable global-require */

  return {
    User,
    Analysis,
    Report,
    ReportMessage,
    AwarenessAssessment,
    PhishingIdentificationAssessment,
    TrainingCompletion
  };
}

async function runApply({ env, stages, runId }) {
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });

  if (!gate.ok) {
    process.stderr.write(
      `Refusing to create fixtures: the isolation gate returned ${gate.reason}.\n`
    );
    process.stderr.write("Run node scripts/verifyTestDatabase.js for detail.\n");

    return 1;
  }

  const manifestPath = resolveManifestPath(env);
  const secret = env.PHISHGUARD_TEST_MANIFEST_SECRET;
  const lock = acquireLifecycleLock(manifestPath, { runId, target: gate.target }, secret);

  try {
    let lifecycle;
    if (fs.existsSync(lifecyclePath(manifestPath))) {
      lifecycle = readLifecycle(manifestPath, gate.target, secret);
      if (lifecycle.status === "cleaned") throw new Error("FIXTURE_RUN_ALREADY_CLEANED");
    } else {
      lifecycle = writeLifecycle(manifestPath, { runId, target: gate.target, status: "initialized" }, secret);
    }

    let manifest = openManifest({ manifestPath, runId, target: gate.target, secret });

    if (lifecycle.runId !== manifest.runId) throw new Error("FIXTURE_LIFECYCLE_RUN_MISMATCH");
    if (lifecycle.status === "initialized"
      && (manifest.activeStage || manifest.completedStages.length > 0 || manifest.entries.length > 0)) {
      throw new Error("FIXTURE_LIFECYCLE_STATE_CONTRADICTION");
    }

    if (manifest.activeStage) {
      process.stderr.write("Refusing to apply: the manifest records an interrupted stage; clean up first.\n");
      return 1;
    }

    const plan = buildFixturePlan({ env, stages, completedStages: manifest.completedStages, runId: manifest.runId });
    if (!plan.ready) {
      process.stderr.write(`Refusing to apply: ${plan.blockers.join("; ")}\n`);
      return 1;
    }

    writeLifecycle(manifestPath, { runId: manifest.runId, target: gate.target, status: "started" }, secret);

    // Only now is a connection opened, and only to the target the gate verified.
    const mongoose = require("mongoose");
    const models = loadModels();

    await mongoose.connect(env.PHISHGUARD_TEST_MONGODB_URI);

    try {
      for (const stage of stages) {
        manifest = updateManifest(manifestPath, manifest, (next) => {
          next.activeStage = stage;
        }, secret);

        const reserve = (collection, identity) => {
          const id = new mongoose.Types.ObjectId();
          manifest = updateManifest(manifestPath, manifest, (next) => {
            next.entries.push({ collection, id: String(id), stage, identity });
          }, secret);
          return id;
        };

        const outcome = await materialiseStage(stage, {
          env, models, reserve, ticketSequence: 1
        });

        manifest = updateManifest(manifestPath, manifest, (next) => {
          next.completedStages.push(stage);
          next.activeStage = null;
        }, secret);

        process.stdout.write(`stage ${stage}: created ${JSON.stringify(outcome)}\n`);
      }

      process.stdout.write(`\nManifest written to ${manifestPath}\n`
        + "Cleanup: node scripts/runS5Command.js fixtures:cleanup\n");

      return 0;
    } finally {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
  } finally {
    releaseLifecycleLock(lock, secret);
  }
}

async function runCleanup({ env }) {
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });

  if (!gate.ok) {
    process.stderr.write(
      `Refusing to delete anything: the isolation gate returned ${gate.reason}.\n`
    );

    return 1;
  }

  const manifestPath = resolveManifestPath(env);
  const secret = env.PHISHGUARD_TEST_MANIFEST_SECRET;
  const lock = acquireLifecycleLock(manifestPath, { runId: resolveRunId(env), target: gate.target }, secret);

  try {
    if (!fs.existsSync(manifestPath)) {
      if (!fs.existsSync(lifecyclePath(manifestPath))) {
        process.stderr.write("Refusing cleanup: fixture provenance is unknown.\n");
        return 1;
      }
      const state = readLifecycle(manifestPath, gate.target, secret);
      const missing = classifyMissingManifest(state);
      if (missing.ok) {
        process.stdout.write("Verified lifecycle state contains no outstanding fixture manifest.\n");
        return 0;
      }
      process.stderr.write("Refusing cleanup: a started run is missing its manifest.\n");
      return 1;
    }

    const manifest = readManifest(manifestPath, gate.target, secret);
    const state = readLifecycle(manifestPath, gate.target, secret);
    if (state.runId !== manifest.runId || !["started", "cleaned"].includes(state.status)) {
      process.stderr.write("Refusing cleanup: lifecycle and manifest do not agree.\n");
      return 1;
    }

    const models = loadModels();
    const mongoose = require("mongoose");

    const collectionModels = {
    users: models.User,
    analyses: models.Analysis,
    reports: models.Report,
    reportMessages: models.ReportMessage,
    awarenessAssessments: models.AwarenessAssessment,
    phishingIdentificationAssessments: models.PhishingIdentificationAssessment,
    trainingCompletions: models.TrainingCompletion
    };

    await mongoose.connect(env.PHISHGUARD_TEST_MONGODB_URI);

    try {
      for (const entry of [...manifest.entries].reverse()) {
      const model = collectionModels[entry.collection];
      const document = await model.findById(entry.id).lean();
      if (!document) continue;

      if (!matchesExpectedIdentity(document, entry.identity)) {
        throw new Error("FIXTURE_IDENTITY_MISMATCH");
      }

      const identityFilter = Object.fromEntries(Object.entries(entry.identity).map(([key, value]) => {
        if (["user", "report", "sender"].includes(key)) return [key, new mongoose.Types.ObjectId(value)];
        return [key, value];
      }));
      const result = await model.deleteOne({ _id: new mongoose.Types.ObjectId(entry.id), ...identityFilter });
      if (result.deletedCount !== 1) throw new Error("FIXTURE_CLEANUP_DELETE_NOT_CONFIRMED");
      process.stdout.write(`cleanup ${entry.collection}: removed 1\n`);
      }

      writeLifecycle(manifestPath, { runId: manifest.runId, target: gate.target, status: "cleaned" }, secret);
      fs.rmSync(manifestPath);

      process.stdout.write(`Manifest removed from ${manifestPath}\n`);

      return 0;
    } finally {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
  } finally {
    releaseLifecycleLock(lock, secret);
  }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === "EPERM"; }
}

function runLockRecovery({ env }) {
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });
  if (!gate.ok) return 1;
  recoverLifecycleLock(resolveManifestPath(env), {
    target: gate.target,
    confirmation: env.PHISHGUARD_TEST_LOCK_RECOVERY,
    isProcessAlive
  }, env.PHISHGUARD_TEST_MANIFEST_SECRET);
  process.stdout.write("Verified stale fixture lifecycle lock removed.\n");
  return 0;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));

  if (parsed.help) {
    process.stdout.write(
      [
        "Usage:",
        "  node scripts/seedTestFixtures.js                    plan only; no connection",
        "  node scripts/seedTestFixtures.js --stage=roles      plan only",
        "  node scripts/seedTestFixtures.js --stage=roles --apply   create records",
        "  node scripts/seedTestFixtures.js --cleanup          remove this run's records",
        "",
        `Stages: ${STAGE_ORDER.join(", ")}`,
        ""
      ].join("\n")
    );

    return 0;
  }

  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`);

    return 2;
  }

  const env = process.env;
  const runId = resolveRunId(env);
  const stages = parsed.stages.length > 0 ? parsed.stages : [...STAGE_ORDER];
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });
  let completedStages = [];
  let manifestBlocker = null;

  if (gate.ok && fs.existsSync(resolveManifestPath(env))) {
    try {
      const existing = readManifest(
        resolveManifestPath(env),
        gate.target,
        env.PHISHGUARD_TEST_MANIFEST_SECRET
      );
      completedStages = existing.completedStages;
      if (existing.activeStage) manifestBlocker = "An interrupted fixture stage requires cleanup before another apply.";
    } catch (error) {
      manifestBlocker = error.message;
    }
  }

  const plan = buildFixturePlan({ env, stages, completedStages, runId });
  if (manifestBlocker) {
    plan.blockers.push(manifestBlocker);
    plan.ready = false;
  }

  if (parsed.cleanup) {
    return runCleanup({ env });
  }

  if (parsed.recoverLock) return runLockRecovery({ env });

  if (parsed.apply && parsed.stages.length !== 1) {
    process.stderr.write("Refusing to apply: exactly one explicit --stage is required.\n");
    return 2;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: parsed.apply ? "APPLY (will connect and write)" : "PLAN (no connection)",
        isolationGate: {
          ok: gate.ok,
          reason: gate.ok ? null : gate.reason,
          target: gate.ok ? gate.target : null
        },
        plan
      },
      null,
      2
    )}\n`
  );

  if (!parsed.apply) {
    process.stdout.write(
      "\nPreparation only. Nothing was created and no database was contacted.\n"
      + "Add --apply to create the records above.\n"
    );

    return 0;
  }

  if (!gate.ok) {
    process.stderr.write(
      `\nRefusing to apply: the isolation gate returned ${gate.reason}.\n`
    );

    return 1;
  }

  if (!plan.ready) {
    process.stderr.write("\nRefusing to apply; the fixture plan is not ready:\n");

    for (const blocker of plan.blockers) {
      process.stderr.write(`  - ${blocker}\n`);
    }

    return 1;
  }

  return runApply({ env, stages, runId });
}

module.exports = { isProcessAlive, main, materialiseStage, parseArguments, resolveManifestPath,
  runApply, runCleanup, runLockRecovery };

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    // Sanitized by construction: only the error name and a fixed sentence are
    // printed. A driver failure frequently embeds the connection string, and
    // this script must never be the reason a credential reaches a log.
    process.stderr.write(
      `Fixture preparation failed (${error && error.name ? error.name : "Error"}). `
      + "Details are suppressed so no credential can be logged; re-run the "
      + "isolation gate and inspect the environment variables directly.\n"
    );
    process.exitCode = 1;
  });
}
