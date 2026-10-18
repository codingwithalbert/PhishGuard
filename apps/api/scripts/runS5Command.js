#!/usr/bin/env node
"use strict";

/**
 * The supported S5 execution path.
 *
 * One command validates the disposable target and, only if validation succeeds,
 * launches the intended child with `MONGODB_URI` already replaced. The two
 * steps are not separable: there is no flag to validate without launching, and
 * no flag to launch without validating.
 *
 * Usage
 *
 *   node scripts/runS5Command.js <command> [--stage=<stage>]
 *   node scripts/runS5Command.js --list
 *
 * WHY THIS REPLACES THE MANUAL LINE
 *
 * Setting `MONGODB_URI` by hand and forgetting it did not fail loudly. The run
 * simply connected to the database named in `apps/api/.env`. This wrapper makes
 * that mistake impossible in the supported path: if the gate refuses, no child
 * process is ever constructed.
 *
 * UNSAFE BY DESIGN-ABSENCE
 *
 * These remain unsafe for S5 and are deliberately NOT wrapped, because wrapping
 * them would imply they are supported:
 *
 *   npm test                          discovers every suite, including live ones
 *   node src/server.js                the API, pointed at whatever MONGODB_URI is
 *   node scripts/setupTestRoles.js    disabled outright; see that file
 *
 * There is no deployment command in the allowlist, and adding one requires
 * editing `scripts/s5CommandRunner.js`.
 *
 * This script opens no connection itself and prints no credential. The child's
 * own output is passed through unchanged, so a command that logs a raw driver
 * error would still leak through it; that is a property of the command, not of
 * this wrapper.
 */

const {
  evaluateTestDatabaseEnvironment,
  IsolationGateError
} = require("./testDatabaseIsolation");
const {
  API_ROOT,
  STAGE_FLAG_PREFIX,
  buildChildEnvironment,
  describeCommands,
  resolveCommand
} = require("./s5CommandRunner");

// Required lazily and injected by default rather than captured at module load.
// This is what lets the success path be exercised offline: a test supplies its
// own spawn function and its own streams, and no real process is ever created.
function defaultSpawn(executable, args, options) {
  return require("node:child_process").spawn(executable, args, options);
}

function printHelp(stream = process.stdout) {
  stream.write(
    [
      "PhishGuard S5 launcher.",
      "",
      "Usage:",
      "  node scripts/runS5Command.js <command> [--stage=<stage>]",
      "  node scripts/runS5Command.js --list",
      "",
      "Commands:",
      describeCommands(),
      "",
      `Stage flag applies only to fixtures commands: ${STAGE_FLAG_PREFIX}<stage>`,
      "",
      "Every command validates the disposable-database isolation gate first.",
      "A refusal means no child process is started.",
      ""
    ].join("\n")
  );
}

function resolveExitCode(signal) {
  // 128 + signal number, matching shell convention, so a killed child is
  // visibly a killed child rather than an arbitrary failure.
  const numbers = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15
  };

  return 128 + (numbers[signal] || 0);
}

/**
 * The launcher's whole behaviour.
 *
 * Every collaborator is injected - environment, streams, and the spawn function
 * - so the success path can be exercised offline without starting a process, a
 * database, or a connection. Defaults are the production collaborators, so
 * running this file directly is unchanged.
 */
async function main(argv, options = {}) {
  const {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    spawnFn = defaultSpawn
  } = options;

  if (argv.includes("--list")) {
    printHelp(stdout);

    return 0;
  }

  const resolution = resolveCommand(argv);

  if (!resolution.ok) {
    // Help goes to stderr on a refusal: it is a diagnostic explaining why nothing
    // ran, not output the caller asked for.
    stderr.write(`Refused: ${resolution.reason}.\n\n`);
    printHelp(stderr);

    return 2;
  }

  const gate = evaluateTestDatabaseEnvironment(env);

  if (!gate.ok) {
    // The gate's own message is a fixed sentence plus a reason code. Neither can
    // contain a hostname, credential, or connection string.
    stderr.write(
      `The disposable-database isolation gate returned ${gate.reason}.\n`
    );
    stderr.write(
      `${new IsolationGateError(gate.reason).message}\n`
    );
    stderr.write("No child process was started.\n");
    stderr.write(
      "Run node scripts/verifyTestDatabase.js for the full explanation.\n"
    );

    return 1;
  }

  const { name, command, stage } = resolution;

  if (command.kind === "gate") {
    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          command: name,
          target: gate.target,
          childProcessStarted: false,
          credentialsPrinted: false,
          connectionStringPrinted: false
        },
        null,
        2
      )}\n`
    );

    return 0;
  }

  const args = stage ? [...command.args, `${STAGE_FLAG_PREFIX}${stage}`] : [...command.args];

  const built = buildChildEnvironment({
    baseEnv: env,
    testUri: env.PHISHGUARD_TEST_MONGODB_URI,
    extraEnv: command.extraEnv || {}
  });

  if (!built.ok) {
    stderr.write(`Refused: ${built.reason}. No child process was started.\n`);

    return 1;
  }

  // Only booleans and key names are reported. The environment itself, which
  // contains the credential, is passed straight to spawn and never printed.
  stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        command: name,
        stage,
        target: gate.target,
        inheritedUriDiscarded: built.meta.inheritedUriDiscarded,
        strippedKeys: built.meta.strippedKeys,
        extraEnvKeys: built.meta.extraEnvKeys,
        childProcessStarted: true,
        credentialsPrinted: false,
        connectionStringPrinted: false
      },
      null,
      2
    )}\n\n`
  );

  return new Promise((resolve) => {
    const child = spawnFn(command.executable, args, {
      cwd: API_ROOT,
      env: built.env,
      stdio: "inherit",
      // Never a shell. A shell would re-parse the arguments and reintroduce an
      // injection surface that a closed allowlist exists to remove.
      shell: false
    });

    child.on("error", () => {
      stderr.write(
        "The child process could not be started. No diagnostic detail is printed, "
          + "because a spawn failure can carry the resolved executable path and "
          + "environment.\n"
      );
      resolve(1);
    });

    child.on("close", (code, signal) => {
      if (signal) {
        resolve(resolveExitCode(signal));
      } else {
        resolve(typeof code === "number" ? code : 1);
      }
    });
  });
}

module.exports = { main, printHelp, resolveExitCode };

// Runs only when this file is executed directly. Requiring it, as the offline
// tests do, must not launch anything.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Sanitized by construction: no error value is printed, because an
      // unexpected failure here could carry environment content.
      process.stderr.write(
        "The S5 launcher failed unexpectedly. Details are suppressed so no "
          + "credential can be logged.\n"
      );
      process.exitCode = 1;
    });
}
