# PhishGuard — Operational Readiness

**Status:** records what the code guarantees and, separately, what has **not** been verified.
**Date:** 2026-10-17
**Scope:** API process lifecycle, health and readiness signalling, and the unresolved infrastructure questions that surround them.

> **Read this first.** This document deliberately separates two different things:
>
> 1. **Verified capability** — behaviour implemented in `apps/api` and covered by
>    offline automated tests in `apps/api/test/`.
> 2. **Unresolved requirement** — anything that depends on the hosting provider,
>    the database provider, or a real environment. None of it has been observed.
>
> Nothing in section 4 should be read as a claim that a backup exists, that
> monitoring is running, or that any recovery capability is operational.

---

## 1. Startup

**Verified.**

| Behaviour | Detail |
|---|---|
| Environment validation | `validateEnvironment()` requires `MONGODB_URI` and `JWT_SECRET` and throws before anything is constructed. Fail-fast is unchanged. |
| Construction | `createApp()` in `app.js` builds the Express application. It opens no database connection and starts no listener. |
| Connection ordering | `startServer()` connects to MongoDB **before** calling `listen()`, so the service never accepts a request it cannot serve. Verified by a test asserting that a failing connection causes zero `listen()` calls. |
| Startup failure | A failure at any step is logged as a single sanitized line and the process exits with code `1`. |
| Sanitization change | The previous implementation printed `error.message` verbatim. A connection failure frequently embeds the database URI or host, so the raw message is **no longer printed**. This narrows what is logged and should be treated as an intentional, recorded change. |

`server.js` executes its startup path only when run directly
(`require.main === module`). Importing it has no side effects, which is what
makes the lifecycle testable offline.

## 2. Graceful shutdown

**Verified.**

On `SIGTERM` or `SIGINT`:

1. Shutdown begins and is logged in the fixed sanitized vocabulary.
2. `server.close()` stops accepting new connections.
3. `closeIdleConnections()` releases pooled keep-alive sockets so the drain can
   complete promptly. **Active requests are not cut off.**
4. Active requests are given the remaining budget to finish.
5. `mongoose.disconnect()` releases the database — deliberately **after** the
   HTTP drain, because disconnecting earlier would fail in-flight requests that
   still need the database.
6. Completion is logged and the process exits `0`.

**Budget.** `SHUTDOWN_BUDGET_MS = 10000` (10 seconds). If draining overruns, the
process terminates with code `1` after a single `SHUTDOWN_TIMEOUT` line, so a
stuck request cannot hold a deployment open indefinitely.

> **PROVISIONAL.** This is an application-level safety net, not a verified value.
> It must be shorter than the termination allowance the hosting platform actually
> grants. That allowance has never been observed for this deployment. If the
> platform allows less than 10 seconds, it will send `SIGKILL` first and the drain
> will never finish. **Confirm against the real platform.**

Shutdown is idempotent: once begun, later signals and later fatal errors cannot
start a second one, which is what prevents recursive or duplicated cleanup.
Shutting down before the server ever listened is safe.

## 3. Fatal process errors

**Verified.**

`unhandledRejection` and `uncaughtException` are both handled. Without this,
Node terminates the process on an unhandled rejection with no explanation.

- The rejection or thrown value is **discarded**. Only a fixed category is
  logged: `UNHANDLED_REJECTION` or `UNCAUGHT_EXCEPTION`.
- No exception message, stack, request body, token, connection string, or
  driver diagnostic is ever serialized. A test asserts the output contains none
  of a set of planted secret values.
- A controlled shutdown then runs — HTTP drain, database release — and the
  process exits `1`.
- The application is never left running indefinitely after a fatal process-level
  error.

Process handlers are registered exactly once. Re-registration replaces this
module's own handlers rather than stacking a second set, and it never removes
handlers owned by anything else.

## 4. Liveness versus readiness

**Verified.**

The two concerns are deliberately **separate routes**, because conflating them
causes a specific failure: a platform that restarts an unhealthy container turns
a transient database blip into a restart loop, which is worse than the outage
that caused it.

| Endpoint | Meaning | Behaviour |
|---|---|---|
| `GET /api/health` | **Liveness** — is this process sane? | Always `200` with `{ "status": "ok", "service": "phishguard-api" }`. **Unchanged from before this work and independent of MongoDB.** |
| `GET /api/ready` | **Readiness** — should traffic be routed here? | `200` only when MongoDB is connected; otherwise `503`. Sends `Cache-Control: no-store`. |

Readiness body: `{ "status": "ready" | "not_ready", "service": "phishguard-api", "database": <state> }`
where `<state>` is one of exactly four fixed words: `connected`, `connecting`,
`disconnecting`, `disconnected`, or the fallback `unavailable`.

The connection state is mapped through a **closed set**. The driver's own string
for the state is never used, and the response contains **no** database host,
port, URI, credential, driver version, or connection diagnostic.

**Intended usage.** A platform or load balancer should probe `/api/ready` for
traffic eligibility. `/api/health` is for humans and for simple uptime checks.

> **Unresolved.** No hosting-provider health-check path has been configured or
> observed. No deployment manifest (`render.yaml`, `Dockerfile`, `Procfile`) is
> tracked in this repository. **The required health-check path must be confirmed
> against the real platform before this section can be called operational.**

### Known gap, not addressed here

`app.js` has **no dedicated unmatched-route handler**. An unknown path falls
through to Express's default 404 rather than a JSON envelope. This is unchanged
behaviour, recorded here rather than fixed, because changing it would alter an
existing response contract.

---

## 5. Application logging

**Verified.**

| Channel | Source | Content |
|---|---|---|
| Audit events | `middleware/audit.middleware.js` | `[AUDIT]` JSON: login success/failure, password reset request/completion/failure, profile update, password change |
| Global errors | `middleware/error.middleware.js` | `[ERROR]` JSON: fixed category and error **type name** only |
| Authentication lookup failures | `middleware/auth.middleware.js` | `[AUTH]` JSON: fixed category only |
| Report notifications | `services/reportNotification.service.js` | `[REPORT_NOTIFICATION]` JSON: report id, type, fixed outcome |
| Lifecycle | `server.js` | `[LIFECYCLE]` JSON: fixed shutdown/startup/fatal categories only |

All of it is written to stdout/stderr via `console`. The sanitized-diagnostics
convention is deliberate and consistent: messages, stacks, codes, bodies,
connection strings, and query strings are never serialized.

> **Unresolved.** No log destination, retention policy, shipping configuration,
> or redaction review has been established. What a platform captures from stdout,
> and for how long, is unknown.

---

## 6. Unresolved infrastructure requirements

**Every item in this section is UNVERIFIED.** None has been inspected, and none
should be reported as a capability.

| # | Question | Status | Why it matters |
|---|---|---|---|
| 1 | **Database backup ownership** | **Unresolved** | Nobody is recorded as responsible |
| 2 | **Backup frequency and retention** | **Unresolved** | Cannot state what exists or how long it is kept |
| 3 | **Restore procedure and verification** | **Unresolved** | A backup that has never been restored is not a recovery plan |
| 4 | **RPO (recovery point objective)** | **Unresolved** | Maximum acceptable data loss is undefined |
| 5 | **RTO (recovery time objective)** | **Unresolved** | Maximum acceptable downtime is undefined |
| 6 | **Monitoring and uptime checks** | **Unresolved** | No monitoring has been observed |
| 7 | **Alerting** | **Unresolved** | No alert routing exists |
| 8 | **Incident escalation ownership** | **Unresolved** | No named owner or contact path |
| 9 | **Hosting-provider configuration** | **Unverified** | Deployment asserted historically; nothing inspected since |
| 10 | **Platform termination allowance** | **Unverified** | Governs whether the 10s shutdown budget is safe |
| 11 | **Platform health-check path** | **Unverified** | Governs whether `/api/ready` is probed at all |
| 12 | **Database least privilege / grants** | **Unverified** | `config/db.js` connects with a URI and no explicit options |
| 13 | **Encryption at rest and in transit** | **Unverified** | Depends entirely on provider configuration |
| 14 | **Index build state in any real database** | **Unverified** | Schemas declare indexes; only a real database can confirm they exist and are used |

### What this means in practice

This system stores student personally identifiable information, assessment
records, and incident reports. With items 1–8 unresolved, a data-loss event is
currently **unrecoverable by any documented procedure**, and no one is recorded
as responsible for noticing or responding.

The code work in sections 1–5 makes that gap **visible and owned**. It does not
close it. Closing items 1–8 requires an authorized environment and an institutional
decision, neither of which has occurred.

---

## 7. Research-data privacy dependencies

Operational readiness for the Research Analytics surface additionally depends on
governance that is **not approved**:

- The in-app cohort is every active `role=user` account. There is **no consent
  capture, no withdrawal mechanism, and no retention policy**.
- The small-cohort suppression threshold in the Analytics Visualization work is a
  **proposed display safeguard**, not an institutionally approved privacy policy.
- Complementary suppression, unfiltered-baseline inference, and the CSV export's
  offline-recomputation implications are all unresolved.
- Consent for the separate external survey does **not** authorize reuse of in-app
  analytics.

See `docs/ethics-and-data-governance.md` for the full governance position and
`specs/analytics-visualization-v1.md` §5.3–5.4 for the suppression limits.
**Real student data must not be displayed, projected, or screenshotted** until an
institutional decision exists.

---

## 8. How much of this is actually verified?

| Layer | Verified by |
|---|---|
| Shutdown sequence, idempotency, budget, cleanup failure | `apps/api/test/lifecycle.test.js` — offline, injected fakes |
| Fatal-error sanitization | `apps/api/test/lifecycle.test.js` — planted-secret assertions |
| Handler registration, no duplicate listeners | `apps/api/test/lifecycle.test.js` |
| Readiness state mapping and response contract | `apps/api/test/lifecycle.test.js` |
| `/api/health` unchanged, 200 while DB disconnected | `apps/api/test/lifecycle.test.js` and `apps/api/test/http.security.test.js` |
| Sanitized error handling, security headers, CORS | `apps/api/test/http.security.test.js` |

**Not verified by any test, and not verifiable without a real environment:**
signal delivery by the actual platform, the platform termination allowance, a
real database connection moving between states, index existence in a live
database, TLS termination, CORS in production, SPA deep-link rewrites, backup
integrity, and monitoring coverage.

The 7 live-API/MongoDB route suites and the 2 opt-in MongoDB suites remain
unexecuted. They require an authorized live environment.