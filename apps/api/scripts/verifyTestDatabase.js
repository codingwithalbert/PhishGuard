#!/usr/bin/env node
"use strict";

/**
 * CLI wrapper around the integration-test database isolation gate.
 *
 * This is the command a human runs - and the command `harness/verify.ps1` runs -
 * before any live integration test. It performs NO connection, reads NO file, and
 * loads NO `.env`.
 *
 * It deliberately does not call `require("dotenv").config()`. Loading `.env`
 * here would populate `MONGODB_URI` in this process, and the whole point of the
 * gate is that the test target is supplied explicitly through
 * `PHISHGUARD_TEST_MONGODB_URI` and never inherited.
 *
 * Usage
 *
 *   node scripts/verifyTestDatabase.js
 *   node scripts/verifyTestDatabase.js --list-required
 *
 * Exit codes
 *
 *   0  the disposable target is authorised
 *   1  refused; stdout carries a reason code and a sanitized report
 *   2  invoked incorrectly
 *
 * SAFE STARTUP SEQUENCE (PowerShell; separate commands, no `&&` or `||`)
 *
 *   $env:PHISHGUARD_ALLOW_LIVE_TESTS          = "1"
 *   $env:PHISHGUARD_TEST_ISOLATION_CONFIRMED  = "I-CONFIRM-DISPOSABLE-NOT-DEV-NOT-PROD"
 *   $env:PHISHGUARD_TEST_DB_SCOPE_CONFIRMED   = "I-CONFIRM-READWRITE-ON-THIS-DATABASE-ONLY"
 *   $env:PHISHGUARD_TEST_CLUSTER              = "<atlas cluster name>"
 *   $env:PHISHGUARD_TEST_CLUSTER_HOST         = "<cluster>.<hash>.mongodb.net"
 *   $env:PHISHGUARD_TEST_DATABASE             = "<disposable database name>"
 *   $env:PHISHGUARD_TEST_DB_USER              = "<atlas database user>"
 *   $env:PHISHGUARD_TEST_MONGODB_URI          = "<mongodb+srv://...>"
 *
 *   Set-StrictMode -Version Latest   # optional, unrelated
 *   node scripts/verifyTestDatabase.js
 *   $env:MONGODB_URI = $env:PHISHGUARD_TEST_MONGODB_URI
 *   npm test
 *
 * The single copy from `PHISHGUARD_TEST_MONGODB_URI` into `MONGODB_URI` is the
 * mechanism that redirects the suites away from `apps/api/.env`: dotenv never
 * overwrites a variable that already exists in `process.env`.
 */

const {
  IsolationGateError,
  REQUIRED_DECLARATIONS,
  evaluateTestDatabaseEnvironment,
  requiredChildEnvironmentNames
} = require("./testDatabaseIsolation");

function printRequiredVariables() {
  process.stdout.write(
    [
      "Required environment variables for live integration testing:",
      "",
      "  Authorisation (no secret)",
      "    PHISHGUARD_ALLOW_LIVE_TESTS        must be exactly 1",
      "    PHISHGUARD_TEST_ISOLATION_CONFIRMED  disposable, not dev, not prod",
      "    PHISHGUARD_TEST_DB_SCOPE_CONFIRMED   readWrite on this database only",
      "",
      "  Target declaration (no secret; must match the connection string exactly)",
      "    PHISHGUARD_TEST_CLUSTER",
      "    PHISHGUARD_TEST_CLUSTER_HOST",
      "    PHISHGUARD_TEST_DATABASE",
      "    PHISHGUARD_TEST_DB_USER",
      "",
      "  Connection string (the only secret)",
      "    PHISHGUARD_TEST_MONGODB_URI",
      "",
      `Declared variables checked: ${REQUIRED_DECLARATIONS.length}`,
      `Variables to copy into the test child process: ${requiredChildEnvironmentNames().join(", ")}`,
      ""
    ].join("\n")
  );
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "Usage: node scripts/verifyTestDatabase.js [--list-required]\n"
    );

    return 0;
  }

  if (argv.includes("--list-required")) {
    printRequiredVariables();

    return 0;
  }

  const verdict = evaluateTestDatabaseEnvironment(process.env);

  if (!verdict.ok) {
    // `verdict.reason` is a fixed code and `verdict.checks` is a list of fixed
    // codes. Neither can contain a value taken from the environment, so this
    // payload is safe to print, pipe, and paste into a ticket.
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          reason: verdict.reason,
          credentialsPrinted: false,
          connectionStringPrinted: false
        },
        null,
        2
      )}\n`
    );

    // The human-readable sentence is emitted separately so it cannot be
    // mistaken for part of the machine-readable payload.
    process.stderr.write(`${new IsolationGateError(verdict.reason).message}\n`);
    process.stderr.write("See docs/s5-test-environment.md. No database was contacted.\n");

    return 1;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        liveTestsAuthorized: true,
        isolationConfirmed: true,
        databaseScopeConfirmed: true,
        target: verdict.target,
        credentialsPrinted: false,
        connectionStringPrinted: false
      },
      null,
      2
    )}\n`
  );

  process.stdout.write(
    "\nAuthorised. No database was contacted by this command.\n"
    + "Before starting the API or the suites, copy the verified target into the child:\n"
    + "  $env:MONGODB_URI = $env:PHISHGUARD_TEST_MONGODB_URI\n"
  );

  return 0;
}

process.exitCode = main(process.argv.slice(2));
