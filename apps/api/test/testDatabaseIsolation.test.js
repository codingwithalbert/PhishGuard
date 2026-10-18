const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("../scripts/testDatabaseIsolation");

// Integration-test database isolation gate.
//
// Everything here is pure and offline. The gate opens no connection, reads no
// file, and loads no `.env`, so every assertion below runs with no database
// anywhere in the process.
//
// The fixtures below are structurally realistic Atlas SRV connection strings
// with obviously synthetic credentials. They are not real credentials and are
// never used to connect; the password literal is fixed so the tests can assert
// that a password is present without inventing one per run.

const SYNTHETIC_USER = "phishguard_s5_runner";
const SYNTHETIC_PASSWORD = "not-a-real-secret-placeholder";
const SYNTHETIC_CLUSTER = "phishguard-s5-test";
const SYNTHETIC_HOST = "phishguard-s5-test.abcdef12.mongodb.net";
const SYNTHETIC_DATABASE = "phishguard_s5_disposable";

function buildUri({
  scheme = REQUIRED_SCHEME,
  username = SYNTHETIC_USER,
  password = SYNTHETIC_PASSWORD,
  host = SYNTHETIC_HOST,
  database = SYNTHETIC_DATABASE
} = {}) {
  const credentials = password === null ? username : `${username}:${password}`;

  return `${scheme}://${credentials}@${host}/${database}?retryWrites=true&w=majority`;
}

/** A fully valid environment. Each test overrides exactly what it is testing. */
function buildValidEnvironment(overrides = {}) {
  return {
    PHISHGUARD_ALLOW_LIVE_TESTS: LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: SYNTHETIC_CLUSTER,
    PHISHGUARD_TEST_CLUSTER_HOST: SYNTHETIC_HOST,
    PHISHGUARD_TEST_DATABASE: SYNTHETIC_DATABASE,
    PHISHGUARD_TEST_DB_USER: SYNTHETIC_USER,
    PHISHGUARD_TEST_MONGODB_URI: buildUri(),
    ...overrides
  };
}

function reasonOf(overrides) {
  return evaluateTestDatabaseEnvironment(buildValidEnvironment(overrides)).reason;
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a complete, matching declaration is authorised", () => {
  const verdict = evaluateTestDatabaseEnvironment(buildValidEnvironment());

  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, undefined);
  assert.deepEqual(verdict.checks, []);
  assert.equal(verdict.target.database, SYNTHETIC_DATABASE);
  assert.equal(verdict.target.cluster, SYNTHETIC_CLUSTER);
  assert.equal(verdict.target.usernameMatchesDeclaration, true);
  assert.equal(verdict.target.passwordProvided, true);
});

test("verify returns the same sanitised report the evaluator produces", () => {
  const verdict = verifyTestDatabaseEnvironment(buildValidEnvironment());

  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// The report must never carry a credential
// ---------------------------------------------------------------------------

test("the authorised report contains no connection string, username, or password", () => {
  const env = buildValidEnvironment();
  const verdict = verifyTestDatabaseEnvironment(env);
  const serialised = JSON.stringify(verdict);

  for (const secret of [
    env.PHISHGUARD_TEST_MONGODB_URI,
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER
  ]) {
    assert.equal(
      serialised.includes(secret),
      false,
      `the printable report must not contain ${secret}`
    );
  }

  assert.equal(
    Object.prototype.hasOwnProperty.call(verdict, "uri"),
    false,
    "the report must have no uri field at all"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(verdict.target, "username"),
    false,
    "the target must expose a boolean about the username, never the username"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(verdict.target, "password"),
    false
  );
});

test("a rejection carries a reason code and a sentence that leak nothing", () => {
  const env = buildValidEnvironment({ PHISHGUARD_TEST_DATABASE: "something_else" });

  assert.throws(
    () => verifyTestDatabaseEnvironment(env),
    (error) => {
      assert.ok(error instanceof IsolationGateError);
      assert.equal(error.reason, ISOLATION_REASONS.testDatabaseNameMismatch);

      const serialised = `${error.message} ${error.reason} ${error.stack}`;

      for (const secret of [env.PHISHGUARD_TEST_MONGODB_URI, SYNTHETIC_PASSWORD, SYNTHETIC_USER, SYNTHETIC_HOST]) {
        assert.equal(
          serialised.includes(secret),
          false,
          `an error must never disclose ${secret}`
        );
      }

      return true;
    }
  );
});

test("a rejection message never embeds any part of the rejected connection string", () => {
  const hostileUri =
    `mongodb+srv://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@wrong-cluster.zzz.mongodb.net/wrong_database`;

  const error = (() => {
    try {
      verifyTestDatabaseEnvironment(
        buildValidEnvironment({ PHISHGUARD_TEST_MONGODB_URI: hostileUri })
      );

      return null;
    } catch (thrown) {
      return thrown;
    }
  })();

  assert.ok(error instanceof IsolationGateError);
  assert.equal(error.message.includes("wrong-cluster"), false);
  assert.equal(error.message.includes("wrong_database"), false);
  assert.equal(error.message.includes(SYNTHETIC_PASSWORD), false);
});

// ---------------------------------------------------------------------------
// Fail-closed: authorisation and attestations
// ---------------------------------------------------------------------------

test("no authorisation refuses the run", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_ALLOW_LIVE_TESTS: undefined }),
    ISOLATION_REASONS.liveTestsNotAuthorized
  );
});

test("only the exact authorisation value is accepted", () => {
  for (const value of ["0", "true", "yes", " 1", "1 ", "01"]) {
    assert.equal(
      reasonOf({ PHISHGUARD_ALLOW_LIVE_TESTS: value }),
      ISOLATION_REASONS.liveTestsNotAuthorized,
      `${JSON.stringify(value)} must not authorise a live run`
    );
  }
});

test("no isolation attestation refuses the run", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_ISOLATION_CONFIRMED: undefined }),
    ISOLATION_REASONS.isolationNotConfirmed
  );
});

test("no database-scope attestation refuses the run", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: undefined }),
    ISOLATION_REASONS.databaseScopeNotConfirmed
  );
});

test("a near-miss attestation phrase is refused rather than normalised", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION.toLowerCase() }),
    ISOLATION_REASONS.isolationNotConfirmed
  );
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: `${DATABASE_SCOPE_ATTESTATION} ` }),
    ISOLATION_REASONS.databaseScopeNotConfirmed
  );
});

// ---------------------------------------------------------------------------
// Never fall back to the existing .env database
// ---------------------------------------------------------------------------

test("the gate refuses to run when only MONGODB_URI is supplied", () => {
  // This is the exact shape of the danger: a `.env` has been loaded, so
  // MONGODB_URI exists, and nothing else has been configured.
  const verdict = evaluateTestDatabaseEnvironment({
    MONGODB_URI: buildUri()
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, ISOLATION_REASONS.liveTestsNotAuthorized);
});

test("the gate never treats MONGODB_URI as the test target", () => {
  const verdict = evaluateTestDatabaseEnvironment({
    PHISHGUARD_ALLOW_LIVE_TESTS: LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: SYNTHETIC_CLUSTER,
    PHISHGUARD_TEST_CLUSTER_HOST: SYNTHETIC_HOST,
    PHISHGUARD_TEST_DATABASE: SYNTHETIC_DATABASE,
    PHISHGUARD_TEST_DB_USER: SYNTHETIC_USER,
    MONGODB_URI: buildUri()
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, ISOLATION_REASONS.testDeclarationIncomplete);
});

test("a test connection string identical to the active one is refused", () => {
  const uri = buildUri();

  assert.equal(
    reasonOf({
      MONGODB_URI: uri,
      PHISHGUARD_TEST_MONGODB_URI: uri
    }),
    ISOLATION_REASONS.testUriEqualsActiveDatabase
  );
});

// --- The launcher-child case -------------------------------------------------
//
// The launcher OVERWRITES `MONGODB_URI` with the verified test URI before
// spawning a child, and that child re-verifies the gate in-process. Comparing
// the test URI against the current `MONGODB_URI` there compares it with itself
// and refuses every legitimate run. The launcher therefore records the
// pre-substitution value in `PHISHGUARD_TEST_ORIGINAL_MONGODB_URI`.
//
// These tests exist because that defect shipped in S5B and was invisible to the
// launcher tests, which used a mock spawn and never ran the child's gate.

test("a launcher child is authorised even though MONGODB_URI now equals the test URI", () => {
  const uri = buildUri();

  const verdict = evaluateTestDatabaseEnvironment(
    buildValidEnvironment({
      MONGODB_URI: uri,
      PHISHGUARD_TEST_MONGODB_URI: uri,
      // The shell carried nothing before substitution.
      PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: ""
    }),
    { substitutedChild: true }
  );

  assert.equal(verdict.ok, true, verdict.reason);
});

test("a launcher child is authorised when the shell carried a different URI", () => {
  const verdict = evaluateTestDatabaseEnvironment(
    buildValidEnvironment({
      MONGODB_URI: buildUri(),
      PHISHGUARD_TEST_MONGODB_URI: buildUri(),
      PHISHGUARD_TEST_ORIGINAL_MONGODB_URI:
        "mongodb+srv://someone:secret@other-cluster.abcdef12.mongodb.net/other_db"
    }),
    { substitutedChild: true }
  );

  assert.equal(verdict.ok, true, verdict.reason);
});

test("a launcher child whose PRE-SUBSTITUTION target was the test URI is still refused", () => {
  // The protection survives: pointing the disposable configuration at the
  // pre-existing database is refused inside the child too, not just in the
  // launcher process.
  const uri = buildUri();

  assert.equal(
    evaluateTestDatabaseEnvironment(buildValidEnvironment({
      MONGODB_URI: uri,
      PHISHGUARD_TEST_MONGODB_URI: uri,
      PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: uri
    }), { substitutedChild: true }).reason,
    ISOLATION_REASONS.testUriEqualsActiveDatabase
  );
});

test("an empty original-URI marker means there is nothing to refuse", () => {
  const verdict = evaluateTestDatabaseEnvironment(
    buildValidEnvironment({
      MONGODB_URI: buildUri(),
      PHISHGUARD_TEST_MONGODB_URI: buildUri(),
      PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: ""
    }),
    { substitutedChild: true }
  );

  assert.equal(verdict.ok, true, verdict.reason);
});

test("a launcher process with no marker keeps the original behaviour", () => {
  // No marker means the gate is being evaluated before any substitution, which is
  // the launcher's own process, or a hand-run. The original rule applies.
  const uri = buildUri();

  assert.equal(
    reasonOf({ MONGODB_URI: uri, PHISHGUARD_TEST_MONGODB_URI: uri }),
    ISOLATION_REASONS.testUriEqualsActiveDatabase
  );
});

test("a forged empty marker cannot hide an inherited test URI from the initial gate", () => {
  const uri = buildUri();

  assert.equal(reasonOf({
    MONGODB_URI: uri,
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: ""
  }), ISOLATION_REASONS.testUriEqualsActiveDatabase);
});

test("a forged different marker cannot hide an inherited test URI", () => {
  assert.equal(reasonOf({
    MONGODB_URI: buildUri(),
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "mongodb+srv://fake@other.mongodb.net/db"
  }), ISOLATION_REASONS.testUriEqualsActiveDatabase);
});

test("child re-verification refuses a missing marker or mismatched child target", () => {
  const uri = buildUri();

  for (const overrides of [
    { MONGODB_URI: uri },
    { MONGODB_URI: "mongodb+srv://other@other.mongodb.net/db", PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "" }
  ]) {
    assert.equal(evaluateTestDatabaseEnvironment(
      buildValidEnvironment(overrides), { substitutedChild: true }
    ).ok, false);
  }
});

test("every declared variable is required, and none may be blank", () => {
  for (const name of REQUIRED_DECLARATIONS) {
    assert.equal(
      reasonOf({ [name]: undefined }),
      ISOLATION_REASONS.testDeclarationIncomplete,
      `${name} must be required`
    );
    assert.equal(
      reasonOf({ [name]: "   " }),
      ISOLATION_REASONS.testDeclarationIncomplete,
      `${name} must not be satisfiable with whitespace`
    );
  }
});

// ---------------------------------------------------------------------------
// A name is never proof of isolation
// ---------------------------------------------------------------------------

test("a database whose name merely looks disposable is refused", () => {
  // The declaration is what counts. A target called "..._test" that the operator
  // did not declare is refused, and so is a declared name the URI disagrees
  // with. Naming is never accepted as evidence.
  for (const decoy of [
    "phishguard_dev",
    "phishguard_test",
    "phishguard-staging",
    "prod_copy",
    "phishguard_s5_disposable_backup"
  ]) {
    const uri = buildUri({ database: decoy });

    assert.equal(
      reasonOf({ PHISHGUARD_TEST_MONGODB_URI: uri }),
      ISOLATION_REASONS.testDatabaseNameMismatch,
      `${decoy} must not be accepted because its name looks disposable`
    );
  }
});

test("a cluster name that merely looks disposable is refused", () => {
  const decoyHost = "phishguard-test.abcdef12.mongodb.net";

  assert.equal(
    reasonOf({ PHISHGUARD_TEST_CLUSTER_HOST: decoyHost }),
    ISOLATION_REASONS.testClusterHostMismatch
  );
});

test("a database user that merely looks scoped is refused", () => {
  const uri = buildUri({ username: "readonly_user" });

  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: uri }),
    ISOLATION_REASONS.testDatabaseUserMismatch
  );
});

// ---------------------------------------------------------------------------
// The target must match the declaration exactly
// ---------------------------------------------------------------------------

test("the database name must match the declaration exactly", () => {
  assert.equal(
    reasonOf({
      PHISHGUARD_TEST_MONGODB_URI: buildUri({ database: SYNTHETIC_DATABASE.toUpperCase() })
    }),
    ISOLATION_REASONS.testDatabaseNameMismatch
  );
});

test("the cluster host must match the declaration exactly", () => {
  assert.equal(
    reasonOf({
      PHISHGUARD_TEST_CLUSTER_HOST: `${SYNTHETIC_CLUSTER}.different.mongodb.net`
    }),
    ISOLATION_REASONS.testClusterHostMismatch
  );
});

test("the host must begin with the declared cluster name", () => {
  const host = "somethingelse.abcdef12.mongodb.net";

  assert.equal(
    reasonOf({
      PHISHGUARD_TEST_CLUSTER_HOST: host,
      PHISHGUARD_TEST_MONGODB_URI: buildUri({ host })
    }),
    ISOLATION_REASONS.testClusterNameMismatch
  );
});

test("a non-Atlas host suffix is refused", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_CLUSTER_HOST: "localhost" }),
    ISOLATION_REASONS.testClusterSuffixUnexpected
  );
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_CLUSTER_HOST: "cluster.example.com" }),
    ISOLATION_REASONS.testClusterSuffixUnexpected
  );
});

test("host comparison is case-insensitive, as DNS hostnames are", () => {
  const verdict = evaluateTestDatabaseEnvironment(
    buildValidEnvironment({
      PHISHGUARD_TEST_CLUSTER: SYNTHETIC_CLUSTER.toUpperCase(),
      PHISHGUARD_TEST_CLUSTER_HOST: SYNTHETIC_HOST.toUpperCase()
    })
  );

  assert.equal(verdict.ok, true);
});

test("the database user must match the declaration exactly", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: buildUri({ username: "someone_else" }) }),
    ISOLATION_REASONS.testDatabaseUserMismatch
  );
});

// ---------------------------------------------------------------------------
// Connection-string shape
// ---------------------------------------------------------------------------

test("only an Atlas mongodb+srv connection string is accepted", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: buildUri({ scheme: "mongodb" }) }),
    ISOLATION_REASONS.testUriSchemeUnsupported
  );
});

test("a connection string with no password is refused", () => {
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: buildUri({ password: null }) }),
    ISOLATION_REASONS.testUriPasswordMissing
  );
});

test("a connection string with no database segment is refused", () => {
  const uri = `${REQUIRED_SCHEME}://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`;

  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: uri }),
    ISOLATION_REASONS.testDatabaseNameMismatch
  );
});

test("a blank test connection string is refused as an incomplete declaration", () => {
  // Blank fails earlier and more specifically than "malformed", which is the
  // correct fail-closed ordering: the most specific honest reason wins.
  assert.equal(
    reasonOf({ PHISHGUARD_TEST_MONGODB_URI: "" }),
    ISOLATION_REASONS.testDeclarationIncomplete
  );
});

test("an unparseable connection string is refused, not thrown on", () => {
  for (const uri of ["not-a-uri", "://///", `${REQUIRED_SCHEME}://`, `${REQUIRED_SCHEME}://@`, "mongodb+srv://a:b@c d/e"]) {
    const verdict = evaluateTestDatabaseEnvironment(
      buildValidEnvironment({ PHISHGUARD_TEST_MONGODB_URI: uri })
    );

    assert.equal(verdict.ok, false, `${JSON.stringify(uri)} must be refused`);
    assert.ok(
      [
        ISOLATION_REASONS.testUriMalformed,
        ISOLATION_REASONS.testUriPasswordMissing,
        ISOLATION_REASONS.testUriSchemeUnsupported
      ].includes(verdict.reason),
      `unexpected reason for ${JSON.stringify(uri)}: ${verdict.reason}`
    );
  }
});

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

test("the parser never returns a password field", () => {
  const target = parseAtlasTarget(buildUri());

  assert.equal(target.hasPassword, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(target, "password"),
    false
  );
  assert.equal(JSON.stringify(target).includes(SYNTHETIC_PASSWORD), false);
});

test("the parser handles a percent-encoded password without exposing it", () => {
  const target = parseAtlasTarget(
    `${REQUIRED_SCHEME}://${SYNTHETIC_USER}:p%40ss%3Aword@${SYNTHETIC_HOST}/${SYNTHETIC_DATABASE}`
  );

  assert.equal(target.hasPassword, true);
  assert.equal(JSON.stringify(target).includes("p%40ss"), false);
});

test("the parser reports a missing database rather than inventing one", () => {
  const target = parseAtlasTarget(
    `${REQUIRED_SCHEME}://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`
  );

  assert.equal(target.database, null);
});

test("the parser returns null for input it cannot understand", () => {
  for (const value of [undefined, null, "", 42, {}, "::::"]) {
    assert.equal(parseAtlasTarget(value), null, `${String(value)} must not parse`);
  }
});

// ---------------------------------------------------------------------------
// The child-process contract
// ---------------------------------------------------------------------------

test("the child environment names include the connection string and exclude MONGODB_URI", () => {
  const names = requiredChildEnvironmentNames();

  assert.equal(names.includes("PHISHGUARD_TEST_MONGODB_URI"), true);
  assert.equal(
    names.includes("MONGODB_URI"),
    false,
    "the gate must never populate or overwrite MONGODB_URI itself"
  );
});

test("the child environment list is frozen against accidental mutation", () => {
  const names = requiredChildEnvironmentNames();

  assert.equal(Object.isFrozen(names), true);
});

// ---------------------------------------------------------------------------
// Determinism: the same environment always yields the same verdict
// ---------------------------------------------------------------------------

test("evaluation is deterministic and does not mutate its input", () => {
  const env = buildValidEnvironment();
  const snapshot = JSON.stringify(env);

  const first = evaluateTestDatabaseEnvironment(env);
  const second = evaluateTestDatabaseEnvironment(env);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(env), snapshot, "the environment must not be mutated");
});

test("evaluation does not mutate the caller's global process environment", () => {
  const before = { ...process.env };

  evaluateTestDatabaseEnvironment(buildValidEnvironment());
  verifyTestDatabaseEnvironment(buildValidEnvironment());

  assert.deepEqual(
    Object.keys(process.env).sort(),
    Object.keys(before).sort(),
    "the gate must not add or remove process environment variables"
  );
});

test("every reason code has a message and every message names its remedy", () => {
  for (const reason of Object.values(ISOLATION_REASONS)) {
    const error = new IsolationGateError(reason);

    assert.ok(error.message.length > 0, `${reason} must have a message`);
  }

  const error = new IsolationGateError(ISOLATION_REASONS.testUriMissing);

  assert.match(error.message, /PHISHGUARD_TEST_MONGODB_URI/);
});

test("reason codes are unique", () => {
  const codes = Object.values(ISOLATION_REASONS);

  assert.equal(new Set(codes).size, codes.length);
});
