#!/usr/bin/env node
"use strict";

/*
 * ============================================================================
 * DISABLED 2026-10-17 (S5B-Guard) — THIS SCRIPT NO LONGER DOES ANYTHING
 * ============================================================================
 *
 * WHAT IT USED TO DO
 *
 * It loaded `apps/api/.env`, connected to whatever `MONGODB_URI` that file
 * named, and then:
 *
 *   - promoted `staff@test.com` to the staff role,
 *   - promoted `admin@test.com` to the admin role,
 *   - REWROTE BOTH PASSWORDS.
 *
 * WHY IT IS DISABLED
 *
 * 1. It had no isolation gate. Run against a shared development or production
 *    database it escalated two real accounts and reset their credentials. That
 *    is a privilege change on live data, not a test side effect.
 *
 * 2. It could not even do its own job. It used `findOneAndUpdate`, which only
 *    matches an EXISTING account, so it required the two accounts to have been
 *    created beforehand by some other means. No application route can create a
 *    staff or admin account: public registration discards a client-supplied
 *    role. The script was therefore strictly LESS capable than its replacement
 *    while being strictly MORE dangerous.
 *
 * 3. It printed a raw `error.message`. A MongoDB connection failure embeds the
 *    connection string, so that line could log a credential, contradicting the
 *    sanitized-diagnostics convention used across the project.
 *
 * WHAT REPLACES IT
 *
 * `scripts/seedTestFixtures.js`, through the supported S5 launcher. It:
 *
 *   - refuses to run unless the disposable-database isolation gate passes;
 *   - CREATES the accounts rather than promoting existing ones, so it needs no
 *     prior privileged write to have happened;
 *   - writes privileged roles directly onto synthetic documents in the
 *     disposable database, never through the registration route;
 *   - never falls back to `apps/api/.env`;
 *   - never logs a credential.
 *
 *   node scripts/runS5Command.js fixtures:apply:roles --stage=roles
 *
 * The old implementation is preserved verbatim in version control and can be
 * read with:
 *
 *   git show HEAD:apps/api/scripts/setupTestRoles.js
 *
 * A future need to promote an account on a NON-disposable database is a
 * different activity with different risks. It needs its own gate, its own
 * approval, and its own review. It is not this script's job, and reviving this
 * file for it is not the way.
 * ============================================================================
 */

const EXIT_CODE_DISABLED = 2;

process.stderr.write(
  [
    "",
    "setupTestRoles.js is DISABLED and performs no action.",
    "",
    "It promoted two accounts to privileged roles and rewrote their passwords",
    "against whatever database apps/api/.env named, with no isolation gate.",
    "",
    "Use the gated fixture script through the supported S5 launcher instead:",
    "",
    "  node scripts/runS5Command.js fixtures:apply:roles --stage=roles",
    "",
    "See docs/s5-test-environment.md.",
    ""
  ].join("\n")
);

// No database driver is required, no .env is loaded, no connection is opened,
// and no write is attempted. The process exits before any of that is possible.
process.exitCode = EXIT_CODE_DISABLED;
