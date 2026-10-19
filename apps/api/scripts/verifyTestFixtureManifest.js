#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { evaluateTestDatabaseEnvironment } = require("./testDatabaseIsolation");
const {
  lifecyclePath,
  lockPath,
  readLifecycle,
  readManifest
} = require("./testFixtureManifest");
const { ROLE_ACCOUNTS, STAGES } = require("./testFixturePlan");

const VERIFY_CODES = Object.freeze({
  gateRefused: "ISOLATION_GATE_REFUSED",
  manifestMissing: "FIXTURE_MANIFEST_MISSING",
  lifecycleMissing: "FIXTURE_LIFECYCLE_MISSING",
  lockPresent: "FIXTURE_LOCK_PRESENT",
  authenticationFailed: "FIXTURE_RECOVERY_AUTHENTICATION_FAILED",
  changedDuringRead: "FIXTURE_RECOVERY_CHANGED_DURING_READ",
  runMismatch: "FIXTURE_RUN_ID_MISMATCH",
  expectedRunMismatch: "FIXTURE_EXPECTED_RUN_ID_MISMATCH",
  lifecycleStatus: "FIXTURE_LIFECYCLE_STATUS_INVALID",
  completedStages: "FIXTURE_COMPLETED_STAGES_INVALID",
  activeStage: "FIXTURE_ACTIVE_STAGE_INVALID",
  entryCount: "FIXTURE_ENTRY_COUNT_INVALID",
  entryMetadata: "FIXTURE_ENTRY_METADATA_INVALID",
  identities: "FIXTURE_IDENTITIES_INVALID"
});

function resolveManifestPath(env) {
  return env.PHISHGUARD_TEST_MANIFEST
    || path.join(os.tmpdir(), "phishguard-s5-run-manifest.json");
}

function fixedReport(overrides) {
  return {
    ok: false,
    verifier: "fixture-recovery",
    connected: false,
    filesModified: false,
    ...overrides
  };
}

function verifyFixtureRecovery({ env = process.env, fileSystem = fs } = {}) {
  const gate = evaluateTestDatabaseEnvironment(env, { substitutedChild: true });
  if (!gate.ok) return fixedReport({ code: VERIFY_CODES.gateRefused });

  const manifestFile = resolveManifestPath(env);
  const lifecycleFile = lifecyclePath(manifestFile);
  const fixtureLock = lockPath(manifestFile);

  if (!fileSystem.existsSync(manifestFile)) return fixedReport({ code: VERIFY_CODES.manifestMissing });
  if (!fileSystem.existsSync(lifecycleFile)) return fixedReport({ code: VERIFY_CODES.lifecycleMissing });
  if (fileSystem.existsSync(fixtureLock)) return fixedReport({ code: VERIFY_CODES.lockPresent });

  let manifest;
  let lifecycle;
  let confirmedManifest;
  let confirmedLifecycle;
  try {
    manifest = readManifest(manifestFile, gate.target, env.PHISHGUARD_TEST_MANIFEST_SECRET, fileSystem);
    lifecycle = readLifecycle(manifestFile, gate.target, env.PHISHGUARD_TEST_MANIFEST_SECRET, fileSystem);
    confirmedManifest = readManifest(manifestFile, gate.target, env.PHISHGUARD_TEST_MANIFEST_SECRET, fileSystem);
    confirmedLifecycle = readLifecycle(manifestFile, gate.target, env.PHISHGUARD_TEST_MANIFEST_SECRET, fileSystem);
  } catch {
    return fixedReport({ code: VERIFY_CODES.authenticationFailed });
  }

  if (fileSystem.existsSync(fixtureLock)) return fixedReport({ code: VERIFY_CODES.lockPresent });
  if (manifest.authentication !== confirmedManifest.authentication
    || lifecycle.authentication !== confirmedLifecycle.authentication) {
    return fixedReport({ code: VERIFY_CODES.changedDuringRead });
  }
  if (manifest.runId !== lifecycle.runId) return fixedReport({ code: VERIFY_CODES.runMismatch });

  const expectedRunId = env.PHISHGUARD_TEST_RUN_ID;
  const expectedRunIdChecked = typeof expectedRunId === "string" && expectedRunId.length > 0;
  if (expectedRunIdChecked && manifest.runId !== expectedRunId) {
    return fixedReport({ code: VERIFY_CODES.expectedRunMismatch });
  }
  if (lifecycle.status !== "started") return fixedReport({ code: VERIFY_CODES.lifecycleStatus });
  if (manifest.completedStages.length !== 1 || manifest.completedStages[0] !== STAGES.roles) {
    return fixedReport({ code: VERIFY_CODES.completedStages });
  }
  if (manifest.activeStage !== null) return fixedReport({ code: VERIFY_CODES.activeStage });
  if (manifest.entries.length !== ROLE_ACCOUNTS.length) {
    return fixedReport({ code: VERIFY_CODES.entryCount, entryCount: manifest.entries.length });
  }
  if (!manifest.entries.every((entry) => entry.collection === "users" && entry.stage === STAGES.roles)) {
    return fixedReport({ code: VERIFY_CODES.entryMetadata, entryCount: manifest.entries.length });
  }

  const expectedIdentities = ROLE_ACCOUNTS
    .map(({ email, role }) => `${email}\u0000${role}`).sort();
  const actualIdentities = manifest.entries
    .map(({ identity }) => `${identity.email}\u0000${identity.role}`).sort();
  if (JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)) {
    return fixedReport({ code: VERIFY_CODES.identities, entryCount: manifest.entries.length });
  }

  return fixedReport({
    ok: true,
    code: "FIXTURE_RECOVERY_VERIFIED",
    manifestAuthenticated: true,
    lifecycleAuthenticated: true,
    runIdsMatch: true,
    expectedRunIdChecked,
    lifecycleStarted: true,
    completedRolesOnly: true,
    activeStageClear: true,
    entryCount: manifest.entries.length,
    identitiesMatch: true,
    lockAbsent: true
  });
}

function main({ env = process.env, stdout = process.stdout } = {}) {
  const report = verifyFixtureRecovery({ env });
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

module.exports = { VERIFY_CODES, main, resolveManifestPath, verifyFixtureRecovery };

if (require.main === module) {
  try { process.exitCode = main(); }
  catch { process.stderr.write("Fixture recovery verification failed safely.\n"); process.exitCode = 1; }
}
