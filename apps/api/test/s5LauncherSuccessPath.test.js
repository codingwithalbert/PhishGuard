const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");

const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE,
  evaluateTestDatabaseEnvironment
} = require("../scripts/testDatabaseIsolation");
const { S5_COMMANDS } = require("../scripts/s5CommandRunner");
const { main: launcherMain } = require("../scripts/runS5Command");

// S5 launcher: the SUCCESS path.
//
// The previous verification covered only refusal. This file exercises the path
// past the gate by injecting a mock spawn function and mock streams into the
// REAL entry point (`runS5Command.js` exports `main`, and auto-runs only under
// `require.main === module`).
//
// This is deliberately not a test of a disconnected helper. The same `main` that
// `node scripts/runS5Command.js <command>` runs is the one under test here; only
// its three collaborators - environment, streams, and spawn - are replaced.
//
// Nothing in this file starts a process, opens a connection, or reads `.env`.

const SYNTHETIC_USER = "phishguard_s5_runner";
const SYNTHETIC_PASSWORD = "not-a-real-secret-placeholder";
const SYNTHETIC_CLUSTER = "phishguard-s5-test";
const SYNTHETIC_HOST = "phishguard-s5-test.abcdef12.mongodb.net";
const SYNTHETIC_DATABASE = "phishguard_s5_disposable";
const SYNTHETIC_URI =
  `mongodb+srv://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`
  + `/${SYNTHETIC_DATABASE}?retryWrites=true`;

const UNSAFE_INHERITED_URI =
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

/**
 * A mock spawn that records every invocation and lets the test decide when, and
 * how, the child finishes.
 *
 * `closeWith` is emitted verbatim rather than destructured, so a test can send a
 * genuinely absent exit code instead of having a default silently substitute 0.
 */
function createMockSpawn({
  closeWith = { code: 0, signal: null },
  autoClose = true
} = {}) {
  const calls = [];
  const children = [];

  const spawnFn = (executable, args, options) => {
    const child = new EventEmitter();

    calls.push({ executable, args, options });
    children.push(child);

    if (autoClose) {
      setImmediate(() => child.emit("close", closeWith.code, closeWith.signal));
    }

    return child;
  };

  return { spawnFn, calls, children };
}

async function runLauncher(argv, { env = {}, spawnOptions = {} } = {}) {
  const stdout = createRecorder();
  const stderr = createRecorder();
  const mock = createMockSpawn(spawnOptions);

  const code = await launcherMain(argv, {
    env: validEnvironment(env),
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawnFn: mock.spawnFn
  });

  return { code, stdout, stderr, ...mock };
}

// ---------------------------------------------------------------------------
// The gate passes, the allowlist resolves, and exactly one child is launched
// ---------------------------------------------------------------------------

test("a valid configuration launches exactly one child", async () => {
  const result = await runLauncher(["api"]);

  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 1, "exactly one child process must be launched");
});

test("the launched child is the documented API command", async () => {
  const result = await runLauncher(["api"]);

  assert.equal(result.calls[0].executable, S5_COMMANDS.api.executable);
  assert.deepEqual(result.calls[0].args, ["src/server.js"]);
});

test("the child runs from the API root with no shell", async () => {
  const result = await runLauncher(["api"]);

  assert.equal(result.calls[0].options.cwd, path.resolve(__dirname, ".."));
  assert.equal(
    result.calls[0].options.shell,
    false,
    "a shell would re-parse arguments and reintroduce an injection surface"
  );
  assert.equal(result.calls[0].options.stdio, "inherit");
});

test("every launchable command launches one child", async () => {
  for (const name of Object.keys(S5_COMMANDS)) {
    if (S5_COMMANDS[name].kind === "gate") {
      continue;
    }

    const argv = name === "fixtures:apply" ? [name, "--stage=roles"] : [name];
    const result = await runLauncher(argv);

    assert.equal(result.code, 0, `${name} must succeed`);
    assert.equal(result.calls.length, 1, `${name} must launch exactly one child`);
  }
});

// ---------------------------------------------------------------------------
// The URI reaches the child, and the unsafe inherited value does not
// ---------------------------------------------------------------------------

test("the verified test URI is passed to the child as MONGODB_URI", async () => {
  const result = await runLauncher(["api"]);
  const childEnv = result.calls[0].options.env;

  assert.equal(childEnv.MONGODB_URI, SYNTHETIC_URI);
});

test("an inherited unsafe MONGODB_URI is discarded as the selected target", async () => {
  // The child must not SELECT the production URI. It does retain it, in exactly
  // one dedicated variable, so the gate can still see what the operator was
  // originally pointed at. That value was already in the parent's environment.
  const result = await runLauncher(["api"], {
    env: { MONGODB_URI: UNSAFE_INHERITED_URI }
  });
  const childEnv = result.calls[0].options.env;

  assert.equal(childEnv.MONGODB_URI, SYNTHETIC_URI, "the selected target must be the test URI");
  assert.equal(childEnv.MONGODB_URI.includes("prod-cluster"), false);
  assert.deepEqual(
    Object.entries(childEnv)
      .filter(([, value]) => value === UNSAFE_INHERITED_URI)
      .map(([key]) => key),
    ["PHISHGUARD_TEST_ORIGINAL_MONGODB_URI"],
    "the original URI must survive only in its dedicated variable"
  );
});

test("the launcher reports that an inherited URI was discarded", async () => {
  const result = await runLauncher(["api"], {
    env: { MONGODB_URI: UNSAFE_INHERITED_URI }
  });

  assert.match(result.stdout.text(), /"inheritedUriDiscarded": true/);
});

// ---------------------------------------------------------------------------
// dotenv behaviour-changing variables never reach the child
// ---------------------------------------------------------------------------

test("DOTENV_CONFIG_* overrides are stripped from the launched child", async () => {
  const result = await runLauncher(["api"], {
    env: {
      DOTENV_CONFIG_OVERRIDE: "true",
      DOTENV_CONFIG_PATH: "C:/somewhere/else/.env"
    }
  });
  const childEnv = result.calls[0].options.env;

  assert.equal(
    Object.prototype.hasOwnProperty.call(childEnv, "DOTENV_CONFIG_OVERRIDE"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(childEnv, "DOTENV_CONFIG_PATH"),
    false
  );
  assert.match(result.stdout.text(), /DOTENV_CONFIG_OVERRIDE/);
});

// ---------------------------------------------------------------------------
// Opt-in flags survive into the child
// ---------------------------------------------------------------------------

test("the reporting opt-in flag reaches the child", async () => {
  const result = await runLauncher(["test:reporting"]);
  const childEnv = result.calls[0].options.env;

  assert.equal(childEnv.REPORTING_INTEGRATION, "1");
  assert.equal(childEnv.MONGODB_URI, SYNTHETIC_URI);
});

test("the password-reset opt-in flag reaches the child", async () => {
  const result = await runLauncher(["test:password-reset"]);

  assert.equal(result.calls[0].options.env.PASSWORD_RESET_INTEGRATION, "1");
});

test("a command with no opt-in flag receives none", async () => {
  const result = await runLauncher(["test:routes"]);
  const childEnv = result.calls[0].options.env;

  assert.equal(childEnv.REPORTING_INTEGRATION, undefined);
  assert.equal(childEnv.PASSWORD_RESET_INTEGRATION, undefined);
});

// ---------------------------------------------------------------------------
// Stage flags are appended to fixture commands
// ---------------------------------------------------------------------------

test("a stage flag is appended to the fixture command arguments", async () => {
  const result = await runLauncher(["fixtures:apply", "--stage=cohort-suppression"]);

  assert.deepEqual(result.calls[0].args, [
    "scripts/seedTestFixtures.js",
    "--apply",
    "--stage=cohort-suppression"
  ]);
  assert.match(result.stdout.text(), /"stage": "cohort-suppression"/);
});

test("the route suites are passed to the child in cleanup-safe order", async () => {
  const result = await runLauncher(["test:routes"]);
  const args = result.calls[0].args;

  assert.equal(args[0], "--test");
  assert.equal(
    args.at(-2),
    "test/analysis.routes.test.js",
    "the suite that leaves analyses behind must run last"
  );
  assert.equal(args.at(-1), "test/awareness.routes.test.js");
});

// ---------------------------------------------------------------------------
// Nothing sensitive is printed
// ---------------------------------------------------------------------------

test("the success path prints no credential and no connection string", async () => {
  const result = await runLauncher(["api"], {
    env: { MONGODB_URI: UNSAFE_INHERITED_URI }
  });
  const output = `${result.stdout.text()}${result.stderr.text()}`;

  for (const secret of [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_USER,
    "mongodb+srv://",
    "leaked",
    "prod-cluster",
    SYNTHETIC_HOST,
    SYNTHETIC_URI
  ]) {
    assert.equal(output.includes(secret), false, `output must not contain ${secret}`);
  }

  assert.match(output, /"credentialsPrinted": false/);
  assert.match(output, /"connectionStringPrinted": false/);
});

test("the child environment is the only place the credential appears", async () => {
  const result = await runLauncher(["api"]);
  const childEnv = result.calls[0].options.env;

  assert.equal(childEnv.PHISHGUARD_TEST_MONGODB_URI, SYNTHETIC_URI);
  assert.equal(
    result.stdout.text().includes(SYNTHETIC_URI),
    false,
    "passing the URI to the child must not mean printing it"
  );
});

// ---------------------------------------------------------------------------
// The gate command validates without launching anything
// ---------------------------------------------------------------------------

test("the gate command launches zero children", async () => {
  const result = await runLauncher(["gate"]);

  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0, "validation must not launch a process");
  assert.match(result.stdout.text(), /"childProcessStarted": false/);
  assert.match(result.stdout.text(), /"ok": true/);
});

test("--list launches zero children", async () => {
  const result = await runLauncher(["--list"]);

  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
});

// ---------------------------------------------------------------------------
// A refused gate launches zero children, on every command
// ---------------------------------------------------------------------------

test("no authorisation launches zero children", async () => {
  const stdout = createRecorder();
  const stderr = createRecorder();
  const mock = createMockSpawn();

  const code = await launcherMain(["api"], {
    env: { MONGODB_URI: UNSAFE_INHERITED_URI },
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawnFn: mock.spawnFn
  });

  assert.equal(code, 1);
  assert.equal(mock.calls.length, 0, "a refused gate must launch nothing");
  assert.match(stderr.text(), /LIVE_TESTS_NOT_AUTHORIZED/);
  assert.match(stderr.text(), /No child process was started/);
});

test("an incomplete declaration launches zero children", async () => {
  const env = validEnvironment();
  delete env.PHISHGUARD_TEST_DB_USER;

  const stdout = createRecorder();
  const stderr = createRecorder();
  const mock = createMockSpawn();

  const code = await launcherMain(["api"], {
    env,
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawnFn: mock.spawnFn
  });

  assert.equal(code, 1);
  assert.equal(mock.calls.length, 0);
});

test("an unknown command launches zero children", async () => {
  const result = await runLauncher(["deploy-to-production"]);

  assert.equal(result.code, 2);
  assert.equal(result.calls.length, 0);
});

test("a stage flag on a command that rejects it launches zero children", async () => {
  const result = await runLauncher(["api", "--stage=roles"]);

  assert.equal(result.code, 2);
  assert.equal(result.calls.length, 0);
});

test("the launcher does not mutate the environment it was given", async () => {
  const env = validEnvironment({ MONGODB_URI: UNSAFE_INHERITED_URI });
  const snapshot = { ...env };

  await runLauncher(["api"], { env });

  assert.deepEqual(env, snapshot, "the launcher's environment must be untouched");
});

// ---------------------------------------------------------------------------
// The original-target marker
// ---------------------------------------------------------------------------
//
// The launcher overwrites MONGODB_URI with the verified test URI. A child that
// re-verifies the isolation gate therefore cannot tell the substituted value
// from the operator's original target, and would refuse every legitimate run.
// The launcher records the pre-substitution value so the gate's "the test URI
// must not be the pre-existing database" check survives in the child.
//
// These tests exist because that defect shipped and was invisible while the
// launcher tests used a mock spawn.

test("the launcher records the pre-substitution URI for the child", async () => {
  const result = await runLauncher(["api"], {
    env: { MONGODB_URI: UNSAFE_INHERITED_URI }
  });
  const childEnv = result.calls[0].options.env;

  assert.equal(
    childEnv.PHISHGUARD_TEST_ORIGINAL_MONGODB_URI,
    UNSAFE_INHERITED_URI,
    "the child must be able to see what the operator was originally pointed at"
  );
  assert.equal(childEnv.MONGODB_URI, SYNTHETIC_URI);
});

test("a clean shell records an empty original-URI marker", async () => {
  const result = await runLauncher(["api"]);

  assert.equal(result.calls[0].options.env.PHISHGUARD_TEST_ORIGINAL_MONGODB_URI, "");
});

test("a forged marker cannot bypass the initial launcher gate", async () => {
  for (const marker of ["", UNSAFE_INHERITED_URI]) {
    const result = await runLauncher(["probe"], {
      env: {
        MONGODB_URI: SYNTHETIC_URI,
        PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: marker
      }
    });

    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    assert.match(result.stderr.text(), /TEST_URI_EQUALS_ACTIVE_MONGODB_URI/);
  }
});

test("the child marker overwrites a stale inherited marker on a valid launch", async () => {
  const result = await runLauncher(["probe"], {
    env: {
      MONGODB_URI: UNSAFE_INHERITED_URI,
      PHISHGUARD_TEST_ORIGINAL_MONGODB_URI: SYNTHETIC_URI
    }
  });

  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].options.env.MONGODB_URI, SYNTHETIC_URI);
  assert.equal(result.calls[0].options.env.PHISHGUARD_TEST_ORIGINAL_MONGODB_URI, UNSAFE_INHERITED_URI);
  assert.equal(evaluateTestDatabaseEnvironment(
    result.calls[0].options.env, { substitutedChild: true }
  ).ok, true, "the child can re-verify the substituted target");
});

// ---------------------------------------------------------------------------
// Child failure propagates
// ---------------------------------------------------------------------------

test("a nonzero child exit code propagates unchanged", async () => {
  for (const code of [1, 2, 3, 17, 42]) {
    const result = await runLauncher(["test:routes"], {
      spawnOptions: { closeWith: { code, signal: null } }
    });

    assert.equal(result.code, code, `child exit ${code} must propagate`);
  }
});

test("a child killed by a signal yields a shell-convention status", async () => {
  const cases = [
    ["SIGTERM", 143],
    ["SIGKILL", 137],
    ["SIGINT", 130]
  ];

  for (const [signal, expected] of cases) {
    const result = await runLauncher(["api"], {
      spawnOptions: { closeWith: { code: null, signal } }
    });

    assert.equal(result.code, expected, `${signal} must map to ${expected}`);
  }
});

test("a spawn error yields a sanitized nonzero status", async () => {
  const stdout = createRecorder();
  const stderr = createRecorder();
  const spawnFn = () => {
    const child = new EventEmitter();

    setImmediate(() => child.emit("error", new Error(`EACCES ${SYNTHETIC_URI}`)));

    return child;
  };

  const code = await launcherMain(["api"], {
    env: validEnvironment(),
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawnFn
  });

  assert.equal(code, 1);
  assert.match(stderr.text(), /could not be started/);
  assert.equal(
    `${stdout.text()}${stderr.text()}`.includes(SYNTHETIC_URI),
    false,
    "a spawn failure must not be echoed, because it can carry the environment"
  );
});

test("a close event with no code and no signal still yields nonzero", async () => {
  // A child that closes without reporting an outcome must not be mistaken for
  // success, because `typeof undefined === "number"` is false and the guard
  // falls through to 1.
  const result = await runLauncher(["api"], {
    spawnOptions: { closeWith: { code: undefined, signal: null } }
  });

  assert.equal(result.code, 1);
});

// ---------------------------------------------------------------------------
// The real entry point uses this behaviour
// ---------------------------------------------------------------------------
//
// `node scripts/runS5Command.js gate` is safe to run as a real subprocess: the
// gate command validates and returns without launching a child or contacting a
// database. This proves the module under test is the module that runs, and that
// the `require.main === module` guard did not change the real entry point.

const API_DIR = path.resolve(__dirname, "..");

function runRealLauncher(args, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(API_DIR, "scripts", "runS5Command.js"), ...args], {
    cwd: API_DIR,
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extraEnv }
  });
}

test("the real entry point authorises a valid configuration and launches nothing", () => {
  const result = runRealLauncher(["gate"], validEnvironment());

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"childProcessStarted": false/);
  assert.match(result.stdout, /"ok": true/);
  assert.equal(result.stdout.includes(SYNTHETIC_URI), false);
});

test("the real entry point still refuses without authorisation", () => {
  const result = runRealLauncher(["gate"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /LIVE_TESTS_NOT_AUTHORIZED/);
  assert.match(result.stderr, /No child process was started/);
});

test("requiring the launcher module does not launch or run anything", () => {
  // A module that auto-ran on import would be untestable and would surprise any
  // future caller. This asserts the guard exists.
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
    delete require.cache[require.resolve("../scripts/runS5Command.js")];
    const required = require("../scripts/runS5Command.js");

    assert.equal(typeof required.main, "function");
    assert.equal(wrote, 0, "importing must print nothing");
    assert.equal(process.exitCode, before, "importing must not set an exit code");
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
});
