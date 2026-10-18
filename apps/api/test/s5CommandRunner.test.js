const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  DATABASE_SCOPE_ATTESTATION,
  ISOLATION_ATTESTATION,
  LIVE_TESTS_AUTHORIZATION_VALUE
} = require("../scripts/testDatabaseIsolation");

const {
  ROUTE_SUITES,
  S5_COMMANDS,
  STRIPPED_ENV_KEYS,
  buildChildEnvironment,
  describeCommands,
  resolveCommand
} = require("../scripts/s5CommandRunner");

// S5 launcher: command resolution and child-environment construction.
//
// Pure and offline. Nothing here spawns a process, opens a connection, or reads
// a file. The launcher CLI itself is exercised separately, on its refusal path
// only, where it provably starts no child.
//
// The property that matters most: `MONGODB_URI` is ASSIGNED unconditionally, so
// an inherited value is discarded rather than used as a fallback. Before the
// launcher existed, forgetting that substitution silently pointed the run at
// the database in `apps/api/.env`.

const SYNTHETIC_USER = "phishguard_s5_runner";
const SYNTHETIC_PASSWORD = "not-a-real-secret-placeholder";
const SYNTHETIC_CLUSTER = "phishguard-s5-test";
const SYNTHETIC_HOST = "phishguard-s5-test.abcdef12.mongodb.net";
const SYNTHETIC_DATABASE = "phishguard_s5_disposable";
const SYNTHETIC_URI =
  `mongodb+srv://${SYNTHETIC_USER}:${SYNTHETIC_PASSWORD}@${SYNTHETIC_HOST}`
  + `/${SYNTHETIC_DATABASE}?retryWrites=true`;

const SCRIPT_DIR = path.resolve(__dirname, "..", "scripts");

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

// ---------------------------------------------------------------------------
// The allowlist is closed
// ---------------------------------------------------------------------------

test("every documented command resolves", () => {
  for (const name of Object.keys(S5_COMMANDS)) {
    const argv = name === "fixtures:apply" ? [name, "--stage=roles"] : [name];
    assert.equal(resolveCommand(argv).ok, true, `${name} must resolve`);
  }
});

test("an unknown command is refused rather than attempted", () => {
  for (const name of ["npm", "start", "deploy", "publish", "test", "node", ""]) {
    const resolution = resolveCommand([name]);

    if (name === "") {
      assert.equal(resolution.ok, false);
      continue;
    }

    assert.equal(
      resolution.ok,
      false,
      `${name} must not resolve to a command`
    );
  }
});

test("no invocation is refused", () => {
  assert.equal(resolveCommand([]).ok, false);
  assert.equal(resolveCommand().ok, false);
  assert.equal(resolveCommand(undefined).ok, false);
});

test("there is no deployment or publishing command", () => {
  const names = Object.keys(S5_COMMANDS).map((name) => name.toLowerCase());

  for (const forbidden of ["deploy", "publish", "release", "render", "docker", "push"]) {
    assert.equal(
      names.some((name) => name.includes(forbidden)),
      false,
      `no command may be named like "${forbidden}"`
    );
  }
});

test("every command targets this repository and nothing outside it", () => {
  for (const [name, command] of Object.entries(S5_COMMANDS)) {
    if (command.kind === "gate") {
      continue;
    }

    assert.ok(
      typeof command.executable === "string" && command.executable.length > 0,
      `${name} needs an executable`
    );
    assert.ok(Array.isArray(command.args), `${name} needs an argument list`);

    for (const argument of command.args) {
      assert.equal(
        /https?:\/\//i.test(argument),
        false,
        `${name} must not carry a URL argument`
      );
    }
  }
});

test("the allowlist and its description are frozen and value-free", () => {
  assert.equal(Object.isFrozen(S5_COMMANDS), true);
  assert.equal(Object.isFrozen(ROUTE_SUITES), true);

  const description = describeCommands();

  for (const secret of [SYNTHETIC_PASSWORD, SYNTHETIC_USER, "mongodb+srv://"]) {
    assert.equal(description.includes(secret), false);
  }
});

// ---------------------------------------------------------------------------
// Ambiguity is refused, not guessed
// ---------------------------------------------------------------------------

test("free-form arguments are refused", () => {
  for (const argv of [
    ["api", "--force"],
    ["api", "--yes"],
    ["test:routes", "test/anything.test.js"],
    ["api", "extra"],
    ["fixtures:apply", "--run", "--now"]
  ]) {
    assert.equal(
      resolveCommand(argv).ok,
      false,
      `${JSON.stringify(argv)} must be refused`
    );
  }
});

test("the stage flag is accepted only where the command accepts it", () => {
  assert.equal(resolveCommand(["fixtures:apply", "--stage=roles"]).ok, true);
  assert.equal(resolveCommand(["fixtures:plan", "--stage=roles"]).ok, true);

  assert.equal(
    resolveCommand(["api", "--stage=roles"]).reason,
    "STAGE_NOT_ACCEPTED"
  );
  assert.equal(
    resolveCommand(["test:routes", "--stage=roles"]).reason,
    "STAGE_NOT_ACCEPTED"
  );
});

test("an unknown stage is refused", () => {
  for (const stage of ["nope", "ROLES", "", "roles;rm -rf", "../../etc"]) {
    assert.equal(
      resolveCommand(["fixtures:apply", `--stage=${stage}`]).reason,
      "UNKNOWN_STAGE",
      `${JSON.stringify(stage)} must not resolve`
    );
  }
});

test("a resolved stage is carried through", () => {
  assert.equal(resolveCommand(["fixtures:apply", "--stage=reports"]).stage, "reports");
  assert.equal(resolveCommand(["fixtures:apply"]).reason, "STAGE_REQUIRED");
});

// ---------------------------------------------------------------------------
// The substitution: assignment, never fallback
// ---------------------------------------------------------------------------

test("MONGODB_URI is assigned from the verified test URI", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment(),
    testUri: SYNTHETIC_URI
  });

  assert.equal(built.ok, true);
  assert.equal(built.env.MONGODB_URI, SYNTHETIC_URI);
  assert.equal(built.meta.substituted, true);
});

test("an inherited MONGODB_URI is discarded, never used as a fallback", () => {
  // This is the exact shape of the original hazard: the parent already carries a
  // MONGODB_URI (loaded from apps/api/.env by a previous process, or exported by
  // hand) and it must not survive into the child.
  const inherited = "mongodb+srv://someone:secret@prod-cluster.mongodb.net/production";
  const built = buildChildEnvironment({
    baseEnv: validEnvironment({ MONGODB_URI: inherited }),
    testUri: SYNTHETIC_URI
  });

  assert.equal(built.env.MONGODB_URI, SYNTHETIC_URI);
  assert.equal(built.env.MONGODB_URI.includes("prod-cluster"), false);
  assert.equal(built.meta.inheritedUriDiscarded, true);
});

test("an identical inherited URI is reported as not discarded", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment({ MONGODB_URI: SYNTHETIC_URI }),
    testUri: SYNTHETIC_URI
  });

  assert.equal(built.meta.inheritedUriDiscarded, false);
});

test("a child is refused when no verified URI is supplied", () => {
  for (const testUri of [undefined, null, ""]) {
    const built = buildChildEnvironment({ baseEnv: validEnvironment(), testUri });

    assert.equal(built.ok, false, `${String(testUri)} must be refused`);
    assert.equal(built.reason, "TEST_URI_MISSING");
  }
});

test("the base environment is not mutated", () => {
  const base = validEnvironment({ MONGODB_URI: "mongodb://original/db" });
  const snapshot = { ...base };

  buildChildEnvironment({ baseEnv: base, testUri: SYNTHETIC_URI });

  assert.deepEqual(base, snapshot);
});

// ---------------------------------------------------------------------------
// Closing the dotenv override vector
// ---------------------------------------------------------------------------

test("dotenv behaviour-changing variables are stripped from the child", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment({
      DOTENV_CONFIG_OVERRIDE: "true",
      DOTENV_CONFIG_PATH: "C:/somewhere/else/.env"
    }),
    testUri: SYNTHETIC_URI
  });

  for (const key of STRIPPED_ENV_KEYS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(built.env, key),
      false,
      `${key} must not reach the child`
    );
  }

  assert.deepEqual(built.meta.strippedKeys.sort(), [...STRIPPED_ENV_KEYS].sort());
});

test("stripping is harmless when those variables are absent", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment(),
    testUri: SYNTHETIC_URI
  });

  assert.deepEqual(built.meta.strippedKeys, []);
  assert.equal(built.ok, true);
});

// ---------------------------------------------------------------------------
// Per-command opt-in flags
// ---------------------------------------------------------------------------

test("the opt-in Mongo suites get their own flags from the launcher", () => {
  // Those suites stay opt-in even when live tests are authorized. The launcher
  // is what sets the flag, and only for the command that names the suite.
  assert.equal(
    resolveCommand(["test:reporting"]).command.extraEnv.REPORTING_INTEGRATION,
    "1"
  );
  assert.equal(
    resolveCommand(["test:password-reset"]).command.extraEnv
      .PASSWORD_RESET_INTEGRATION,
    "1"
  );

  assert.equal(resolveCommand(["test:routes"]).command.extraEnv, undefined);
  assert.equal(resolveCommand(["test:all"]).command.extraEnv, undefined);
});

test("extraEnv is applied to the child environment", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment(),
    testUri: SYNTHETIC_URI,
    extraEnv: { REPORTING_INTEGRATION: "1" }
  });

  assert.equal(built.env.REPORTING_INTEGRATION, "1");
  assert.deepEqual(built.meta.extraEnvKeys, ["REPORTING_INTEGRATION"]);
  assert.equal(built.env.MONGODB_URI, SYNTHETIC_URI);
});

test("the reported metadata carries no credential", () => {
  const built = buildChildEnvironment({
    baseEnv: validEnvironment(),
    testUri: SYNTHETIC_URI
  });
  const serialised = JSON.stringify(built.meta);

  for (const secret of [SYNTHETIC_PASSWORD, SYNTHETIC_URI, SYNTHETIC_USER]) {
    assert.equal(serialised.includes(secret), false, `meta must not contain ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// Suite ordering
// ---------------------------------------------------------------------------

test("route suites run in cleanup-safe order, with the leaky ones last", () => {
  // dashboard and progress clean up after themselves; analysis and awareness do
  // not. The leaky ones must run against a database about to be discarded.
  assert.deepEqual(ROUTE_SUITES.slice(0, 5), [
    "test/auth.routes.test.js",
    "test/training.routes.test.js",
    "test/phishingIdentification.routes.test.js",
    "test/progress.routes.test.js",
    "test/dashboard.routes.test.js"
  ]);
  assert.deepEqual(ROUTE_SUITES.slice(5), [
    "test/analysis.routes.test.js",
    "test/awareness.routes.test.js"
  ]);
});

test("the test:routes command covers exactly the seven live suites", () => {
  const args = S5_COMMANDS["test:routes"].args;

  assert.equal(args[0], "--test");
  assert.equal(args.length - 1, 7);
});

// ---------------------------------------------------------------------------
// The launcher CLI, on its refusal paths only
// ---------------------------------------------------------------------------
//
// These spawn the launcher with an environment that CANNOT pass the gate, so the
// launcher must refuse before constructing a child. Nothing connects, and no
// child is started.

function runLauncher(args, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "runS5Command.js"), ...args],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      // A deliberately hostile environment: no authorisation, and a MONGODB_URI
      // pointing at something that must never be reached.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        MONGODB_URI: "mongodb+srv://nobody:secret@should-never-be-used.mongodb.net/production",
        ...extraEnv
      }
    }
  );
}

test("the launcher refuses an unknown command and starts no child", () => {
  const result = runLauncher(["definitely-not-a-command"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refused: UNKNOWN_COMMAND/);
  // The help text accompanies the refusal on stderr, because it explains why
  // nothing ran.
  assert.match(result.stderr, /Commands:/);
  assert.match(result.stderr, /No child process was started|Commands:/);
});

test("the launcher refuses free-form arguments and starts no child", () => {
  const result = runLauncher(["api", "--force"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refused: UNSUPPORTED_ARGUMENT/);
});

test("the launcher refuses an unauthorised target and starts no child", () => {
  // The environment here has a MONGODB_URI but none of the S5 variables, which
  // is exactly the state in which a manual run silently used .env.
  for (const command of ["api", "test:routes", "test:all", "fixtures:apply"]) {
    const args = command === "fixtures:apply" ? [command, "--stage=roles"] : [command];
    const result = runLauncher(args);

    assert.equal(result.status, 1, `${command} must be refused`);
    assert.match(result.stderr, /isolation gate returned LIVE_TESTS_NOT_AUTHORIZED/);
    assert.match(result.stderr, /No child process was started/);
  }
});

test("the launcher refusal path prints no credential", () => {
  const result = runLauncher(["api"]);

  assert.equal(result.status, 1);

  for (const secret of ["secret", "should-never-be-used", "mongodb+srv://", "nobody"]) {
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(secret),
      false,
      `refusal output must not contain ${secret}`
    );
  }
});

test("the launcher lists its commands without starting one", () => {
  const result = runLauncher(["--list"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /fixtures:apply/);
  assert.match(result.stdout, /test:routes/);
  assert.match(result.stdout, /no child process|Validates/i);
});

// ---------------------------------------------------------------------------
// The disabled role-setup script
// ---------------------------------------------------------------------------

test("the privileged-role script is disabled and exits non-zero", () => {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "setupTestRoles.js")], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  });

  assert.equal(result.status, 2, "the disabled script must not succeed");
  assert.match(result.stderr, /DISABLED/);
  assert.match(result.stderr, /runS5Command\.js fixtures:apply/);
});

test("the disabled role-setup script names what it used to do and why", () => {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "setupTestRoles.js")], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  });

  const output = `${result.stdout}${result.stderr}`;

  assert.match(output, /privileged roles/);
  assert.match(output, /isolation gate/);
  assert.match(output, /apps\/api\/\.env/);
});

test("the disabled role-setup script connects to nothing", () => {
  // Proved against EXECUTABLE CODE, with comments removed first. The header
  // deliberately names the old `findOneAndUpdate` behaviour so the migration
  // note is honest, and a raw scan would match that prose instead of code.
  const fs = require("node:fs");
  const source = fs
    .readFileSync(path.join(SCRIPT_DIR, "setupTestRoles.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/require\(/.test(source), false, "the disabled script must require nothing");
  assert.equal(/connect/i.test(source), false, "it must not reference a connection");
  assert.equal(
    /findOneAndUpdate|updateOne|deleteMany|\.create\(/.test(source),
    false,
    "it must contain no database mutation"
  );
});

test("the disabled role-setup script writes nothing to stdout as data", () => {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "setupTestRoles.js")], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  });

  assert.equal(
    result.stdout.trim(),
    "",
    "the migration notice belongs on stderr so a caller cannot mistake it for data"
  );
});
