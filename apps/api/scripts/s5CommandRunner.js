"use strict";

/**
 * Command resolution and child-environment construction for S5 live runs.
 *
 * WHY THIS EXISTS
 *
 * Isolation in S5 rests on one substitution:
 *
 *     MONGODB_URI = PHISHGUARD_TEST_MONGODB_URI
 *
 * performed in the CHILD process environment, before the child loads `.env`.
 * `dotenv` does not overwrite a variable that already exists in `process.env`,
 * so a pre-set `MONGODB_URI` wins and the child never sees the database named
 * in `apps/api/.env`.
 *
 * That was previously a line a human had to remember. Forgetting it did not
 * fail loudly: the run simply connected to the development database. This
 * module exists to make the validation and the substitution inseparable.
 *
 * CONTRACT
 *
 *   - Every supported command is in a closed allowlist. Anything else is
 *     refused, so a mistyped or ambiguous intent cannot reach a child process.
 *   - The gate is consulted first, and its verdict decides whether a child is
 *     ever constructed. There is no flag that skips it.
 *   - `MONGODB_URI` is always OVERWRITTEN in the child, never inherited. An
 *     unsafe inherited value is discarded, not used as a fallback.
 *   - Nothing here prints a credential. The returned metadata is booleans and
 *     key names only.
 *   - There is no deployment command, and no way to add one without editing
 *     this allowlist.
 *
 * This module is PURE. It spawns nothing, opens no connection, and reads no
 * file, so every decision it makes is testable offline.
 */

const path = require("node:path");

const { STAGE_ORDER } = require("./testFixturePlan");

const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..", "..");

// The seven suites that need a running API. Order matters: the suites that
// cannot clean up after themselves run last, against a database about to be
// discarded.
const ROUTE_SUITES = Object.freeze([
  "test/auth.routes.test.js",
  "test/training.routes.test.js",
  "test/phishingIdentification.routes.test.js",
  "test/progress.routes.test.js",
  "test/dashboard.routes.test.js",
  "test/analysis.routes.test.js",
  "test/awareness.routes.test.js"
]);

// Environment variables that could change how a child loads `.env`. Removed
// defensively: `require("dotenv").config()` does NOT honour them in 17.4.2
// (verified), but the `dotenv/config` preload shim does honour
// DOTENV_CONFIG_OVERRIDE, and a future suite could switch to the preload.
const STRIPPED_ENV_KEYS = Object.freeze([
  "DOTENV_CONFIG_OVERRIDE",
  "DOTENV_CONFIG_PATH"
]);

function powershellExecutable() {
  return process.platform === "win32" ? "powershell" : "pwsh";
}

/**
 * The closed allowlist. Adding an entry here is the ONLY way to make a new
 * command reachable, which is what keeps this surface auditable.
 */
const S5_COMMANDS = Object.freeze({
  gate: Object.freeze({
    summary: "Validate the disposable target and exit. Runs no child process.",
    kind: "gate"
  }),
  probe: Object.freeze({
    summary:
      "Connectivity-only, read-only probe of the verified Atlas cluster. Issues a single ping; enumerates and writes nothing.",
    executable: process.execPath,
    args: Object.freeze(["scripts/probeTestDatabase.js"])
  }),
  "verify:transactions": Object.freeze({
    summary:
      "Gated transaction-capability check of the verified Atlas cluster. Starts a snapshot+majority transaction, writes one probe document, reads it in-session, aborts it, and confirms the rollback. Leaves nothing durable behind.",
    executable: process.execPath,
    args: Object.freeze(["scripts/verifyTransactionCapability.js"])
  }),
    "fixtures:verify-live": Object.freeze({
    summary:
      "Read-only verification of three authenticated synthetic fixture accounts in the disposable Atlas database.",
    executable: process.execPath,
    args: Object.freeze(["scripts/verifyLiveTestFixtures.js"])
  }),
  api: Object.freeze({
    summary: "Start the API against the verified disposable database.",
    executable: process.execPath,
    args: Object.freeze(["src/server.js"])
  }),
  "test:routes": Object.freeze({
    summary: "Run the seven live route suites in cleanup-safe order.",
    executable: process.execPath,
    args: Object.freeze(["--test", ...ROUTE_SUITES])
  }),
  "test:reporting": Object.freeze({
    summary: "Run the opt-in Reporting MongoDB integration suite.",
    executable: process.execPath,
    args: Object.freeze(["--test", "test/reporting.integration.test.js"]),
    extraEnv: Object.freeze({ REPORTING_INTEGRATION: "1" })
  }),
  "test:password-reset": Object.freeze({
    summary: "Run the opt-in Password Reset Stage 2 MongoDB integration suite.",
    executable: process.execPath,
    args: Object.freeze([
      "--test",
      "test/passwordReset.stage2.integration.test.js"
    ]),
    extraEnv: Object.freeze({ PASSWORD_RESET_INTEGRATION: "1" })
  }),
  "test:all": Object.freeze({
    summary:
      "Run every discovered backend test. Includes the live route suites; the two opt-in Mongo suites still require their own commands above.",
    executable: process.execPath,
    args: Object.freeze(["--test"])
  }),
  "fixtures:plan": Object.freeze({
    summary: "Print a fixture plan. Opens no connection. Accepts --stage=<stage>.",
    executable: process.execPath,
    args: Object.freeze(["scripts/seedTestFixtures.js"]),
    acceptsStage: true
  }),
  "fixtures:verify": Object.freeze({
    summary: "Authenticate and verify the local roles-only fixture recovery files. Opens no connection.",
    executable: process.execPath,
    args: Object.freeze(["scripts/verifyTestFixtureManifest.js"])
  }),
  "fixtures:apply": Object.freeze({
    summary:
      "CREATE FIXTURE RECORDS in the verified disposable database. Accepts --stage=<stage>.",
    executable: process.execPath,
    args: Object.freeze(["scripts/seedTestFixtures.js", "--apply"]),
    acceptsStage: true
  }),
  "fixtures:cleanup": Object.freeze({
    summary: "Delete only the records this run recorded in its manifest.",
    executable: process.execPath,
    args: Object.freeze(["scripts/seedTestFixtures.js", "--cleanup"])
  }),
  "fixtures:unlock": Object.freeze({
    summary: "Remove a verified stale lifecycle lock after explicit operator confirmation.",
    executable: process.execPath,
    args: Object.freeze(["scripts/seedTestFixtures.js", "--recover-lock"])
  }),
  harness: Object.freeze({
    summary:
      "Run harness/verify.ps1, which re-checks the gate itself. Includes lint and build.",
    executable: powershellExecutable(),
    args: Object.freeze([
      "-NoProfile",
      "-File",
      path.join(REPO_ROOT, "harness", "verify.ps1")
    ])
  })
});

const RESOLUTION_REASONS = Object.freeze({
  commandRequired: "COMMAND_REQUIRED",
  unknownCommand: "UNKNOWN_COMMAND",
  unsupportedArgument: "UNSUPPORTED_ARGUMENT",
  stageNotAccepted: "STAGE_NOT_ACCEPTED",
  unknownStage: "UNKNOWN_STAGE",
  stageRequired: "STAGE_REQUIRED",
  emptyArgument: "EMPTY_ARGUMENT"
});

const STAGE_FLAG_PREFIX = "--stage=";

/**
 * Resolves an argument vector to exactly one allowlisted command.
 *
 * Never throws. Refuses anything ambiguous rather than guessing, because a
 * guessed intent here means spawning a process against the wrong target.
 */
function resolveCommand(argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: RESOLUTION_REASONS.commandRequired };
  }

  const [name, ...rest] = argv;

  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, reason: RESOLUTION_REASONS.emptyArgument };
  }

  const command = S5_COMMANDS[name];

  if (!command) {
    return { ok: false, reason: RESOLUTION_REASONS.unknownCommand };
  }

  let stage = null;

  for (const argument of rest) {
    if (typeof argument !== "string" || !argument.startsWith(STAGE_FLAG_PREFIX)) {
      return { ok: false, reason: RESOLUTION_REASONS.unsupportedArgument };
    }

    if (!command.acceptsStage) {
      return { ok: false, reason: RESOLUTION_REASONS.stageNotAccepted };
    }

    const requested = argument.slice(STAGE_FLAG_PREFIX.length);

    if (!STAGE_ORDER.includes(requested)) {
      return { ok: false, reason: RESOLUTION_REASONS.unknownStage };
    }

    stage = requested;
  }

  if (name === "fixtures:apply" && !stage) {
    return { ok: false, reason: RESOLUTION_REASONS.stageRequired };
  }

  return { ok: true, name, command, stage };
}

/**
 * Builds the child environment.
 *
 * `MONGODB_URI` is assigned unconditionally from the already-verified test URI,
 * so an inherited value is overwritten rather than consulted. The caller must
 * only reach this function with a URI the gate has approved.
 *
 * The returned `meta` deliberately carries booleans and key names. It must
 * never be serialised alongside `env`, which contains the credential.
 */
function buildChildEnvironment({
  baseEnv = process.env,
  testUri,
  extraEnv = {}
} = {}) {
  if (typeof testUri !== "string" || testUri.length === 0) {
    return { ok: false, reason: "TEST_URI_MISSING" };
  }

  const inheritedUri = baseEnv.MONGODB_URI;
  const env = { ...baseEnv, ...extraEnv };

  // The substitution. Not a default: an assignment that always overwrites.
  env.MONGODB_URI = testUri;

  // Recorded so the isolation gate can still tell what the operator was pointed
  // at BEFORE substitution. Once `MONGODB_URI` is overwritten the original
  // target is otherwise unrecoverable from the environment, and the gate's
  // "the test URI must not be the pre-existing database" check would compare the
  // test URI with itself and refuse every legitimate child.
  //
  // Empty string means there was no inherited target, which is the normal case
  // when the shell is clean.
  env.PHISHGUARD_TEST_ORIGINAL_MONGODB_URI =
    typeof inheritedUri === "string" ? inheritedUri : "";

  const removedKeys = [];

  for (const key of STRIPPED_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      delete env[key];

      removedKeys.push(key);
    }
  }

  return {
    ok: true,
    env,
    meta: {
      substituted: true,
      // True when the parent carried a MONGODB_URI that was discarded. Reported
      // as a boolean so the fact can be evidenced without disclosing the value.
      inheritedUriDiscarded:
        typeof inheritedUri === "string" && inheritedUri !== testUri,
      strippedKeys: removedKeys,
      extraEnvKeys: Object.keys(extraEnv)
    }
  };
}

/** A printable description of the allowlist. Contains no values. */
function describeCommands() {
  const width = Math.max(
    ...Object.keys(S5_COMMANDS).map((name) => name.length)
  );

  return Object.entries(S5_COMMANDS)
    .map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`)
    .join("\n");
}

module.exports = {
  API_ROOT,
  REPO_ROOT,
  RESOLUTION_REASONS,
  ROUTE_SUITES,
  S5_COMMANDS,
  STAGE_FLAG_PREFIX,
  STRIPPED_ENV_KEYS,
  buildChildEnvironment,
  describeCommands,
  resolveCommand
};
