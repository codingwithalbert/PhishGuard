const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  acquireLifecycleLock,
  atomicWriteRecord,
  createManifest,
  releaseLifecycleLock,
  writeLifecycle
} = require("../scripts/testFixtureManifest");
const { ROLE_ACCOUNTS, STAGES } = require("../scripts/testFixturePlan");
const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE
} = require("../scripts/testDatabaseIsolation");
const { VERIFY_CODES, verifyFixtureRecovery } = require("../scripts/verifyTestFixtureManifest");

const secret = "offline-verifier-manifest-secret-value-123456789";
const runId = "roles-run-01";
const target = { cluster: "phishguard-s5-test", database: "phishguard_s5_disposable" };
const host = "phishguard-s5-test.abcdef12.mongodb.net";
const uri = `mongodb+srv://phishguard_s5_runner:not-real@${host}/${target.database}`;

function environment(manifestPath, overrides = {}) {
  return {
    PHISHGUARD_ALLOW_LIVE_TESTS: LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: target.cluster,
    PHISHGUARD_TEST_CLUSTER_HOST: host,
    PHISHGUARD_TEST_DATABASE: target.database,
    PHISHGUARD_TEST_DB_USER: "phishguard_s5_runner",
    PHISHGUARD_TEST_MONGODB_URI: uri,
    MONGODB_URI: uri,
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "",
    PHISHGUARD_TEST_MANIFEST_SECRET: secret,
    PHISHGUARD_TEST_MANIFEST: manifestPath,
    ...overrides
  };
}

function entries() {
  return ROLE_ACCOUNTS.map((account, index) => ({
    collection: "users",
    id: `${String(index + 1).padStart(24, "0")}`,
    stage: STAGES.roles,
    identity: { email: account.email, role: account.role }
  }));
}

function withRecoveryFiles(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phishguard-fixture-verify-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    const base = createManifest({ runId, target }, secret);
    atomicWriteRecord(manifestPath, {
      ...base,
      completedStages: [STAGES.roles],
      activeStage: null,
      entries: entries()
    }, secret);
    writeLifecycle(manifestPath, { runId, target, status: "started" }, secret);
    return callback({ manifestPath, env: environment(manifestPath) });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function rewriteManifest(manifestPath, mutate) {
  const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  mutate(current);
  atomicWriteRecord(manifestPath, current, secret);
}

test("success authenticates a roles-only recovery set without exposing sensitive values", () => withRecoveryFiles(({ manifestPath, env }) => {
  const report = verifyFixtureRecovery({ env: { ...env, PHISHGUARD_TEST_RUN_ID: runId } });
  assert.equal(report.ok, true);
  assert.equal(report.entryCount, 3);
  assert.equal(report.expectedRunIdChecked, true);
  assert.equal(report.lockAbsent, true);
  const output = JSON.stringify(report);
  assert.equal(output.includes(secret), false);
  assert.equal(entries().some((entry) => output.includes(entry.id)), false);
  assert.equal(output.includes(manifestPath), false);
}));

test("success does not invent or require an absent independently recorded run ID", () => withRecoveryFiles(({ env }) => {
  const report = verifyFixtureRecovery({ env });
  assert.equal(report.ok, true);
  assert.equal(report.expectedRunIdChecked, false);
}));

test("missing manifest and lifecycle files fail closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  fs.rmSync(manifestPath);
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.manifestMissing);
  const base = createManifest({ runId, target }, secret);
  atomicWriteRecord(manifestPath, { ...base, completedStages: [STAGES.roles], entries: entries() }, secret);
  fs.rmSync(`${manifestPath}.lifecycle`);
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.lifecycleMissing);
}));

test("wrong HMAC secret fails closed", () => withRecoveryFiles(({ env }) => {
  assert.equal(verifyFixtureRecovery({
    env: { ...env, PHISHGUARD_TEST_MANIFEST_SECRET: "different-offline-secret-value-123456789" }
  }).code, VERIFY_CODES.authenticationFailed);
}));

test("mismatched manifest and lifecycle run IDs fail closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  writeLifecycle(manifestPath, { runId: "different-run", target, status: "started" }, secret);
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.runMismatch);
}));

test("active stage fails closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  rewriteManifest(manifestPath, (manifest) => { manifest.activeStage = STAGES.reports; });
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.activeStage);
}));

test("extra entry fails closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  rewriteManifest(manifestPath, (manifest) => {
    manifest.entries.push({ ...entries()[0], id: "999999999999999999999999" });
  });
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.entryCount);
}));

test("wrong role identity fails closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  rewriteManifest(manifestPath, (manifest) => { manifest.entries[1].identity.role = "user"; });
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.identities);
}));

test("unexpected completed stage fails closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  rewriteManifest(manifestPath, (manifest) => { manifest.completedStages.push(STAGES.reports); });
  assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.completedStages);
}));

test("present lifecycle lock fails closed", () => withRecoveryFiles(({ manifestPath, env }) => {
  const lock = acquireLifecycleLock(manifestPath, { runId, target }, secret);
  try {
    assert.equal(verifyFixtureRecovery({ env }).code, VERIFY_CODES.lockPresent);
  } finally {
    releaseLifecycleLock(lock, secret);
  }
}));
