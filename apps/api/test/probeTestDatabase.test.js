const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE
} = require("../scripts/testDatabaseIsolation");
const { S5_COMMANDS, resolveCommand } = require("../scripts/s5CommandRunner");
const {
  ERROR_CATEGORIES,
  PROBE_FAILURE_REASONS,
  PROBE_TARGET_REASONS,
  PROBE_TIMEOUT_MS,
  classifyError,
  resolveProbeTarget,
  runProbe
} = require("../scripts/probeTestDatabase");

// Gated, read-only Atlas connectivity probe.
//
// Every test here is offline. No socket is opened, no database is contacted, no
// record is read or written. The driver is a hand-written fake whose every call
// is recorded, so "issued exactly one command" is an observation rather than an
// inference.
//
// The properties that matter most:
//   - the gate is re-verified in-process, before anything connects;
//   - the URI comes from PHISHGUARD_TEST_MONGODB_URI and MONGODB_URI must match
//     it, so no fallback path exists;
//   - exactly one command is issued, and it is a ping;
//   - the connection is closed on every path, success or failure;
//   - driver errors are reduced to a whitelisted name and a fixed category.

const SYNTHETIC_USER = "phishguard_s5_runner";
const SYNTHETIC_PASSWORD = "not-a-real-secret-placeholder";
const SYNTHETIC_CLUSTER = "phishguard-s5-test";
const SYNTHETIC_HOST = "phishguard-s5-test.abcdef12.mongodb.net";
const SYNTHETIC_DATABASE = "phishguard_s5_disposable";
const SYNTHETIC_URI =
  `mongodb+srv://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`
  + `/${SYNTHETIC_DATABASE}?retryWrites=true`;

const UNSAFE_URI =
  "mongodb+srv://someone:leaked@prod-cluster.mongodb.net/production";

function validEnvironment(overrides = {}) {
  return {
    PHISHGUARD_ALLOW_LIVE_TESTS: LIVE_TESTS_AUTHORIZATION_VALUE,
    PHISHGUARD_TEST_ISOLATION_CONFIRMED: ISOLATION_ATTESTATION,
    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED: DATABASE_SCOPE_ATTESTATION,
    PHISHGUARD_TEST_CLUSTER: SYNTHETIC_CLUSTER,
    PHISHGUARD_TEST_CLUSTER_HOST: SYNTHETIC_HOST,
    PHISHGUARD_TEST_DATABASE: SYNTHETIC_DATABASE,
    PHISHGUARD_TEST_DB_USER: SYNTHETIC_USER,
    PHISHGUARD_TEST_MONGODB_URI: SYNTHETIC_URI,
    // The launcher assigns this, so a valid run always carries it.
    MONGODB_URI: SYNTHETIC_URI,
    // ...and it records what the shell carried before substitution. Empty means
    // the shell was clean, which is the normal case.
    PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: "",
    ...overrides
  };
}

function createRecorder() {
  const chunks = [];

  return {
    chunks,
    stream: { write: (chunk) => chunks.push(String(chunk)) },
    text: () => chunks.join("")
  };
}

/** A driver fake. Every interaction is recorded and assertable. */
function createFakeDriver({
  connectError = null,
  pingError = null,
  disconnectError = null
} = {}) {
  const calls = { set: [], connect: [], commands: [], disconnect: 0 };

  const state = { readyState: 0 };

  const driver = {
    calls,
    set(key, value) {
      calls.set.push({ key, value });
    },
    async connect(uri, options) {
      calls.connect.push({ uri, options });

      if (connectError) {
        throw connectError;
      }

      state.readyState = 1;
    },
    connection: {
      get readyState() {
        return state.readyState;
      },
      db: {
        async command(command) {
          calls.commands.push(command);

          if (pingError) {
            throw pingError;
          }

          return { ok: 1 };
        }
      }
    },
    async disconnect() {
      calls.disconnect += 1;
      state.readyState = 0;

      if (disconnectError) {
        throw disconnectError;
      }
    }
  };

  return driver;
}

async function probe(env, driver) {
  const stdout = createRecorder();
  const stderr = createRecorder();

  const code = await runProbe({
    env,
    driver,
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  let parsed = null;

  try {
    parsed = JSON.parse(stdout.text());
  } catch {
    parsed = null;
  }

  return { code, stdout, stderr, report: parsed, output: `${stdout.text()}${stderr.text()}` };
}

// ---------------------------------------------------------------------------
// 1. The gate is re-verified in-process, before anything connects
// ---------------------------------------------------------------------------

test("an unauthorised probe connects nothing", async () => {
  const driver = createFakeDriver();
  const result = await probe({ MONGODB_URI: SYNTHETIC_URI }, driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0, "no connection may be attempted");
  assert.equal(result.report.stage, "isolation-gate");
  assert.equal(result.report.reason, "LIVE_TESTS_NOT_AUTHORIZED");
  assert.equal(result.report.connected, false);
});

test("a missing declaration connects nothing", async () => {
  const driver = createFakeDriver();
  const env = validEnvironment();
  delete env.PHISHGUARD_TEST_DB_USER;

  const result = await probe(env, driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0);
  assert.equal(result.report.reason, "TEST_DECLARATION_INCOMPLETE");
});

test("a mismatched child MONGODB_URI is refused before connecting", async () => {
  const driver = createFakeDriver();
  const result = await probe(validEnvironment({ MONGODB_URI: UNSAFE_URI }), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0, "a mismatch must connect nothing");
  assert.equal(result.report.reason, "TEST_URI_EQUALS_ACTIVE_MONGODB_URI");
  assert.equal(result.report.connected, false);
});

test("a missing test URI is caught by the gate before the probe's own check", async () => {
  const driver = createFakeDriver();
  const env = validEnvironment();
  delete env.PHISHGUARD_TEST_MONGODB_URI;

  const result = await probe(env, driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0);
  // Fail-closed ordering: the gate's declaration check fires first, which is the
  // more specific and more honest reason.
  assert.equal(result.report.reason, "TEST_DECLARATION_INCOMPLETE");
});

test("target resolution reports a missing test URI on its own", () => {
  const resolved = resolveProbeTarget({});

  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, PROBE_TARGET_REASONS.testUriMissing);
});

test("a missing child MONGODB_URI connects nothing", () => {
  const resolved = resolveProbeTarget({ PHISHGUARD_TEST_MONGODB_URI: SYNTHETIC_URI });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, PROBE_TARGET_REASONS.childUriMissing);
});

test("target resolution never returns the URI on refusal", () => {
  for (const env of [
    {},
    { PHISHGUARD_TEST_MONGODB_URI: SYNTHETIC_URI, MONGODB_URI: UNSAFE_URI },
    { PHISHGUARD_TEST_MONGODB_URI: SYNTHETIC_URI, MONGODB_URI: "" }
  ]) {
    const resolved = resolveProbeTarget(env);

    if (resolved.ok) {
      continue;
    }

    assert.equal(JSON.stringify(resolved).includes("mongodb"), false);
  }
});

test("the probe connects only after the gate, never before", async () => {
  // Ordering is asserted through the recorded calls: on a refusal there is no
  // connect at all, and on success the connect is the first driver interaction.
  const refused = await probe({}, createFakeDriver());

  assert.equal(refused.code, 1);

  const driver = createFakeDriver();
  const allowed = await probe(validEnvironment(), driver);

  assert.equal(allowed.code, 0);
  assert.equal(driver.calls.connect.length, 1);
});

// ---------------------------------------------------------------------------
// 2. The successful path
// ---------------------------------------------------------------------------

test("a valid configuration reports a successful, read-only probe", async () => {
  const driver = createFakeDriver();
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 0);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.probe, "atlas-connectivity");
  assert.equal(result.report.stage, "complete");
  assert.equal(result.report.connected, true);
  assert.equal(result.report.pingSucceeded, true);
  assert.equal(result.report.connectionClosed, true);
});

test("the successful report declares that it enumerated nothing", async () => {
  const result = await probe(validEnvironment(), createFakeDriver());

  assert.equal(result.report.enumerated, false);
  assert.equal(result.report.recordsWritten, 0);
});

test("exactly one connection is opened", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  assert.equal(driver.calls.connect.length, 1);
});

test("exactly one command is issued, and it is a ping", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  assert.equal(driver.calls.commands.length, 1, "the probe must issue one command");
  assert.deepEqual(driver.calls.commands[0], { ping: 1 });
});

test("no enumeration command is ever issued", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  const serialised = JSON.stringify(driver.calls.commands);

  for (const forbidden of [
    "listDatabases",
    "listCollections",
    "listIndexes",
    "getUser",
    "usersInfo",
    "find",
    "aggregate",
    "insert",
    "update",
    "delete",
    "create"
  ]) {
    assert.equal(
      serialised.includes(forbidden),
      false,
      `the probe must not issue ${forbidden}`
    );
  }
});

test("the probe connects using the verified test URI and nothing else", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  assert.equal(driver.calls.connect[0].uri, SYNTHETIC_URI);
  assert.equal(driver.calls.connect[0].uri.includes("prod-cluster"), false);
});

test("an inherited unsafe MONGODB_URI is never used as the target", async () => {
  // The launcher would never produce this, but a hand-run could. The probe must
  // refuse rather than connect to the wrong cluster.
  const driver = createFakeDriver();
  const result = await probe(validEnvironment({ MONGODB_URI: UNSAFE_URI }), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.connect.length, 0);
  assert.equal(driver.calls.connect.some((call) => call.uri === UNSAFE_URI), false);
});

// ---------------------------------------------------------------------------
// 3. Bounded timeouts, and creation disabled
// ---------------------------------------------------------------------------

test("the connection uses bounded timeouts", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);
  const options = driver.calls.connect[0].options;

  assert.equal(options.serverSelectionTimeoutMS, PROBE_TIMEOUT_MS);
  assert.equal(options.connectTimeoutMS, PROBE_TIMEOUT_MS);
  assert.equal(options.socketTimeoutMS, PROBE_TIMEOUT_MS);
  assert.equal(options.maxPoolSize, 1);
  assert.equal(options.minPoolSize, 0);
});

test("the probe timeout is bounded well below the driver default", () => {
  assert.equal(PROBE_TIMEOUT_MS, 10000);
  assert.ok(PROBE_TIMEOUT_MS < 30000, "must fail faster than the 30s default");
});

test("automatic index and collection creation are disabled twice over", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  // Process-wide, so a model imported later still cannot build anything.
  assert.deepEqual(driver.calls.set, [
    { key: "autoIndex", value: false },
    { key: "autoCreate", value: false }
  ]);

  // And explicitly on the connection.
  const options = driver.calls.connect[0].options;

  assert.equal(options.autoIndex, false);
  assert.equal(options.autoCreate, false);
});

test("no model is loaded by the probe", () => {
  // A model import would trigger Model.init() and therefore ensureIndexes().
  const fs = require("node:fs");
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "scripts", "probeTestDatabase.js"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/src\/models/.test(source), false, "no model may be required");
  assert.equal(/src\/services/.test(source), false, "no service may be required");
  assert.equal(/seedTestFixtures/.test(source), false);
});

// ---------------------------------------------------------------------------
// 4. The connection is always closed
// ---------------------------------------------------------------------------

test("a successful probe closes the connection", async () => {
  const driver = createFakeDriver();
  await probe(validEnvironment(), driver);

  assert.equal(driver.calls.disconnect, 1);
  assert.equal(driver.connection.readyState, 0, "the connection must be closed");
});

test("a failed connection is still closed", async () => {
  const driver = createFakeDriver({
    connectError: Object.assign(new Error("boom"), { name: "MongoServerSelectionError" })
  });
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.disconnect, 1, "a failed connection must still be closed");
});

test("a failed ping is still closed", async () => {
  const driver = createFakeDriver({
    pingError: Object.assign(new Error("boom"), { name: "MongoServerError" })
  });
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(driver.calls.disconnect, 1);
});

test("a refused probe never opens a connection to close", async () => {
  const driver = createFakeDriver();
  await probe({}, driver);

  assert.equal(driver.calls.disconnect, 0);
});

test("a failed disconnect after ping is a sanitized probe failure", async () => {
  const driver = createFakeDriver({
    disconnectError: new Error(`socket already closed at ${SYNTHETIC_URI}`)
  });
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.stage, "disconnect");
  assert.equal(result.report.reason, PROBE_FAILURE_REASONS.disconnectFailed);
  assert.equal(result.report.connectionClosed, false);
  assert.equal(result.report.pingSucceeded, undefined);
  assert.equal(driver.calls.disconnect, 1);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
});

test("a failed disconnect following a ping failure remains nonzero and sanitized", async () => {
  const driver = createFakeDriver({
    pingError: new Error(`ping failed at ${SYNTHETIC_URI}`),
    disconnectError: new Error(`close failed at ${SYNTHETIC_URI}`)
  });
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.equal(driver.calls.disconnect, 1);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
});

// ---------------------------------------------------------------------------
// 5. Error sanitization
// ---------------------------------------------------------------------------

test("a connection failure is reported without any driver detail", async () => {
  const driver = createFakeDriver({
    connectError: Object.assign(new Error(`refused ${UNSAFE_URI}`), {
      name: "MongoServerSelectionError"
    })
  });
  const result = await probe(validEnvironment(), driver);

  assert.equal(result.code, 1);
  assert.equal(result.report.reason, PROBE_FAILURE_REASONS.connectFailed);
  assert.equal(result.report.stage, "connect");
  assert.equal(result.report.category, ERROR_CATEGORIES.unreachable);
});

test("a hostile error carrying a connection string leaks nothing", async () => {
  // Whether a real driver error can hold the URI is UNVERIFIED, so the probe is
  // written as though it can. Only `name` and a numeric `code` are read.
  const hostile = Object.assign(
    new Error(`Authentication failed for ${SYNTHETIC_URI}`),
    {
      name: "MongoServerError",
      code: 18,
      stack: `Error: secret\n    at ${SYNTHETIC_URI}`,
      client: { url: SYNTHETIC_URI },
      connectionString: SYNTHETIC_URI
    }
  );

  const result = await probe(validEnvironment(), createFakeDriver({ connectError: hostile }));

  for (const secret of [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER,
    SYNTHETIC_URI,
    UNSAFE_URI,
    SYNTHETIC_HOST,
    "mongodb+srv://",
    "Authentication failed",
    "at ",
    "leaked",
    "prod-cluster"
  ]) {
    assert.equal(
      result.output.includes(secret),
      false,
      `probe output must not contain ${secret}`
    );
  }

  assert.match(result.stdout.text(), /"credentialsPrinted": false/);
  assert.match(result.stdout.text(), /"connectionStringPrinted": false/);
  assert.match(result.stdout.text(), /"realHostnamePrinted": false/);
});

test("a hostile error NAME cannot inject content", () => {
  const hostile = {
    name: SYNTHETIC_URI,
    message: SYNTHETIC_URI
  };

  const classified = classifyError(hostile);

  assert.equal(Object.hasOwn(classified, "errorName"), false);
  assert.equal(classified.category, ERROR_CATEGORIES.unclassified);
});

test("an identifier-shaped arbitrary driver name is never echoed", async () => {
  const hostileName = "PrivateHostAndCredentialMarker";
  const result = await probe(validEnvironment(), createFakeDriver({
    connectError: { name: hostileName, message: SYNTHETIC_URI }
  }));

  assert.equal(result.report.category, ERROR_CATEGORIES.unclassified);
  assert.equal(result.output.includes(hostileName), false);
  assert.equal(result.output.includes(SYNTHETIC_URI), false);
  assert.equal(Object.hasOwn(result.report, "errorName"), false);
});

test("the success path prints no credential, host, or connection string", async () => {
  const result = await probe(validEnvironment(), createFakeDriver());

  for (const secret of [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER,
    SYNTHETIC_URI,
    SYNTHETIC_HOST,
    "mongodb+srv://"
  ]) {
    assert.equal(result.output.includes(secret), false, `must not contain ${secret}`);
  }
});

test("every error class maps to a fixed category", () => {
  const cases = [
    ["MongoParseError", ERROR_CATEGORIES.malformedUri],
    ["MongoServerSelectionError", ERROR_CATEGORIES.unreachable],
    ["MongooseServerSelectionError", ERROR_CATEGORIES.unreachable],
    ["MongoNetworkError", ERROR_CATEGORIES.networkBlocked],
    ["MongoTimeoutError", ERROR_CATEGORIES.timeout],
    ["MongoTopologyClosedError", ERROR_CATEGORIES.unreachable]
  ];

  for (const [name, expected] of cases) {
    const classified = classifyError({ name });

    assert.equal(classified.category, expected, `${name} must map`);
    assert.deepEqual(Object.keys(classified), ["category"]);
  }
});

test("an authentication failure is distinguished from other server rejections", () => {
  assert.equal(
    classifyError({ name: "MongoServerError", code: 18 }).category,
    ERROR_CATEGORIES.authenticationRejected
  );
  assert.equal(
    classifyError({ name: "MongoServerError", code: 13 }).category,
    ERROR_CATEGORIES.serverRejected
  );
});

test("a non-object or missing error is unclassified rather than thrown on", () => {
  for (const value of [undefined, null, "string", 42]) {
    const classified = classifyError(value);

    assert.equal(Object.hasOwn(classified, "errorName"), false);
    assert.equal(classified.category, ERROR_CATEGORIES.unclassified);
  }
});

test("no arbitrary error name is ever emitted", () => {
  for (const name of [
    "MongoParseError",
    "M",
    "A".repeat(60),
    "Mongo\nError",
    "Mongo Error",
    "_private",
    "9leading",
    ""
  ]) {
    const classified = classifyError({ name });

    assert.deepEqual(Object.keys(classified), ["category"]);
  }
});

// ---------------------------------------------------------------------------
// 6. Importing the module connects nothing
// ---------------------------------------------------------------------------

test("requiring the probe module connects nothing and prints nothing", () => {
  const before = process.exitCode;
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  let wrote = 0;

  process.stdout.write = () => {
    wrote += 1;

    return true;
  };
  process.stderr.write = () => {
    wrote += 1;

    return true;
  };

  try {
    delete require.cache[require.resolve("../scripts/probeTestDatabase.js")];
    const required = require("../scripts/probeTestDatabase.js");

    assert.equal(typeof required.runProbe, "function");
    assert.equal(wrote, 0, "importing must print nothing");
    assert.equal(process.exitCode, before, "importing must not set an exit code");

    // The module itself must not have pulled in the driver at load time.
    const driverLoaded = Object.keys(require.cache).some(
      (key) => /[\\/]mongoose[\\/]index\.js$/.test(key)
    );

    assert.equal(
      driverLoaded,
      false,
      "requiring the probe must not load the database driver"
    );
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
});

test("the real entry point refuses an unauthorised probe without connecting", () => {
  const apiDir = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(apiDir, "scripts", "probeTestDatabase.js")],
    {
      cwd: apiDir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        MONGODB_URI: UNSAFE_URI
      }
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /LIVE_TESTS_NOT_AUTHORIZED/);
  assert.match(result.stdout, /"connected": false/);
  assert.match(result.stderr, /No connection was attempted/);
  assert.equal(`${result.stdout}${result.stderr}`.includes("leaked"), false);
});

test("the real entry point refuses a target mismatch without connecting", () => {
  const apiDir = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(apiDir, "scripts", "probeTestDatabase.js")],
    {
      cwd: apiDir,
      encoding: "utf8",
      // A gate that passes, but an inherited MONGODB_URI that does not match.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...validEnvironment({ MONGODB_URI: UNSAFE_URI })
      }
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /TEST_URI_EQUALS_ACTIVE_MONGODB_URI/);
  assert.match(result.stdout, /"connected": false/);
  assert.equal(`${result.stdout}${result.stderr}`.includes("prod-cluster"), false);
});

// ---------------------------------------------------------------------------
// 7. Launcher allowlisting
// ---------------------------------------------------------------------------

test("probe is registered in the closed allowlist", () => {
  assert.equal(typeof S5_COMMANDS.probe, "object");
  assert.equal(S5_COMMANDS.probe.executable, process.execPath);
  assert.deepEqual(S5_COMMANDS.probe.args, ["scripts/probeTestDatabase.js"]);
});

test("probe resolves through the launcher", () => {
  const resolution = resolveCommand(["probe"]);

  assert.equal(resolution.ok, true);
  assert.equal(resolution.name, "probe");
});

test("probe carries no opt-in flag", () => {
  assert.equal(S5_COMMANDS.probe.extraEnv, undefined);
});

test("probe appears in the launcher help text", () => {
  const { describeCommands } = require("../scripts/s5CommandRunner");

  assert.match(describeCommands(), /probe\s+Connectivity-only/);
});
