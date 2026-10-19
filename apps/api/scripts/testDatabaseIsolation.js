"use strict";

/**
 * Integration-test database isolation gate.
 *
 * PURPOSE
 *
 * Six of the seven excluded route suites call `require("dotenv").config()`, which
 * populates `process.env.MONGODB_URI` from `apps/api/.env`. Two of them then
 * call `mongoose.connect(process.env.MONGODB_URI)` directly. Nothing in the
 * current repository prevents those suites from connecting to - and writing
 * into - a development or production database.
 *
 * This module is the single place that decides whether a live integration run
 * is allowed to proceed. It is deliberately small, dependency-free, and
 * side-effect free: it never opens a connection, never loads `.env`, and never
 * reads or writes a file.
 *
 * HOW ISOLATION IS ACTUALLY ACHIEVED
 *
 * The gate does not redirect anything by itself. It authorises or refuses, and
 * the caller must then set the child's `MONGODB_URI` from
 * `PHISHGUARD_TEST_MONGODB_URI` before spawning it. That indirection is the
 * mechanism: `dotenv` never overwrites a variable that already exists in
 * `process.env`, so a pre-set `MONGODB_URI` wins over the value in `.env`.
 *
 * The caller is responsible for that copy. `verifyTestDatabase.js` documents
 * it and `harness/verify.ps1` performs it. This module cannot enforce it,
 * because it runs in a different process from the suites.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT DO
 *
 * It does not decide isolation from the database name. A database called
 * "phishguard_s5_test" proves nothing, and the same applies to a cluster whose
 * name contains "dev". A target is accepted only when it matches an explicit,
 * human-supplied declaration of cluster, host, database, and database user, and
 * when the operator has separately attested that the cluster is disposable and
 * that the database user is scoped to it.
 *
 * Those two attestations are the acknowledged weak point. They are human
 * statements, not machine-verifiable facts, and no offline check can turn them
 * into proof. See `docs/s5-test-environment.md` for the operator procedure that
 * makes them trustworthy in practice.
 */

// The single value the operator must set to authorise any live integration run.
const LIVE_TESTS_AUTHORIZATION_VALUE = "1";

// Literal attestations. These must be typed exactly; a near miss fails closed.
const ISOLATION_ATTESTATION =
  "I-CONFIRM-DISPOSABLE-NOT-DEV-NOT-PROD";
const DATABASE_SCOPE_ATTESTATION =
  "I-CONFIRM-READWRITE-ON-THIS-DATABASE-ONLY";

// Only Atlas Serverless-style SRV hosts are accepted. A `mongodb://` host with a
// port is a different deployment shape and is refused rather than assumed.
const REQUIRED_SCHEME = "mongodb+srv";
const REQUIRED_HOST_SUFFIX = ".mongodb.net";

const REQUIRED_DECLARATIONS = Object.freeze([
  "PHISHGUARD_TEST_CLUSTER",
  "PHISHGUARD_TEST_CLUSTER_HOST",
  "PHISHGUARD_TEST_DATABASE",
  "PHISHGUARD_TEST_DB_USER",
  "PHISHGUARD_TEST_MONGODB_URI"
]);

/**
 * Stable machine-readable failure codes.
 *
 * Every rejection path in this module resolves to exactly one of these. They
 * are deliberately terse and value-free: a reason code can be logged, pasted
 * into a ticket, or asserted in a test without ever carrying a credential, a
 * hostname, or a connection string.
 */
const ISOLATION_REASONS = Object.freeze({
  liveTestsNotAuthorized: "LIVE_TESTS_NOT_AUTHORIZED",
  isolationNotConfirmed: "ISOLATION_NOT_CONFIRMED",
  databaseScopeNotConfirmed: "DATABASE_SCOPE_NOT_CONFIRMED",
  testDeclarationIncomplete: "TEST_DECLARATION_INCOMPLETE",
  testUriMissing: "TEST_URI_MISSING",
  testUriMalformed: "TEST_URI_MALFORMED",
  testUriSchemeUnsupported: "TEST_URI_SCHEME_UNSUPPORTED",
  testUriPasswordMissing: "TEST_URI_PASSWORD_MISSING",
  testDatabaseNameMismatch: "TEST_DATABASE_NAME_MISMATCH",
  testDatabaseUserMismatch: "TEST_DATABASE_USER_MISMATCH",
  testClusterHostMismatch: "TEST_CLUSTER_HOST_MISMATCH",
  testClusterNameMismatch: "TEST_CLUSTER_NAME_MISMATCH",
  testClusterSuffixUnexpected: "TEST_CLUSTER_SUFFIX_UNEXPECTED",
  testUriEqualsActiveDatabase: "TEST_URI_EQUALS_ACTIVE_MONGODB_URI"
});

const REASON_MESSAGES = Object.freeze({
  [ISOLATION_REASONS.liveTestsNotAuthorized]:
    "Live integration tests are not authorized. Set PHISHGUARD_ALLOW_LIVE_TESTS=1 to opt in.",
  [ISOLATION_REASONS.isolationNotConfirmed]:
    "The operator has not attested that the target is disposable. Set PHISHGUARD_TEST_ISOLATION_CONFIRMED to the exact confirmation phrase.",
  [ISOLATION_REASONS.databaseScopeNotConfirmed]:
    "The operator has not attested the database-user scope. Set PHISHGUARD_TEST_DB_SCOPE_CONFIRMED to the exact confirmation phrase.",
  [ISOLATION_REASONS.testDeclarationIncomplete]:
    "The disposable target declaration is incomplete. Every PHISHGUARD_TEST_* declaration variable must be set.",
  [ISOLATION_REASONS.testUriMissing]:
    "No dedicated test connection string was supplied. Set PHISHGUARD_TEST_MONGODB_URI; the gate never falls back to MONGODB_URI or to apps/api/.env.",
  [ISOLATION_REASONS.testUriMalformed]:
    "The supplied test connection string could not be parsed.",
  [ISOLATION_REASONS.testUriSchemeUnsupported]:
    "Only an Atlas mongodb+srv connection string is accepted for live integration testing.",
  [ISOLATION_REASONS.testUriPasswordMissing]:
    "The supplied test connection string carries no password.",
  [ISOLATION_REASONS.testDatabaseNameMismatch]:
    "The connection string's database does not match the declared disposable database.",
  [ISOLATION_REASONS.testDatabaseUserMismatch]:
    "The connection string's database user does not match the declared database user.",
  [ISOLATION_REASONS.testClusterHostMismatch]:
    "The connection string's host does not match the declared test cluster host.",
  [ISOLATION_REASONS.testClusterNameMismatch]:
    "The connection string's host does not begin with the declared cluster name.",
  [ISOLATION_REASONS.testClusterSuffixUnexpected]:
    "The declared cluster host is not an Atlas mongodb.net hostname.",
  [ISOLATION_REASONS.testUriEqualsActiveDatabase]:
    "The test connection string is identical to the active MONGODB_URI. Refusing, because that would target the existing database."
});

/**
 * A gate rejection.
 *
 * `message` is the fixed sanitized sentence for the reason code. `reason` is the
 * machine-readable code. Neither ever contains a hostname, a username, a
 * password, a database name, or any part of a connection string, so this error
 * is safe to print, log, or serialise.
 */
class IsolationGateError extends Error {
  constructor(reason) {
    super(REASON_MESSAGES[reason] || "The disposable test target was refused.");

    this.name = "IsolationGateError";
    this.reason = reason;
  }
}

// Parsed by hand rather than with `URL` so that no library error message, and no
// thrown value, can ever contain part of a connection string. The password is
// matched only to establish that one is present; it is never captured.
//
// The character classes are deliberately tight: a hostname may not contain
// whitespace or a path separator, so a malformed value is rejected as malformed
// rather than silently accepted with a nonsense host.
const CONNECTION_STRING_PATTERN =
  /^(mongodb(?:\+srv)?):\/\/(?:([^\s:@/]+)(?::([^\s@/]*))?@)?([A-Za-z0-9._-]+)(?:\/([^?\s]*))?(?:\?(.*))?$/;

/**
 * Extracts the non-secret structural facts from a connection string.
 *
 * Returns `null` when the string cannot be parsed. The returned object contains
 * no password field by construction, so it is safe to log.
 */
function parseAtlasTarget(uri) {
  if (typeof uri !== "string" || uri.length === 0) {
    return null;
  }

  const match = CONNECTION_STRING_PATTERN.exec(uri);

  if (!match) {
    return null;
  }

  const [, scheme, username, password, host, database] = match;

  if (typeof host !== "string" || host.length === 0) {
    return null;
  }

  let decodedDatabase = null;

  if (typeof database === "string" && database.length > 0) {
    try {
      decodedDatabase = decodeURIComponent(database);
    } catch {
      return null;
    }
  }

  return {
    scheme,
    username: typeof username === "string" && username.length > 0 ? username : null,
    hasPassword: typeof password === "string" && password.length > 0,
    host: host.toLowerCase(),
    database: decodedDatabase
  };
}

/**
 * Evaluates the environment and returns a verdict. Never throws.
 *
 * Checks run in a fixed order and the first failure wins, so the reported
 * reason is stable and reproducible rather than order-dependent on how many
 * problems happen to exist.
 */
function evaluateTestDatabaseEnvironment(env = {}, { substitutedChild = false } = {}) {
  const checks = [];

  function refuse(reason) {
    checks.push(reason);

    return { ok: false, reason, checks };
  }

  if (env.PHISHGUARD_ALLOW_LIVE_TESTS !== LIVE_TESTS_AUTHORIZATION_VALUE) {
    return refuse(ISOLATION_REASONS.liveTestsNotAuthorized);
  }

  if (env.PHISHGUARD_TEST_ISOLATION_CONFIRMED !== ISOLATION_ATTESTATION) {
    return refuse(ISOLATION_REASONS.isolationNotConfirmed);
  }

  if (env.PHISHGUARD_TEST_DB_SCOPE_CONFIRMED !== DATABASE_SCOPE_ATTESTATION) {
    return refuse(ISOLATION_REASONS.databaseScopeNotConfirmed);
  }

  const missingDeclaration = REQUIRED_DECLARATIONS.filter(
    (name) => typeof env[name] !== "string" || env[name].trim().length === 0
  );

  if (missingDeclaration.length > 0) {
    // The variable NAMES are safe to report; their values are not, and are not
    // read here beyond the emptiness test above.
    return refuse(ISOLATION_REASONS.testDeclarationIncomplete);
  }

  const testUri = env.PHISHGUARD_TEST_MONGODB_URI;

  // Which database was the operator pointed at BEFORE anything was authorised?
  //
  // Normally that is the inherited `MONGODB_URI` - typically the value the
  // operator's `.env` supplied. Inside a launcher child it is different: the
  // launcher has already overwritten `MONGODB_URI` with the verified test URI,
  // so comparing against the current `MONGODB_URI` would always compare the test
  // URI with itself and refuse every legitimate run.
  //
  // Only a child explicitly opting into the substituted-child check may use
  // the marker. The initial launcher gate must not trust a value inherited
  // from the operator's environment, even if it claims to be empty.
  //
  // An EMPTY marker means the shell carried no `MONGODB_URI` at all, so there is
  // no pre-existing target to compare against and nothing to refuse.
  const marker = env.PHISHGUARD_TEST_ORIGINAL_MONGODB_URI;
  if (substitutedChild && (
    typeof marker !== "string" || env.MONGODB_URI !== testUri
  )) {
    return refuse(ISOLATION_REASONS.testUriEqualsActiveDatabase);
  }

  const originalUri = substitutedChild ? marker : env.MONGODB_URI;

  // Refusing a test URI identical to the pre-existing one is the single most
  // important check in this module: it is the difference between "the operator
  // declared the disposable cluster" and "the operator pointed the disposable
  // configuration at the real database".
  if (
    typeof originalUri === "string" &&
    originalUri.length > 0 &&
    originalUri === testUri
  ) {
    return refuse(ISOLATION_REASONS.testUriEqualsActiveDatabase);
  }

  const target = parseAtlasTarget(testUri);

  if (!target) {
    return refuse(ISOLATION_REASONS.testUriMalformed);
  }

  if (target.scheme !== REQUIRED_SCHEME) {
    return refuse(ISOLATION_REASONS.testUriSchemeUnsupported);
  }

  if (!target.hasPassword) {
    return refuse(ISOLATION_REASONS.testUriPasswordMissing);
  }

  if (!target.database || target.database !== env.PHISHGUARD_TEST_DATABASE) {
    return refuse(ISOLATION_REASONS.testDatabaseNameMismatch);
  }

  if (!target.username || target.username !== env.PHISHGUARD_TEST_DB_USER) {
    return refuse(ISOLATION_REASONS.testDatabaseUserMismatch);
  }

  const declaredHost = String(env.PHISHGUARD_TEST_CLUSTER_HOST || "").toLowerCase();
  const declaredCluster = String(env.PHISHGUARD_TEST_CLUSTER || "").toLowerCase();

  if (!declaredHost.endsWith(REQUIRED_HOST_SUFFIX)) {
    return refuse(ISOLATION_REASONS.testClusterSuffixUnexpected);
  }

  if (target.host !== declaredHost) {
    return refuse(ISOLATION_REASONS.testClusterHostMismatch);
  }

  // Atlas SRV hosts are `<cluster>.<hash>.mongodb.net`. Checking that the first
  // label is the declared cluster ties the host to the declaration rather than
  // accepting any Atlas host at all.
  const hostPrefix = `${declaredCluster}.`;

  if (!declaredCluster || target.host.indexOf(hostPrefix) !== 0) {
    return refuse(ISOLATION_REASONS.testClusterNameMismatch);
  }

  return {
    ok: true,
    checks: [],
    // NOTE: this object deliberately has no `uri`, no `username`, and no
    // `password` field. It is what gets printed, logged, and asserted on.
    target: {
      scheme: target.scheme,
      cluster: declaredCluster,
      hostPattern: `${declaredCluster}.<redacted>.mongodb.net`,
      database: env.PHISHGUARD_TEST_DATABASE,
      usernameProvided: Boolean(target.username),
      usernameMatchesDeclaration: target.username === env.PHISHGUARD_TEST_DB_USER,
      passwordProvided: target.hasPassword
    }
  };
}

/**
 * Authorises a live integration run, or throws.
 *
 * The thrown error carries only a reason code and a fixed sentence, so callers
 * may print `error.message` without any risk of disclosure.
 */
function verifyTestDatabaseEnvironment(env = process.env) {
  const verdict = evaluateTestDatabaseEnvironment(env);

  if (!verdict.ok) {
    throw new IsolationGateError(verdict.reason);
  }

  return verdict;
}

/**
 * The exact child-process environment a verified run needs.
 *
 * Returns the SET of variable names that must be copied into the child, not
 * their values. This keeps the credential inside the spawning shell and out of
 * every object a test or a log can reach.
 */
function requiredChildEnvironmentNames() {
  return Object.freeze([...REQUIRED_DECLARATIONS]);
}

module.exports = {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  ISOLATION_REASONS,
  IsolationGateError,
  LIVE_TESTS_AUTHORIZATION_VALUE,
  REQUIRED_DECLARATIONS,
  REQUIRED_HOST_SUFFIX,
  REQUIRED_SCHEME,
  evaluateTestDatabaseEnvironment,
  parseAtlasTarget,
  requiredChildEnvironmentNames,
  verifyTestDatabaseEnvironment
};
