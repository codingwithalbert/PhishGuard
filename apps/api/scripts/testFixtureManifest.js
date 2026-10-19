"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { STAGES, STAGE_ORDER, STAGE_PREREQUISITES } = require("./testFixturePlan");

const MANIFEST_VERSION = 2;
const MANIFEST_OWNER = "phishguard-s5-synthetic-fixtures";
const LOCK_RECOVERY_CONFIRMATION = "I-CONFIRM-NO-FIXTURE-PROCESS-RUNNING";
const REQUIRED_SECRET_LENGTH = 32;
const COLLECTION_IDENTITIES = Object.freeze({
  users: Object.freeze(["email", "role"]),
  analyses: Object.freeze(["user", "url", "risk", "score"]),
  reports: Object.freeze(["ticketNumber", "user"]),
  reportMessages: Object.freeze(["report", "sender", "message"]),
  awarenessAssessments: Object.freeze(["user", "score", "totalQuestions"]),
  phishingIdentificationAssessments: Object.freeze(["user", "score", "totalScenarios"]),
  trainingCompletions: Object.freeze(["user", "moduleId"])
});
const STAGE_COLLECTIONS = Object.freeze({
  [STAGES.roles]: Object.freeze(["users"]),
  [STAGES.cohortSuppression]: Object.freeze(["users", "awarenessAssessments", "phishingIdentificationAssessments", "trainingCompletions"]),
  [STAGES.cohortReportable]: Object.freeze(["users", "awarenessAssessments", "phishingIdentificationAssessments", "trainingCompletions"]),
  [STAGES.analyses]: Object.freeze(["analyses"]),
  [STAGES.reports]: Object.freeze(["analyses", "reports", "reportMessages"])
});
const MANIFEST_KEYS = Object.freeze([
  "activeStage", "completedStages", "database", "entries", "owner", "runId", "version", "cluster"
].sort());

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < REQUIRED_SECRET_LENGTH) {
    throw new Error("FIXTURE_MANIFEST_SECRET_INVALID");
  }
  return secret;
}

function payloadOf(record) {
  const { authentication, ...payload } = record;
  return payload;
}

function authenticationFor(record, secret) {
  return crypto.createHmac("sha256", requireSecret(secret))
    .update(JSON.stringify(payloadOf(record))).digest("hex");
}

function seal(record, secret) {
  return { ...payloadOf(record), authentication: authenticationFor(record, secret) };
}

function authenticationMatches(record, secret) {
  if (typeof record?.authentication !== "string" || !/^[a-f0-9]{64}$/.test(record.authentication)) return false;
  const expected = authenticationFor(record, secret);
  return crypto.timingSafeEqual(Buffer.from(record.authentication, "hex"), Buffer.from(expected, "hex"));
}

function isPlainScalar(value) {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (Object.keys(entry).sort().join("|") !== "collection|id|identity|stage") return false;
  if (!/^[a-f0-9]{24}$/i.test(entry.id || "") || !STAGE_ORDER.includes(entry.stage)) return false;
  if (!COLLECTION_IDENTITIES[entry.collection] || !entry.identity || Array.isArray(entry.identity)) return false;
  if (!STAGE_COLLECTIONS[entry.stage].includes(entry.collection)) return false;
  const expected = COLLECTION_IDENTITIES[entry.collection];
  const actual = Object.keys(entry.identity).sort();
  return actual.length === expected.length && expected.every((key) => actual.includes(key))
    && actual.every((key) => isPlainScalar(entry.identity[key]));
}

function stageSequenceIsValid(completedStages) {
  if (new Set(completedStages).size !== completedStages.length) return false;
  const completed = new Set();
  for (const stage of completedStages) {
    if (!STAGE_ORDER.includes(stage)) return false;
    if (!STAGE_PREREQUISITES[stage].every((required) => completed.has(required))) return false;
    completed.add(stage);
  }
  return true;
}

function verifyManifest(manifest, target, secret) {
  try { requireSecret(secret); } catch (error) { return { ok: false, reason: error.message }; }
  if (!manifest || manifest.version !== MANIFEST_VERSION || manifest.owner !== MANIFEST_OWNER) return { ok: false, reason: "MANIFEST_FORMAT_INVALID" };
  if (Object.keys(payloadOf(manifest)).sort().join("|") !== MANIFEST_KEYS.join("|")) return { ok: false, reason: "MANIFEST_FORMAT_INVALID" };
  if (manifest.cluster !== target.cluster || manifest.database !== target.database) return { ok: false, reason: "MANIFEST_TARGET_MISMATCH" };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(manifest.runId || "")) return { ok: false, reason: "MANIFEST_RUN_ID_INVALID" };
  if (!Array.isArray(manifest.completedStages) || !stageSequenceIsValid(manifest.completedStages)) return { ok: false, reason: "MANIFEST_STAGE_STATE_INVALID" };
  if (manifest.activeStage !== null && !STAGE_ORDER.includes(manifest.activeStage)) return { ok: false, reason: "MANIFEST_STAGE_STATE_INVALID" };
  if (manifest.activeStage !== null && manifest.completedStages.includes(manifest.activeStage)) return { ok: false, reason: "MANIFEST_STAGE_STATE_INVALID" };
  if (manifest.activeStage !== null && !STAGE_PREREQUISITES[manifest.activeStage].every((stage) => manifest.completedStages.includes(stage))) return { ok: false, reason: "MANIFEST_STAGE_STATE_INVALID" };
  if (!Array.isArray(manifest.entries) || !manifest.entries.every(validateEntry)) return { ok: false, reason: "MANIFEST_ENTRY_INVALID" };
  const ids = manifest.entries.map((entry) => entry.id.toLowerCase());
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "MANIFEST_DUPLICATE_ID" };
  if (!manifest.entries.every((entry) => manifest.completedStages.includes(entry.stage) || entry.stage === manifest.activeStage)) return { ok: false, reason: "MANIFEST_ENTRY_STAGE_MISMATCH" };
  if (!authenticationMatches(manifest, secret)) return { ok: false, reason: "MANIFEST_AUTHENTICATION_INVALID" };
  return { ok: true };
}

function atomicWriteRecord(filePath, record, secret, fileSystem = fs) {
  const directory = path.dirname(filePath);
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const authenticated = seal(record, secret);
  let descriptor;
  try {
    fileSystem.mkdirSync(directory, { recursive: true });
    descriptor = fileSystem.openSync(temporary, "wx", 0o600);
    fileSystem.writeFileSync(descriptor, `${JSON.stringify(authenticated, null, 2)}\n`, "utf8");
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = undefined;
    fileSystem.renameSync(temporary, filePath);
  } catch {
    if (descriptor !== undefined) try { fileSystem.closeSync(descriptor); } catch {}
    try { fileSystem.rmSync(temporary, { force: true }); } catch {}
    throw new Error("FIXTURE_RECORD_ATOMIC_WRITE_FAILED");
  }
  return authenticated;
}

function createManifest({ runId, target }, secret) {
  return seal({ version: MANIFEST_VERSION, owner: MANIFEST_OWNER, runId,
    cluster: target.cluster, database: target.database,
    completedStages: [], activeStage: null, entries: [] }, secret);
}

function readAuthenticatedRecord(filePath, secret, fileSystem = fs) {
  let record;
  try { record = JSON.parse(fileSystem.readFileSync(filePath, "utf8")); }
  catch { throw new Error("FIXTURE_RECORD_UNREADABLE"); }
  if (!authenticationMatches(record, secret)) throw new Error("FIXTURE_RECORD_AUTHENTICATION_INVALID");
  return record;
}

function readManifest(manifestPath, target, secret, fileSystem = fs) {
  const manifest = readAuthenticatedRecord(manifestPath, secret, fileSystem);
  const verdict = verifyManifest(manifest, target, secret);
  if (!verdict.ok) throw new Error(verdict.reason);
  return manifest;
}

function openManifest({ manifestPath, runId, target, secret, fileSystem = fs }) {
  if (fileSystem.existsSync(manifestPath)) return readManifest(manifestPath, target, secret, fileSystem);
  return atomicWriteRecord(manifestPath, createManifest({ runId, target }, secret), secret, fileSystem);
}

function updateManifest(manifestPath, manifest, mutate, secret, fileSystem = fs) {
  const current = readManifest(manifestPath, { cluster: manifest.cluster, database: manifest.database }, secret, fileSystem);
  if (current.authentication !== manifest.authentication) throw new Error("FIXTURE_MANIFEST_CONCURRENT_CHANGE");
  const next = JSON.parse(JSON.stringify(payloadOf(current)));
  mutate(next);
  const verdict = verifyManifest(seal(next, secret), { cluster: next.cluster, database: next.database }, secret);
  if (!verdict.ok) throw new Error(verdict.reason);
  return atomicWriteRecord(manifestPath, next, secret, fileSystem);
}

function lifecyclePath(manifestPath) { return `${manifestPath}.lifecycle`; }
function lockPath(manifestPath) { return `${manifestPath}.lock`; }

function writeLifecycle(manifestPath, { runId, target, status }, secret, fileSystem = fs) {
  return atomicWriteRecord(lifecyclePath(manifestPath), {
    version: MANIFEST_VERSION, owner: MANIFEST_OWNER, runId,
    cluster: target.cluster, database: target.database, status
  }, secret, fileSystem);
}

function readLifecycle(manifestPath, target, secret, fileSystem = fs) {
  const state = readAuthenticatedRecord(lifecyclePath(manifestPath), secret, fileSystem);
  if (state.version !== MANIFEST_VERSION || state.owner !== MANIFEST_OWNER
    || state.cluster !== target.cluster || state.database !== target.database
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(state.runId || "")
    || Object.keys(payloadOf(state)).sort().join("|") !== "cluster|database|owner|runId|status|version"
    || !["initialized", "started", "cleaned"].includes(state.status)) {
    throw new Error("FIXTURE_LIFECYCLE_INVALID");
  }
  return state;
}

function classifyMissingManifest(lifecycle) {
  if (!lifecycle) return { ok: false, reason: "FIXTURE_PROVENANCE_UNKNOWN" };
  if (lifecycle.status === "initialized" || lifecycle.status === "cleaned") {
    return { ok: true, outstandingWrites: false };
  }
  return { ok: false, reason: "FIXTURE_MANIFEST_MISSING_AFTER_START" };
}

function acquireLifecycleLock(manifestPath, { runId, target }, secret, fileSystem = fs) {
  requireSecret(secret);
  const file = lockPath(manifestPath);
  const token = crypto.randomUUID();
  let descriptor;
  try {
    fileSystem.mkdirSync(path.dirname(file), { recursive: true });
    descriptor = fileSystem.openSync(file, "wx", 0o600);
    const lock = seal({ version: MANIFEST_VERSION, owner: MANIFEST_OWNER, runId,
      cluster: target.cluster, database: target.database, pid: process.pid,
      token, createdAt: new Date().toISOString() }, secret);
    fileSystem.writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, "utf8");
    fileSystem.fsyncSync(descriptor);
    return { descriptor, file, token };
  } catch {
    if (descriptor !== undefined) try { fileSystem.closeSync(descriptor); } catch {}
    throw new Error("FIXTURE_LIFECYCLE_LOCKED");
  }
}

function releaseLifecycleLock(lock, secret, fileSystem = fs) {
  const stored = readAuthenticatedRecord(lock.file, secret, fileSystem);
  if (stored.token !== lock.token) throw new Error("FIXTURE_LOCK_OWNERSHIP_MISMATCH");
  fileSystem.closeSync(lock.descriptor);
  fileSystem.rmSync(lock.file);
}

function recoverLifecycleLock(manifestPath, { target, confirmation, isProcessAlive }, secret, fileSystem = fs) {
  if (confirmation !== LOCK_RECOVERY_CONFIRMATION) throw new Error("FIXTURE_LOCK_RECOVERY_NOT_CONFIRMED");
  const file = lockPath(manifestPath);
  const lock = readAuthenticatedRecord(file, secret, fileSystem);
  if (lock.version !== MANIFEST_VERSION || lock.owner !== MANIFEST_OWNER
    || lock.cluster !== target.cluster || lock.database !== target.database) throw new Error("FIXTURE_LOCK_INVALID");
  if (isProcessAlive(lock.pid)) throw new Error("FIXTURE_LOCK_PROCESS_ACTIVE");
  fileSystem.rmSync(file);
}

function matchesExpectedIdentity(document, identity) {
  return Boolean(document) && Object.entries(identity).every(([key, expected]) => String(document[key]) === String(expected));
}

module.exports = { COLLECTION_IDENTITIES, LOCK_RECOVERY_CONFIRMATION, MANIFEST_OWNER,
  MANIFEST_VERSION, REQUIRED_SECRET_LENGTH, acquireLifecycleLock, atomicWriteRecord,
  authenticationFor, classifyMissingManifest, createManifest, lifecyclePath, lockPath, matchesExpectedIdentity,
  openManifest, readLifecycle, readManifest, recoverLifecycleLock, releaseLifecycleLock,
  seal, updateManifest, validateEntry, verifyManifest, writeLifecycle };
