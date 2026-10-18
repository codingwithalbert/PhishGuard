# PhishGuard — S5 Disposable Test Environment

**Status:** safeguards implemented and verified offline. The separately approved
S5D probe connected, pinged, and disconnected successfully. **No fixture has
been created and no live integration suite has been executed.**
**Date:** 2026-10-17
**Scope:** how to run PhishGuard's backend integration tests against a dedicated,
disposable MongoDB Atlas cluster without any risk of touching development or
production data.

> **Read this first.** The offline gate and probe command exist, but the Atlas
> test project, cluster, database, and database user must be verified by a human
> before any write. A successful ping does not prove project separation, user
> scope, or database emptiness.

---

## 1. Why a gate is needed at all

Six of the seven excluded route suites call `require("dotenv").config()`, which
populates `process.env.MONGODB_URI` from `apps/api/.env`. Two of them
(`dashboard.routes.test.js:163`, `progress.routes.test.js:161`) then call
`mongoose.connect(process.env.MONGODB_URI)` directly.

Nothing in the repository previously prevented those suites from connecting to,
and writing into, a development or production database. The residue is not
hypothetical:

| Suite | Residue |
|---|---|
| `awareness.routes.test.js` | Registers a `user`-role account that is **never deleted** |
| `analysis.routes.test.js` | Creates analyses and reports that are **never deleted**; requires a pre-existing `user@test.com` |
| `dashboard.routes.test.js` | Cleans its own tracked ids across 4 collections |
| `progress.routes.test.js` | Cleans its own tracked ids across 3 collections |

**`awareness.routes.test.js` is the serious one.** The research cohort is
*every active account with the `user` role*, so that leftover account silently
enters Research Analytics.

There is no `dropDatabase`, no `dropCollection`, and no unscoped `deleteMany({})`
anywhere in the suite. The problem was never mass deletion — it was that four of
seven suites could not clean up after themselves at all.

---

## 2. The isolation mechanism, and how it actually works

### 2.1 The one line that matters — and the wrapper that guarantees it

```powershell
$env:MONGODB_URI = $env:PHISHGUARD_TEST_MONGODB_URI
```

`dotenv` **never overwrites a variable that already exists** in `process.env`
(verified against the installed `dotenv@17.4.2`). So exporting `MONGODB_URI`
*before* starting a suite or the API server means `.env` can never supply the
value. The suites connect to the disposable cluster. If this line is omitted,
they connect to `.env`.

**That line used to be a human responsibility, and forgetting it did not fail
loudly.** The run simply connected to the development database.

`apps/api/scripts/runS5Command.js` now removes the possibility. It is the
**supported S5 execution path**, and it makes validation and substitution
inseparable:

1. resolve the requested command against a **closed allowlist** — anything else
   is refused, so a mistyped intent never reaches a process;
2. evaluate the isolation gate — on refusal, **no child process is constructed**;
3. only then build the child environment, **assigning** `MONGODB_URI` from
   `PHISHGUARD_TEST_MONGODB_URI` and **discarding** any inherited value.

There is no flag to validate without launching, and no flag to launch without
validating. An inherited `MONGODB_URI` is overwritten, never used as a fallback.

It also strips `DOTENV_CONFIG_OVERRIDE` and `DOTENV_CONFIG_PATH` from the child.
`require("dotenv").config()` does not honour those in 17.4.2 (verified), but the
`dotenv/config` preload shim does honour `DOTENV_CONFIG_OVERRIDE`, and a future
suite could switch to the preload.

`harness/verify.ps1` performs the same gate-then-substitute sequence itself, so
the harness remains safe on its own.

### 2.2 What the gate does

`apps/api/scripts/testDatabaseIsolation.js` is the single decision point. It is
pure: no connection, no file read, no `.env` load, no dependencies.

It refuses unless **all** of the following hold:

| Requirement | Variable |
|---|---|
| Live runs are authorized | `PHISHGUARD_ALLOW_LIVE_TESTS=1` (exactly) |
| Operator attests the cluster is disposable, not dev, not prod | `PHISHGUARD_TEST_ISOLATION_CONFIRMED` (exact phrase) |
| Operator attests the database user is scoped to this database | `PHISHGUARD_TEST_DB_SCOPE_CONFIRMED` (exact phrase) |
| Cluster name is declared | `PHISHGUARD_TEST_CLUSTER` |
| Full SRV host is declared | `PHISHGUARD_TEST_CLUSTER_HOST` |
| Database name is declared | `PHISHGUARD_TEST_DATABASE` |
| Database user is declared | `PHISHGUARD_TEST_DB_USER` |
| A dedicated connection string is supplied | `PHISHGUARD_TEST_MONGODB_URI` |

It then requires the connection string to match that declaration **exactly**:

- scheme must be `mongodb+srv`;
- host must equal the declared host, and must begin with `<declared-cluster>.`;
- host must end with `.mongodb.net`;
- database must equal the declared database;
- database user must equal the declared user;
- a password must be present;
- **at initial launch, the connection string must not be identical to the
  inherited `MONGODB_URI`.** An inherited original-URI marker is ignored by
  this initial gate. In a launcher child, re-verification compares the recorded
  pre-substitution URI and requires the child's `MONGODB_URI` to equal the test URI.

### 2.3 A name is never proof of isolation

The gate does not accept a target because its name looks disposable. A database
called `phishguard_s5_disposable` is accepted **only** because the operator
declared that exact name *and* the connection string's database segment matches
it *and* the operator separately attested the cluster is disposable. A target
named `phishguard_test` that the operator did not declare is refused, as is a
declared `phishguard_s5_disposable` whose URI disagrees.

This is covered by tests named
`a database whose name merely looks disposable is refused` and
`a cluster name that merely looks disposable is refused`.

### 2.4 Credentials are never printed

The gate's report contains no connection string, no username, and no password.
It carries booleans instead:

```json
{
  "ok": true,
  "target": {
    "scheme": "mongodb+srv",
    "cluster": "phishguard-s5-test",
    "hostPattern": "phishguard-s5-test.<redacted>.mongodb.net",
    "database": "phishguard_s5_disposable",
    "usernameProvided": true,
    "usernameMatchesDeclaration": true,
    "passwordProvided": true
  },
  "credentialsPrinted": false,
  "connectionStringPrinted": false
}
```

Rejections carry a **reason code** and a fixed sentence. Neither can contain a
hostname, username, password, or database name. The connection string is parsed
by hand rather than with `URL`, precisely so no library error message can carry
part of one, and the parser has no password field at all.

### 2.5 Known limitations — read these

1. **The two attestations are human statements, not machine-verifiable facts.**
   If an operator declares the *development* cluster and types both phrases
   faithfully, the gate passes. No offline check can prevent that. The procedure
   in §4 exists to make the attestation trustworthy in practice.
2. **The gate cannot enforce the substitution by itself.** It runs in a different
   process from the suites. The launcher (`scripts/runS5Command.js`) and the
   harness both perform the substitution as part of their own sequence, so the
   *supported* paths cannot forget it. A hand-run `npm test` outside the launcher
    still can — see §3.9.
3. **Database-user scope cannot be checked without connecting.** The gate
   verifies the *declared* username matches the URI. That the user actually has
   `readWrite` on this database **and nothing else** requires `usersInfo` or the
   Atlas UI — a human step.
4. **The gate does not verify the cluster is empty.** A "disposable" cluster that
   already holds real data would pass every check.
5. **Child output is passed through unchanged.** The launcher never prints a
   credential, but it uses `stdio: "inherit"`, so a *command* that logs a raw
   driver error would still leak through it. That is a property of the command,
   not of the wrapper.

---

## 3. Safe startup sequence

PowerShell. Separate commands; no `&&` or `||`.

### 3.1 Declare the target (values are yours, not this document's)

```powershell
$env:PHISHGUARD_ALLOW_LIVE_TESTS          = "1"
$env:PHISHGUARD_TEST_ISOLATION_CONFIRMED  = "I-CONFIRM-DISPOSABLE-NOT-DEV-NOT-PROD"
$env:PHISHGUARD_TEST_DB_SCOPE_CONFIRMED   = "I-CONFIRM-READWRITE-ON-THIS-DATABASE-ONLY"
$env:PHISHGUARD_TEST_CLUSTER              = "<atlas cluster name>"
$env:PHISHGUARD_TEST_CLUSTER_HOST         = "<cluster>.<hash>.mongodb.net"
$env:PHISHGUARD_TEST_DATABASE             = "<disposable database name>"
$env:PHISHGUARD_TEST_DB_USER              = "<atlas database user>"
$env:PHISHGUARD_TEST_MONGODB_URI          = "<mongodb+srv://...>"
$env:PHISHGUARD_TEST_MANIFEST_SECRET       = "<new random value of at least 32 characters>"
```

`node scripts/verifyTestDatabase.js --list-required` prints this list. Nothing
here belongs in `apps/api/.env`; `apps/api/.env` is **never modified** by any
part of this procedure.

The manifest secret authenticates fixture lifecycle files with HMAC-SHA-256.
Generate it specifically for this disposable run, keep it only in the operator
environment, and do not place it in the manifest, repository, command line, or
logs. The same value is required for every stage, cleanup, and lock recovery.

### 3.2 Verify the gate

```powershell
Set-Location <repo-root>\apps\api
node scripts/verifyTestDatabase.js
```

Exit `0` authorises; exit `1` refuses with a reason code. **No database is
contacted by this command.**

### 3.3 See the supported commands

```powershell
node scripts/runS5Command.js --list
```

### 3.4 Probe connectivity — separate approval required

**Do not run this command as part of offline verification.** After a human has
confirmed the Atlas project is separate from development/production, the test
cluster is empty, the dedicated database user's privileges are limited to the
declared database, and network access is intended for this operator, request
**separate authorization for the first connection**. Only then, from `apps/api`:

```powershell
node scripts/runS5Command.js probe
```

The launcher checks the isolation gate before spawning. The probe rechecks it
inside the child, refuses a mismatched `MONGODB_URI`, connects using only
`PHISHGUARD_TEST_MONGODB_URI`, disables automatic index/collection creation,
issues a database `ping`, and attempts to disconnect. It does **not** enumerate
databases, collections, users, indexes, or records, and does not write fixtures.
Connection options have bounded timeouts; cleanup failure is a failure.

Exit 0 with `ok: true`, `pingSucceeded: true`, and `connectionClosed: true`
means that this test connection and ping succeeded and cleanup was confirmed.
Exit nonzero with `ok: false` identifies a refusal, connection/ping failure, or
unconfirmed cleanup using sanitized reason/category fields. Do not print raw
driver diagnostics or connection strings when investigating a failure. A ping
does **not** prove project separation, database-user scope, cluster emptiness,
application readiness, index existence, or the success of any live suite.
Passing the connection-free gate proves only that declared values and operator
attestations are consistent; it does not independently verify those Atlas facts.
Stop after the first probe and review its result before authorizing fixtures or
integration tests.

### 3.5 Create fixtures — preparation first

```powershell
node scripts/runS5Command.js fixtures:plan --stage=roles
```

This prints the plan and contacts nothing. Read it, and confirm the cohort
arithmetic in §5 before continuing.

Fixture application requires **exactly one explicit `--stage`**. Omitting it is
refused; there is no all-stage apply. Each completed stage is recorded in the
cumulative manifest, so `cohort-reportable` may run in a later invocation only
after that manifest records `cohort-suppression` as complete. Reapplying a
completed stage is refused.

```powershell
node scripts/runS5Command.js fixtures:apply --stage=roles
node scripts/runS5Command.js fixtures:apply --stage=cohort-suppression
```

After the first roles-only write, verify the original local recovery files
without connecting to MongoDB:

```powershell
node scripts/runS5Command.js fixtures:verify
```

This command authenticates the manifest and lifecycle files, requires matching
run IDs, lifecycle status `started`, exactly the completed `roles` stage, no
active stage, exactly three expected role-account identities, and no lifecycle
lock. If `PHISHGUARD_TEST_RUN_ID` is independently retained in the operator
environment, it is also compared; otherwise the verifier does not invent or
require one. Output contains only fixed booleans, counts, and sanitized codes—no
HMAC secret, connection string, manifest contents, or document IDs. It reads the
original recovery files only and does not inspect backup copies.

### 3.6 Start the API against the verified database

```powershell
node scripts/runS5Command.js api
```

Leave it running in its own terminal. Confirm `GET /api/health` returns 200 and
`GET /api/ready` returns 200 (not 503) before running any suite. A 503 means the
API is pointed somewhere else.

### 3.7 Run the suites

In one terminal, with the API already running:

```powershell
node scripts/runS5Command.js test:routes
node scripts/runS5Command.js test:reporting
node scripts/runS5Command.js test:password-reset
```

`test:routes` runs the seven live suites in cleanup-safe order, putting the two
that cannot clean up after themselves (`analysis`, `awareness`) last. The two
opt-in suites stay opt-in: the launcher sets `REPORTING_INTEGRATION=1` and
`PASSWORD_RESET_INTEGRATION=1` only for the commands that name them.

### 3.8 The full verification harness

```powershell
node scripts/runS5Command.js harness
```

or, equivalently and directly:

```powershell
Set-Location <repo-root>
.\harness\verify.ps1
```

With `PHISHGUARD_ALLOW_LIVE_TESTS` unset it refuses, as before. With it set, it
runs `verifyTestDatabase.js` **first** and substitutes `MONGODB_URI` before
`npm test`.

### 3.9 Commands that are UNSAFE for S5

These are **not** wrapped, and using them during S5 forfeits isolation. They are
listed so nobody reaches for them out of habit.

| Command | Why it is unsafe for S5 |
|---|---|
| `npm test` | Discovers every suite, including the seven live route suites, with **no** isolation gate and **no** substitution. Points at `apps/api/.env`. |
| `npm start` | Starts the API against whatever `MONGODB_URI` happens to be set to. |
| `node src/server.js` | Same hazard as `npm start`, with no wrapper. |
| `node scripts/seedTestFixtures.js …` | Bypasses the launcher. The child recheck requires a launcher-substituted `MONGODB_URI` and original-URI marker; use the launcher instead. |
| `node scripts/setupTestRoles.js` | **DISABLED.** Exits 2, performs no action. See §7. |
| any `mongosh`, Atlas console, or GUI write | Bypasses every check and the run manifest, so cleanup can no longer be scoped. |

If you need the isolation that only the launcher provides, use the launcher.

### 3.10 Clean up and discard

```powershell
node scripts/runS5Command.js fixtures:cleanup
```

This deletes **only** the `_id` values recorded in the run manifest, then deletes
the manifest. There is no truncate, no collection drop, and no predicate broader
than "these ids". A manifest written for a different declared target is refused.

Apply and cleanup hold an exclusive manifest-adjacent lifecycle lock for their
entire operation, including MongoDB writes. Contention fails closed. A crash
leaves the lock in place deliberately; it is never removed automatically. First
verify in Task Manager that the recorded Node process is no longer running and
that no fixture terminal remains active, then set the exact recovery confirmation:

```powershell
$env:PHISHGUARD_TEST_LOCK_RECOVERY = "I-CONFIRM-NO-FIXTURE-PROCESS-RUNNING"
node scripts/runS5Command.js fixtures:unlock
```

Recovery authenticates the lock, checks its declared target, and refuses while
the recorded process is alive. Remove the confirmation variable afterward. Do
not delete or edit the lock manually.

Then drop the Atlas cluster and the database user. **A disposable database is
discarded, not emptied.** Leaving it in place is how a disposable database
becomes a permanent one.

---

## 4. How to verify the database is genuinely isolated

The gate cannot prove isolation. These are the human checks that make the
attestation honest.

1. **Separate Atlas project.** The test cluster must live in a *different Atlas
   project* from development and production. A separate cluster in the same
   project shares the project's audit log, alerts, and access list — which is
   weaker isolation than it appears.
2. **Different database user, scoped to one database.** Create the user with
   `readWrite` on the declared database only. Give it no access to any other
   database, and no `readWriteAnyDatabase`.
3. **Cluster name that cannot be mistaken.** Avoid `dev`, `staging`, `prod`, and
   avoid a name that resembles the production cluster.
4. **Confirm the SRV host.** Run `node scripts/verifyTestDatabase.js` and compare
   the reported `cluster` and `database` against the Atlas UI. They must match
   the test cluster.
5. **Confirm it is empty before you start.** `getIndexes()` should show no
   collections, or only collections from a previous S5 run.
6. **Confirm the API is on the test cluster.** After §3.6, `GET /api/ready`
   must return 200. Then check the Atlas metrics view: activity must appear on
   the **test** cluster.
7. **Never reuse a development or production credential.** The connection string
   belongs to the dedicated test user only.

> **Do not read `apps/api/.env` to compare against.** The gate never reads it and
> neither should this procedure. Comparing declared hosts is sufficient, and
> reading the file is forbidden by `AGENTS.md`.

---

## 5. Fixture lifecycle

### 5.1 Stages

| Stage | Creates | Cohort effect |
|---|---|---|
| `roles` | `user@test.com`, `staff@test.com`, `admin@test.com` | **+1** (`user@test.com` is an active `user` account) |
| `cohort-suppression` | 3 participants with assessments and training | total **4** → suppressed |
| `cohort-reportable` | 2 further participants | total **6** → reportable |
| `analyses` | 200 analyses for participant 01 | none |
| `reports` | 1 report, 1 snapshot, 1 message | none |

### 5.2 The cohort arithmetic is the thing to get right

`buildResearchParticipantDataset()` selects **every active account holding the
`user` role**. `user@test.com` — required by `analysis.routes.test.js` — is
exactly such an account, so it counts.

Suppression engages below five observations
(`MINIMUM_REPORTABLE_OBSERVATIONS = 5`).

> **Creating "four participants" plus `user@test.com` produces a cohort of five,
> which does NOT suppress.** The resulting screenshot would look like a
> suppression test and prove nothing.
>
> The stages are therefore expressed as **cohort totals**: three participants
> plus the analysis user is a cohort of **four**, and two more takes it to
> **six**.

This is verified by `test/testFixturePlan.test.js`, including a drift guard that
compares the plan's threshold against the real
`researchAnalytics.suppression.js` export.

### 5.3 Credential handling

No password is hardcoded, defaulted, or logged. Each account reads its own
environment variable and is stored as a bcrypt hash at the product's cost factor
of 12.

`PHISHGUARD_TEST_FIXTURE_PASSWORD` must match the value hardcoded in
`apps/api/test/analysis.routes.test.js`, which is what makes that suite
runnable. That value is a synthetic test credential already present in the
repository; it is not repeated here.

### 5.4 Privileged roles

The `staff` and `admin` roles are written **directly onto the account document**
by the fixture. No application route can assign them — public registration
discards a client-supplied role — and the fixture deliberately does not call the
registration endpoint. Application authentication behaviour is untouched, and the
roles cannot be obtained by replaying a registration request.

### 5.5 Cleanup is manifest-scoped

Before each database create, a preallocated `_id`, stage, collection, and
collection-specific synthetic identity are added to an HMAC-authenticated run manifest
in the OS temp directory, deliberately **outside** the repository. Each update
is written to a restricted temporary file, flushed, and atomically renamed. If
recording fails, the database create is not attempted. Stages accumulate in the
same manifest; an existing manifest is verified and continued, never replaced
with a new run. An interrupted stage remains marked active and blocks further
application until cleanup.

Cleanup rechecks the isolation gate, manifest owner/authentication/target, entry shape,
and the stored document's expected synthetic identity. It then issues one exact
`deleteOne` per verified `_id`; it never drops a collection or performs an
unscoped/multi-document deletion. Missing documents are treated as reservations
whose create never completed. Any identity mismatch, malformed/tampered
manifest, or unconfirmed deletion stops cleanup and preserves the manifest.

Authentication rejects modification by anyone who does not possess the separate
manifest secret. It cannot protect against compromise of both the lifecycle
files and that secret. Keep both private and do not use a shared temp directory.
If application is interrupted, do **not** rerun that
stage: run the launcher cleanup command, review its result, confirm the manifest
was removed, and only then prepare a new run. Cleanup cannot remove route-suite
records that were not created and recorded by the fixture lifecycle.

An authenticated lifecycle state distinguishes a run that was initialized but
never reached a database connection from one that started and then lost its
manifest. Missing provenance or a missing manifest after start is a hard cleanup
failure, never “nothing to clean up.”

---

## 6. Stop conditions

Halt and report. Do not work around any of these.

1. `MONGODB_URI` in `apps/api/.env` cannot be confirmed irrelevant, or the gate
   returns any reason code.
2. `GET /api/ready` returns 503 after the API has started.
3. Atlas metrics show activity on any cluster other than the declared test one.
4. The database is not empty at the start of a run.
5. Any test fails in a way suggesting shared state — rate-limit interference, a
   pre-existing `user@test.com`, a ticket-number collision.
6. Any test writes outside its tracked scope.
7. The research cohort contains any account not created by the current run.
8. A step would require a new dependency, a production write, or an approval
   that does not exist.

---

## 7. The no-production-data rule

- The live suites must target the dedicated Atlas test database. No exceptions.
- `apps/api/.env` is never read, written, or modified by the gate, the fixtures,
  or the harness. It is left exactly as it is.
- No development or production credential is reused.
- `apps/api/scripts/setupTestRoles.js` is **DISABLED** and performs no action. It
  used to connect to whatever `.env` named and promote two accounts to staff and
  admin, rewriting their passwords, with no isolation gate. It now exits 2 before
  requiring any module, so it cannot connect even in principle. Use
  `node scripts/runS5Command.js fixtures:apply --stage=roles` instead.
- A future need to promote an account on a **non-disposable** database is a
  different activity with different risks. It needs its own gate, approval, and
  review. Reviving this script for it is not the way.
- Real student data is never created, displayed, or screenshotted. Every fixture
  is synthetic.

---

## 8. What is verified, and what is not

**Verified offline (no database contacted):**

| Property | Where |
|---|---|
| Gate refuses without authorisation, attestations, or declaration | `test/testDatabaseIsolation.test.js` |
| Gate never falls back to `MONGODB_URI` or `.env` | same — 38 tests |
| A test target identical to the active one is refused | same |
| A name that merely looks disposable is refused | same |
| No credential appears in the report, an error, or a stack | same |
| Cohort arithmetic 4 → suppressed, 6 → reportable | `test/testFixturePlan.test.js` — 31 tests |
| Fixture plan imports no database driver | same |
| `seedTestFixtures.js` contacts nothing without `--apply` | verified by execution |
| Launcher allowlist is closed; unknown and ambiguous commands refused | `test/s5CommandRunner.test.js` — 31 tests |
| Launcher **assigns** `MONGODB_URI`; an inherited URI is discarded, not used as a fallback | same |
| Launcher strips `DOTENV_CONFIG_OVERRIDE` / `DOTENV_CONFIG_PATH` | same |
| Launcher starts **no child** when the gate refuses | same, by execution against a hostile `MONGODB_URI` |
| `setupTestRoles.js` is disabled: exits 2, requires nothing, mutates nothing | same |
| The Analysis index declaration is asserted offline | `test/analysis.index.test.js` — 9 tests, all passing |
| dotenv does not honour `DOTENV_CONFIG_OVERRIDE` via `config()` in 17.4.2 | verified by execution |

**NOT verified, and not verifiable without a real environment:**

- That the Atlas project, cluster, database, or user exists or is configured.
- That the cluster is genuinely separate from development and production.
- That the database user is scoped to one database.
- The approved S5D probe connected, pinged, and closed against the declared
  Atlas target; this still does not prove project separation, privilege scope,
  or emptiness.
- That `mongoose.disconnect()` behaves as assumed under load.
- The platform termination allowance and the 10 s shutdown budget.
- That any live suite passes. **No integration test has ever been executed in
  this project.**
- That the `Analysis` index exists, was built, or is chosen by the planner. The
  offline tests assert the *declaration* only, which is all they can assert.
- **Not modified, deliberately:** `reporting.integration.test.js` calls
  `model.collection.indexes()`, so extending it to assert the `Analysis` index
  could only be verified against a live database. That fails the "independently
  testable offline" bar, so it was left alone.

---

## 9. Related documents

| Document | Content |
|---|---|
| `docs/operational-readiness.md` | Process lifecycle, health/readiness, unresolved infrastructure items |
| `docs/ethics-and-data-governance.md` | Consent, cohort, retention, withdrawal — all unresolved |
| `harness/verify.ps1` | Verification harness and its authorisation gate |
| `apps/api/.env.example` | Every variable above, documented, all unset |
| `apps/api/scripts/runS5Command.js` | The supported S5 launcher |
