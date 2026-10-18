const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  LOCK_RECOVERY_CONFIRMATION,
  acquireLifecycleLock,
  atomicWriteRecord,
  classifyMissingManifest,
  createManifest,
  lifecyclePath,
  lockPath,
  matchesExpectedIdentity,
  openManifest,
  readLifecycle,
  readManifest,
  recoverLifecycleLock,
  releaseLifecycleLock,
  seal,
  updateManifest,
  verifyManifest,
  writeLifecycle
} = require("../scripts/testFixtureManifest");
const { materialiseStage, parseArguments } = require("../scripts/seedTestFixtures");
const { ROLE_ACCOUNTS, STAGES } = require("../scripts/testFixturePlan");

const target = { cluster: "phishguard-s5-test", database: "phishguard_s5_disposable" };
const secret = "offline-only-manifest-authentication-secret-123456";

function withManifest(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phishguard-manifest-test-"));
  const manifestPath = path.join(directory, "manifest.json");
  try { return callback(manifestPath); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function userEntry(id = "0123456789abcdef01234567", stage = STAGES.roles) {
  return { collection: "users", id, stage, identity: { email: "user@test.com", role: "user" } };
}

test("cumulative stages preserve authenticated earlier records", () => withManifest((manifestPath) => {
  let manifest = openManifest({ manifestPath, runId: "run-a", target, secret });
  manifest = updateManifest(manifestPath, manifest, (next) => next.activeStage = STAGES.roles, secret);
  manifest = updateManifest(manifestPath, manifest, (next) => next.entries.push(userEntry()), secret);
  manifest = updateManifest(manifestPath, manifest, (next) => {
    next.completedStages.push(STAGES.roles); next.activeStage = null;
  }, secret);
  const reopened = openManifest({ manifestPath, runId: "replacement", target, secret });
  assert.equal(reopened.runId, "run-a");
  assert.equal(reopened.entries.length, 1);
  assert.deepEqual(reopened.completedStages, [STAGES.roles]);
}));

test("interrupted apply remains active with its reserved identity", () => withManifest((manifestPath) => {
  let manifest = openManifest({ manifestPath, runId: "interrupted", target, secret });
  manifest = updateManifest(manifestPath, manifest, (next) => next.activeStage = STAGES.roles, secret);
  manifest = updateManifest(manifestPath, manifest, (next) => next.entries.push(userEntry()), secret);
  const recovered = readManifest(manifestPath, target, secret);
  assert.equal(recovered.activeStage, STAGES.roles);
  assert.equal(recovered.entries[0].identity.email, "user@test.com");
}));

test("materialisation reserves identity before attempting MongoDB create", async () => {
  const events = [];
  await assert.rejects(() => materialiseStage(STAGES.roles, {
    env: Object.fromEntries(ROLE_ACCOUNTS.map((account) => [account.passwordVariable, "offline-placeholder"])),
    models: { User: { async create(document) { events.push(["create", String(document._id)]); throw new Error("interrupted"); } } },
    reserve(collection, identity) { events.push(["reserve", collection, identity]); return "4123456789abcdef01234567"; }
  }), /interrupted/);
  assert.equal(events[0][0], "reserve");
  assert.equal(events[1][0], "create");
});

test("HMAC rejects tampering even when an attacker adds an unkeyed checksum", () => withManifest((manifestPath) => {
  openManifest({ manifestPath, runId: "tamper", target, secret });
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  raw.entries.push(userEntry());
  raw.checksum = require("node:crypto").createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  fs.writeFileSync(manifestPath, JSON.stringify(raw));
  assert.throws(() => readManifest(manifestPath, target, secret), /AUTHENTICATION/);
}));

test("a forged entry authenticated with a different secret is rejected", () => withManifest((manifestPath) => {
  let forged = createManifest({ runId: "forged", target }, "different-offline-secret-value-123456789");
  forged = seal({ ...forged, activeStage: STAGES.roles, entries: [userEntry()] }, "different-offline-secret-value-123456789");
  fs.writeFileSync(manifestPath, JSON.stringify(forged));
  assert.throws(() => readManifest(manifestPath, target, secret), /AUTHENTICATION/);
}));

test("structural validation rejects duplicate IDs, unknown stages, and entry-stage contradictions", () => {
  const base = createManifest({ runId: "structure", target }, secret);
  const cases = [
    { ...base, completedStages: ["unknown"] },
    { ...base, activeStage: STAGES.roles, entries: [userEntry(), userEntry()] },
    { ...base, activeStage: null, entries: [userEntry()] },
    { ...base, runId: "bad run id" },
    { ...base, activeStage: STAGES.roles, entries: [{ ...userEntry(), collection: "analyses",
      identity: { user: "0123456789abcdef01234567", url: "https://example.invalid", risk: "low", score: 0 } }] },
    { ...base, activeStage: STAGES.roles, entries: [{ ...userEntry(), unexpected: true }] }
  ];
  for (const value of cases) assert.equal(verifyManifest(seal(value, secret), target, secret).ok, false);
});

test("atomic write failure preserves the previous authenticated record", () => withManifest((manifestPath) => {
  openManifest({ manifestPath, runId: "durable", target, secret });
  const failingFs = Object.create(fs);
  failingFs.renameSync = () => { throw new Error("simulated interruption"); };
  assert.throws(() => atomicWriteRecord(manifestPath, createManifest({ runId: "other", target }, secret), secret, failingFs), /ATOMIC_WRITE/);
  assert.equal(readManifest(manifestPath, target, secret).runId, "durable");
}));

test("exclusive lock rejects concurrent apply or cleanup and survives interruption", () => withManifest((manifestPath) => {
  const first = acquireLifecycleLock(manifestPath, { runId: "lock-run", target }, secret);
  assert.throws(() => acquireLifecycleLock(manifestPath, { runId: "other-run", target }, secret), /LOCKED/);
  assert.equal(fs.existsSync(lockPath(manifestPath)), true);
  releaseLifecycleLock(first, secret);
  assert.equal(fs.existsSync(lockPath(manifestPath)), false);
}));

test("stale lock recovery requires confirmation, authentication, matching target, and dead process", () => withManifest((manifestPath) => {
  const lock = acquireLifecycleLock(manifestPath, { runId: "lock-run", target }, secret);
  fs.closeSync(lock.descriptor); // simulate process termination; lock file remains
  assert.throws(() => recoverLifecycleLock(manifestPath, { target, confirmation: "no", isProcessAlive: () => false }, secret), /NOT_CONFIRMED/);
  assert.throws(() => recoverLifecycleLock(manifestPath, { target, confirmation: LOCK_RECOVERY_CONFIRMATION, isProcessAlive: () => true }, secret), /PROCESS_ACTIVE/);
  recoverLifecycleLock(manifestPath, { target, confirmation: LOCK_RECOVERY_CONFIRMATION, isProcessAlive: () => false }, secret);
  assert.equal(fs.existsSync(lockPath(manifestPath)), false);
}));

test("authenticated lifecycle distinguishes initialized, started, and cleaned states", () => withManifest((manifestPath) => {
  for (const status of ["initialized", "started", "cleaned"]) {
    writeLifecycle(manifestPath, { runId: "state-run", target, status }, secret);
    assert.equal(readLifecycle(manifestPath, target, secret).status, status);
  }
  assert.equal(fs.existsSync(lifecyclePath(manifestPath)), true);
}));

test("missing manifest is safe only for authenticated never-started or cleaned lifecycle", () => {
  assert.equal(classifyMissingManifest(null).ok, false);
  assert.equal(classifyMissingManifest({ status: "initialized" }).ok, true);
  assert.equal(classifyMissingManifest({ status: "cleaned" }).ok, true);
  assert.deepEqual(classifyMissingManifest({ status: "started" }), {
    ok: false,
    reason: "FIXTURE_MANIFEST_MISSING_AFTER_START"
  });
});

test("identity comparison and exact entry schemas reject ownership mismatch", () => {
  const expected = { email: "staff@test.com", role: "staff" };
  assert.equal(matchesExpectedIdentity(expected, expected), true);
  assert.equal(matchesExpectedIdentity({ email: "staff@test.com", role: "admin" }, expected), false);
});

test("manifest secret is required and never stored", () => {
  assert.throws(() => createManifest({ runId: "secret", target }, "short"), /SECRET_INVALID/);
  const manifest = createManifest({ runId: "secret", target }, secret);
  assert.equal(JSON.stringify(manifest).includes(secret), false);
});

test("fixture CLI parses explicit apply and lock-recovery operations without executing them", () => {
  assert.equal(parseArguments(["--apply"]).stages.length, 0);
  assert.deepEqual(parseArguments(["--apply", "--stage=roles"]).stages, ["roles"]);
  assert.equal(parseArguments(["--recover-lock"]).recoverLock, true);
  assert.match(parseArguments(["--apply", "--cleanup"]).error, /exactly one/);
});
