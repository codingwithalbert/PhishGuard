# User Role Management V1 Specification

> Status: **Proposed** — design only. Not approved, not implemented, no
> application code exists for this feature. This document is a request for
> review and approval.

## 1. Purpose

User Role Management V1 gives PhishGuard administrators a controlled,
auditable way to manage the roles of existing accounts:

- view a paginated directory of users with only the minimum information needed
  to identify a target,
- change an existing active user between the three existing roles (`user`,
  `staff`, `admin`).

The feature exists to replace the unsafe, disabled `setupTestRoles.js` practice
of promoting accounts by editing a database directly, with an in-application,
authorized, transactional, audited operation.

This feature is intentionally narrow. It adds no account creation, no account
deletion, no activation/deactivation control, no email change, no name change,
no permission model beyond the three existing roles, and no role-change history
viewer.

Role management is a privileged capability. It is a new product capability and
must not be treated as part of the bounded remaining V1 QA/security work
described in `AGENTS.md`.

---

## 2. Scope

### 2.1 Included in V1

- Admin-only, authenticated, active-administrator access.
- A paginated user directory with a minimal field set.
- Changing an existing active user's role among `user`, `staff`, and `admin`.
- Blocking administrator self-demotion.
- Preventing removal of the last active administrator, including under
  concurrent requests.
- Incrementing `tokenVersion` on a real role change so existing JWTs are
  invalidated.
- Idempotent success (no data modification) when the requested role is already
  assigned.
- A MongoDB transaction that commits the role change and its audit record
  atomically.
- Serialization of concurrent role changes through a shared database guard
  document that must pre-exist (initialized by a separately authorized one-time
  step).
- A validated audit event recording actor, target, previous role, and new role.
- A dedicated per-actor authenticated rate limit on role-change requests.
- A protected admin management page and admin-only navigation entry.
- Documented, separately authorized provisioning of the first real
  administrator.

### 2.2 Not Included in V1

- Creating accounts, inviting accounts, or deleting accounts.
- Activating or deactivating accounts (`isActive` changes).
- Changing email, name, password, or any server-owned field other than `role`.
- Adding, renaming, or removing roles; the role set remains exactly `user`,
  `staff`, `admin`.
- Role-permission editing (what a role may do).
- Bulk role changes.
- An audit-log review UI or a role-change history viewer.
- Impersonation, delegation, or temporary elevation.
- Notification email on role change.
- Account lockout or failure-threshold policies specific to role management, as
  distinct from the per-actor request rate limit that is included (Section 12.1).
- Statistics, leaderboards, streaks, rankings, or gamification of any kind.

---

## 3. Access and Ownership

- Only an authenticated, active account whose current role is `admin` may use
  this feature.
- Authorization is enforced by the backend and is the security boundary.
  Frontend gating is a usability control only.
- The acting administrator's identity is derived only from `req.user.userId`
  and `req.user.role`, established by the existing `authenticate` middleware
  from the current `User` record. The client must never supply the actor.
- The target user is identified by a path parameter and is validated server
  side; the client never supplies a role for itself through any other channel.
- The backend continues to authorize every request from the live database
  record, not from token claims, as `authenticate` already does.

---

## 4. User Directory

### 4.1 Endpoint

```
GET /api/admin/users
```

Authentication: required. Authorization: `admin` only.

### 4.2 Pagination

- The directory is paginated and must never return the entire collection
  unbounded.
- Supported query parameters:

```json
{
  "page": 1,
  "pageSize": 20
}
```

- `page` is a positive integer, default `1`.
- `pageSize` is a positive integer, default `20`, with a hard maximum of `100`.
  A value above the maximum is rejected with `400`; it is never silently clamped.
- Unknown query parameters are rejected.
- **V1 has no directory search and no role filter.** These are deferred to a
  future version (Section 18). Because the query-parameter allowlist is exact,
  any attempt to pass a search or filter parameter is rejected with `400`.
- The ordering is **deterministic: ascending `_id`**. `_id` is unique and
  immutable, so it is a total, stable order and pages cannot shift between
  requests. No secondary sort key is required.
- The response includes pagination metadata:

```json
{
  "success": true,
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  },
  "users": []
}
```

### 4.3 Minimal Field Set

Each directory entry must contain only:

```json
{
  "id": "...",
  "name": "...",
  "email": "...",
  "role": "...",
  "isActive": true
}
```

- No entry may contain `password`, any password hash, password-reset state
  (`passwordResetTokenHash`, `passwordResetExpiresAt`), `tokenVersion`,
  timestamps, or any other server-owned field.
- An explicit projection plus a whitelist DTO is required; a raw model document
  must never be returned.
- Returning `email` to administrators is **finalized for V1**: the admin-only
  directory includes `email`. This is consistent with the existing
  administrator/staff review surfaces that already expose the reporter email,
  and an administrator needs it to identify the correct target before a role
  change. `email` is returned only to authenticated administrators; non-admin
  roles are rejected by authorization before they reach the directory, and the
  role-change response (Section 5.4) is likewise administrator-only.
- Responses send `Cache-Control: no-store`.

---

## 5. Role Change

### 5.1 Endpoint

```
PATCH /api/admin/users/:userId/role
```

Authentication: required. Authorization: `admin` only.

Request body must contain exactly:

```json
{
  "role": "staff"
}
```

Rules:

- `:userId` must be a well-formed 24-character hexadecimal ObjectId and must
  satisfy `mongoose.Types.ObjectId.isValid`; otherwise `400`.
- Additional or unknown body fields are rejected.
- `role` must be one of `user`, `staff`, `admin`; any other value is rejected
  with `400`.
- The client can never modify `name`, `email`, `isActive`, `password`,
  password-reset state, `tokenVersion`, timestamps, or any server-owned field.
  Because the body must contain exactly `role`, any attempt to submit another
  field is rejected as an unexpected field.
- No mass assignment: the update writes only the validated `role` and the
  `tokenVersion` increment for the target identified by `:userId`.

### 5.2 Target Eligibility

- The target must exist and be active. An unknown or inactive target returns a
  generic `404` and performs no write.
- The target's current role and the requested role must both be members of the
  existing role enum.

### 5.3 Idempotent No-Op

When the requested role equals the target's current role:

- Return HTTP `200` success.
- Do not modify any data.
- Do not increment `tokenVersion`.
- Do not write an audit record (no state changed).
- Do not open a write transaction for the no-op fast path; the pre-transaction
  read that detects it is advisory only and is not authoritative.
- Under concurrency, if a competing change makes the requested role already
  assigned before the conditional update matches, the outcome is treated as the
  same no-op success rather than an error.
- The in-transaction no-op is produced by the explicit abort mechanism of
  Section 9.4.1, not by returning a normal callback result: the callback throws a
  dedicated sentinel error, the transaction aborts so the guard write is not
  persisted, and the outer wrapper maps the sentinel to this `200` no-op.
- Correctness never depends on the fast-path read: a genuine role change is only
  ever decided by the in-transaction re-read and the conditional update
  (Sections 9.1 and 9.4).

### 5.4 Success Response

```json
{
  "success": true,
  "message": "User role updated successfully.",
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "role": "staff"
  }
}
```

- HTTP `200`, `Cache-Control: no-store`.
- The response must never include `password`, hashes, reset state,
  `tokenVersion`, or timestamps.

### 5.5 Error Cases

| Case | Status | Requirement |
|---|---|---|
| Missing or invalid authentication | 401 | Existing `authenticate` response |
| Authenticated account is not an active administrator | 403 | Existing fixed authorization failure body |
| Malformed `:userId` | 400 | Names only that the id is invalid |
| Missing, extra, or invalid `role` | 400 | Names only the allowed field and the allowed values |
| Target missing or inactive | 404 | Generic not-found response, no existence detail beyond the target |
| Actor attempts to change their own role | 409 | Fixed message; no write; no audit |
| Change would remove the last active administrator | 409 | Fixed message; no durable write; no audit |
| Concurrent conflicting change detected | 409 | Fixed message; no durable write; safe to retry |
| Unexpected server or transaction failure | 500 | Existing global safe error response |

No error may reveal a password hash, reset state, a connection string, driver
text, or any account detail beyond what the operator already legitimately sees.

---

## 6. Self-Demotion Protection

- An administrator must not be able to demote themselves.
- If `actorUserId` equals `targetUserId` and the requested role differs from the
  current role, the request is rejected with `409 Conflict` (**finalized V1
  decision**; `403` is not used), no write occurs, and no audit record is
  written.
- Because a self change to `admin` is already a no-op (Section 5.3), this rule
  effectively blocks every self-directed change other than the no-op.
- This rule also removes the trivial single-administrator lockout path.

---

## 7. Last Active Administrator Protection

- The system must never allow the number of active administrators to reach zero
  through this feature.
- If the target is the only active administrator and the requested role is
  anything other than `admin`, the request is rejected with `409` and no durable
  write and no audit record result.
- The count of remaining active administrators must be computed **inside** the
  serialized transaction (Section 9), not from a pre-transaction read, and must
  use the same session as the rest of the callback (Section 9.1). A count issued
  without the session runs outside the transaction snapshot and voids this
  protection.
- The count must be taken only after the shared guard document has been written
  in the same transaction (Section 9.2), so the count and the guarded write are
  serialized together.
- The guard write happens before the count; when the request is rejected, the
  transaction is aborted, so the guard write is rolled back and no durable write
  occurs.
- Concurrency must be handled explicitly: because role changes touch different
  user documents, MongoDB snapshot isolation alone permits write skew. The
  concrete failure to prevent is two administrators concurrently demoting each
  other when they are the only two administrators, which could otherwise reach
  zero administrators. Section 9 defines the required serialization mechanism.

---

## 8. Token Invalidation

- On a real role change, the target's `tokenVersion` must be incremented in the
  same atomic update as the role change:

```json
{
  "$set": { "role": "<newRole>" },
  "$inc": { "tokenVersion": 1 }
}
```

- Because `authenticate` compares the token's `tokenVersion` claim with the
  current database value, incrementing invalidates every existing JWT for the
  target on the target's next request.
- `tokenVersion` is incremented only when the role actually changes. A no-op
  (Section 5.3) must not invalidate the target's sessions.
- The acting administrator's own token is unaffected unless they changed
  themselves, which Section 6 blocks.
- The existing JWT structure, one-hour expiry, and `tokenVersion` semantics must
  not change.

---

## 9. Transaction, Atomicity, and Concurrency

### 9.1 Atomic Commit Requirement

The role change and its audit record must be committed atomically in a single
MongoDB transaction. The transaction callback performs these steps, in order,
and **every MongoDB read and write in the callback must pass the same
`session`**:

1. Start a session and a transaction (wrapper per Section 9.3).
2. Revalidate the acting administrator from the database **with the session**:
   the actor must still be active and still hold `admin`.
3. Look up the target user **with the session**.
4. Enforce target eligibility (Section 5.2) and self-demotion (Section 6)
   **with the session**; reject with `404` or `409` if either fails.
5. Write the shared guard document **with the session** (Section 9.2). This must
   happen **before** the last-administrator count so the count and the guarded
   write are serialized together.
6. Count the remaining active administrators **with the session** and enforce the
   last-administrator rule (Section 7).
7. Apply the conditional update (Section 9.4) **with the session**.
8. Insert the audit record **with the session** (Section 10).
9. Commit.

No operation may be left to run on an implicit session. Mongoose 9 does not
attach a session automatically unless `transactionAsyncLocalStorage` is enabled,
and this application does not enable it, so an operation that omits
`{ session }` silently leaves the transaction and is not rolled back.

If the audit write fails, the role change must roll back; if the update fails,
no audit record is committed. There must be no committed-but-unaudited role
change.

### 9.2 Shared Guard Document (Required Serialization)

Concurrent role changes must be serialized with a shared database guard
document, not an in-memory mutex:

- The guard has a **fixed identity**: a single document in an internal
  collection (`systemLocks`, the finalized V1 collection name) with the fixed
  `_id` `"user-role-change"` and an integer `version` counter that starts at `0`
  and increases monotonically. It is a singleton; this feature uses no other
  document in that collection.
- Every role-change transaction updates that one document with a genuine,
  session-bound write (an `$inc` on `version`) **before** the
  last-administrator count.
- Because every role-change transaction writes the same document, two
  concurrent role changes produce a write conflict; the losing transaction is
  retried by the transaction wrapper and then re-evaluates the
  last-administrator count against a fresh snapshot.
- The guard write is **not** an upsert: it must update the pre-existing
  document. The guard document must exist before role changes are enabled
  (Section 17.2). A zero-match guard write means the guard is missing or
  misconfigured and must abort the transaction with a fixed, sanitized error
  rather than proceeding unserialized.
- A failed guard write must abort the transaction (Section 9.5).
- An in-process mutex is explicitly rejected: it would not serialize across
  instances and would move a data-integrity guarantee out of the database.
- The guard document is internal only and must never be exposed through any API
  or response.

The guard collection (name and document shape now finalized in Sections 9.2 and
17.2), its creation, and its initialization are new data model state and require
the separate approval described in Section 17.

### 9.3 Transaction Options and Retry

- Use a transaction wrapper equivalent to `session.withTransaction(...)` so
  transient transaction errors are retried and the whole callback (including
  the audit write) is re-run on retry.
- The transaction callback must be safe to re-run: it re-reads all state and
  performs no non-idempotent external side effect.
- **Pass the transaction options explicitly**: write concern
  `{ w: "majority" }` and read concern `snapshot`. The application's connection
  (`apps/api/src/config/db.js`) sets no write concern, and the MongoDB driver
  does not force majority on the first commit attempt, so a privileged
  role-change transaction left on the default would not be majority-durable
  until a retry. Requiring `writeConcern: { w: "majority" }` explicitly is what
  makes the atomic role-change-plus-audit commit majority durable.
- Every MongoDB operation inside the callback must pass the same `session`
  (Section 9.1). `transactionAsyncLocalStorage` is disabled by default in
  Mongoose 9 and is not enabled by this application, so no operation inherits
  the session implicitly.
- **Errors must not be swallowed.** Every awaited operation in the callback must
  propagate its rejection out of the callback; a `try`/`catch` that absorbs an
  operation error would let the driver commit a partially applied transaction.
  Only the outer HTTP boundary may convert a rejection into a sanitized response
  (Section 9.5).
- Always end the session, including on failure.

### 9.4 Conditional Update (Optimistic Concurrency)

- The update must be conditioned on the target still being active and still
  holding the role that was read inside the transaction, for example:

```json
{
  "_id": "<targetUserId>",
  "isActive": true,
  "role": "<previousRole>"
}
```

- If `matchedCount` is `0`:
  - if the current role now equals the requested role, the transaction must be
    aborted so the guard write is not persisted, and the outer wrapper returns
    the no-op success of Section 5.3 (no durable write occurs);
  - otherwise, the transaction must be aborted and the outer wrapper returns the
    concurrent-conflict `409` of Section 5.5.
- The conditional update is the only operation that may change the target, and
  it re-verifies `isActive` and the expected prior role, so a stale
  pre-transaction read can never cause an incorrect write.
- This prevents lost updates when two administrators act on the same target.

#### 9.4.1 No-Op and Rejection Control Flow (Explicit, Testable)

Both `matchedCount === 0` outcomes must be escalated by aborting the transaction.
This feature must **not** assume that an explicitly aborted transaction can
safely return a normal callback result; that assumption is unverified and must
not be relied upon.

- **`abortTransaction()` followed by a normal `return` is not a supported
  pattern.** `session.withTransaction(callback)` interprets a normally returning
  callback as a request to commit. If the callback also aborts the transaction
  first, the driver's subsequent commit attempt — and the resulting behavior and
  error surface — is not a documented, stable contract. The feature must not
  depend on that behavior and must not assume the abort "wins" without
  database-backed verification.
- **Required mechanism: a dedicated sentinel error.** The callback signals
  "abort this transaction and map to outcome X" by `throw`ing a dedicated
  internal error object (for example, a `RoleChangeControlFlow` error carrying a
  fixed machine-readable outcome such as `noop` or `conflict`). Throwing is the
  only supported way to guarantee the transaction is aborted and no commit is
  attempted.
- **The wrapper maps the sentinel; it does not retry it.** The transaction
  wrapper must recognize the sentinel before the generic retry path, must not
  classify it as a transient `TransientTransactionError`, and must translate it
  into the corresponding HTTP result (`200` no-op for `noop`, `409` for
  `conflict`). All other thrown errors keep the existing behavior
  (Section 9.5).
- **The sentinel must never escape to the client.** It is internal; only the
  mapped, sanitized HTTP result is returned.
- **This control flow must be verified, not assumed.** Verification is required
  at two levels:
  - offline, by asserting the callback `throw`s the sentinel (rather than
    returning a value) and that the wrapper maps it with no commit and no retry
    (Section 15.1); and
  - against a disposable replica set, by asserting that after the sentinel abort
    the guard document's `version` is unchanged, the target's `role` and
    `tokenVersion` are unchanged, and no audit record was written
    (Section 15.4).

### 9.5 Rollback Behavior

- Any thrown error inside the transaction callback aborts the transaction; the
  role update and the audit record are both rolled back.
- A failure to commit leaves no partial state.
- A failed transaction returns a sanitized `500` (or a fixed `503`) and emits at
  most one sanitized server-side diagnostic line containing no driver text,
  connection string, or event payload.
- A failure is not itself written as an audit record, because a durable write
  through the failing dependency is unreliable and no state changed.
- A transaction rejected because the guard document is missing or a guard write
  matched nothing (Section 9.2) is an internal misconfiguration and returns the
  sanitized `500`; it never returns the concurrent-conflict `409`.

### 9.6 Audit Persistence Failure Handling (V1, Fail-Closed)

- Audit insertion participates in the same transaction as the role change
  (Section 9.1). If the audit insert fails, the transaction aborts and the role
  update **cannot commit**. There must never be a committed role change without
  its audit record.
- The audit service throws `AuditServiceError`, a plain `Error` subclass, and
  re-wraps the underlying cause in a sanitized message. A MongoDB transient error
  that occurred during the audit insert can therefore lose its
  `TransientTransactionError` label, so the transaction wrapper may not
  automatically retry that specific failure.
- **This V1 behavior is fail-closed and is acceptable for V1 only because the
  entire transaction aborts**: the role update cannot commit without its audit
  record, and the failure surfaces as a sanitized error (Section 9.5), never as
  a partial write.
- Improving retry classification (for example, preserving MongoDB error labels
  across the sanitized re-wrap) is out of scope for V1 and is recorded as a
  deferred decision (Section 18). The existing fail-closed behavior is preserved
  unchanged.
- The audit service's session handling has already been corrected to Mongoose's
  required `create([document], { session })` array form, with offline regression
  coverage (Section 11.1). The public recorder signature remains
  `recordAuditEvent(event, { session })`.

---

## 10. Audit Logging

### 10.1 Event

A successful role change writes exactly one persistent audit event, in the same
transaction as the role change, using the audit service's session support:

```
recordAuditEvent(event, { session })
```

| Field | Value |
|---|---|
| `category` | `administration` |
| `action` | `USER_ROLE_CHANGED` |
| `outcome` | `success` |
| `actor` | Acting administrator's user id (`req.user.userId`) |
| `actorRole` | `admin` |
| `targetUser` | Target user's id |
| `resourceType` | `user` |
| `resourceId` | Target user's id |
| `previousRole` | Target's role before the change |
| `newRole` | Target's role after the change |

The recorder's public signature is `recordAuditEvent(event, { session })`. Its
internal Mongoose call has already been corrected to the required
`create([document], { session })` array form, with offline regression coverage
(Section 11.1), so a caller can rely on the session actually reaching the write
and the write joining the transaction.

### 10.2 Required Schema Extension (Requires Separate Approval)

The existing `AuditLog` schema (`apps/api/src/models/AuditLog.js`) has no field
for the previous and new role. To satisfy Section 10.1, the schema must be
extended with two bounded, enumerated, immutable fields:

- `previousRole`: enum `[null, "user", "staff", "admin"]`, default `null`,
  immutable.
- `newRole`: enum `[null, "user", "staff", "admin"]`, default `null`,
  immutable.

Supporting requirements if the extension is approved:

- Both fields must be validated together: if either is present, both must be
  present, and both must be members of the existing role set.
- The audit service's closed field allowlist
  (`apps/api/src/services/audit.service.js`) must be extended with exactly these
  two bounded fields. No free-form or `Mixed` field may be introduced.
- The `administration` category already exists and is reused unchanged.
- Because `AuditLog` is append-only, existing documents read these fields as
  `null`; no backfill is required. The extension still requires the approval in
  Section 17 before any code change.

**This AuditLog schema extension requires separate, explicit approval. It must
not be implemented as part of an unrelated task, and it must not be merged
implicitly with the role-management feature.**

### 10.3 Audit Prohibitions

Audit events and diagnostics must never contain:

- any plaintext password, password hash, or password-reset token or token hash,
- any request body,
- any `Authorization` header value,
- any email address, unless a future decision explicitly permits it,
- any free-form metadata, stack trace, connection string, or driver message.

### 10.4 Failed Attempts

- Failed authorization (non-admin) is answered by the existing role middleware
  and is not audited by this feature in V1.
- **Denied role-change attempts are finalized for V1 as sanitized security
  diagnostics only.** A rejected role-change attempt (self-demotion, last-active
  administrator, concurrency conflict, ineligible target, or invalid request)
  may emit at most one sanitized server-side diagnostic line. That line must name
  only the fixed outcome or reason code plus the actor and target identifiers
  already available to the operator, and must contain none of the prohibited
  values in Section 10.3 and no request body.
- **Persistent failure events are deferred.** Recording a durable
  `USER_ROLE_CHANGE_FAILED` audit event is explicitly out of scope for V1
  (Section 18), because it would add a durable write per rejected request and
  could amplify abuse. Diagnostics for denied attempts are therefore transient
  and are not part of the persistent audit trail.
- Successful role changes always produce the persistent transactional event in
  Section 10.1; no V1 path substitutes a diagnostic for that event.
- If a console `auditLog(...)` line is emitted in addition to the persistent
  success event, it must be similarly sanitized and must not include the
  prohibited values above.

---

## 11. Mongoose Session Behavior Investigation and Remaining Verification

### 11.1 Audit Service Session Correction (Applied)

A completed, read-only Mongoose 9 investigation found that
`Model.create(document, { session })` does **not** forward the session in
Mongoose 9. With a non-array first argument, `create()` reads the options object
as a second document and drops the session, so the write escapes the transaction
it was meant to join (and dispatches a spurious second document). The documented
and working form requires an array first argument.

`apps/api/src/services/audit.service.js` has **already been corrected** to use
the array form in the session branch:

```js
const [record] = await auditModel.create([event], { session });
return record;
```

- The public recorder signature is unchanged: `recordAuditEvent(event, {
  session })`.
- The sanitized error path is unchanged, with the fail-closed consequences
  described in Section 9.6.
- Offline regression coverage exists in
  `apps/api/test/audit.service.session.test.js`. It drives the **real**
  `AuditLog` model with a patched `$save` and asserts that exactly one document
  is dispatched, the session is forwarded, the return value is a single record
  (not an array), and no database connection is opened. The fake-model tests in
  `apps/api/test/audit.service.test.js` were updated to the array shape.
- This correction is a prerequisite of the role-management feature and is
  already satisfied. It did not extend the `AuditLog` schema, add a dependency,
  or change the non-session behavior.

### 11.2 Remaining Verification (Required Before Implementation)

Transactional role-change writes must not be assumed to work. Before any
transactional role-change code is written, the following must be verified and
documented:

1. Confirm the installed Mongoose/driver versions expose sessions and
   `withTransaction` (`mongoose ^9.x` and the bundled MongoDB driver support
   sessions).
2. Confirm, by inspection of the deployed connection, that the target database
   is a replica set or sharded cluster. **Atlas alone is not proof.** Atlas
   free/shared tiers are replica sets, but the actual topology of the specific
   cluster must be confirmed, and a standalone server does not support
   transactions at all.
3. Verify against a disposable local replica set (not production and not shared
   data) that:
   - `startSession()` succeeds,
   - `Model.create([document], { session })` participates in the transaction and
     is only visible after commit,
   - the transaction is opened with `writeConcern: { w: "majority" }` and read
     concern `snapshot`,
   - a thrown error inside the transaction aborts it and rolls back both the
     role update and the audit insert,
   - two concurrent transactions writing the guard document produce a write
     conflict that the wrapper retries,
   - `session.endSession()` is always reached.
4. Record the verification method and results.

If transaction support cannot be confirmed, the feature must not be enabled;
Section 16 governs deployment.

---

## 12. API Summary

| Method | Path | Authentication | Authorization | Success |
|---|---|---|---|---|
| GET | `/api/admin/users` | Required | `admin` | `200` paginated minimal user list |
| PATCH | `/api/admin/users/:userId/role` | Required | `admin` | `200` safe updated user, or `200` no-op |

Both endpoints:

- return `Cache-Control: no-store`,
- are mounted under a dedicated administrator route module
  (`/api/admin`), separate from authentication routes,
- run the existing `authenticate` middleware first, then the existing
  `authorizeRoles("admin")` middleware, then request validation, then the
  controller.

### 12.1 Rate Limiting

A dedicated authenticated rate limiter must bound role-change requests. It is
keyed by the server-authoritative `req.user.userId`, mounted after authentication
and identity resolution, and uses its own limiter instance so it cannot consume
another limiter's quota.

**Finalized V1 values:** `10` requests per `15` minutes per authenticated
administrator on `PATCH /api/admin/users/:userId/role`. Exceeding the limit
returns the existing fixed rate-limit response (`429 Too Many Requests`) without
touching persistence. Because the limiter runs after authentication and is keyed
by the resolved actor, one administrator cannot consume another administrator's
quota, and an unauthenticated request cannot consume a named administrator's
quota. Directory reads (`GET /api/admin/users`) are not covered by this limiter.

---

## 13. Frontend

### 13.1 Route and Navigation

- Add a protected admin route, for example `/admin/users`.
- Gate it with the existing `ProtectedRoute` component using
  `allowedRoles={["admin"]}`.
- Add an admin-only navigation entry using the existing role-gated navigation
  definition, mirroring the existing admin-only Research entry.
- Frontend gating is a usability control only; the backend remains the security
  boundary.

### 13.2 Page Behavior

The management page must:

- Load the paginated directory from `GET /api/admin/users`.
- Display only the minimal directory fields.
- Provide controls to request a role change for a target.
- Prevent the administrator from attempting to change their own role, or clearly
  disable that control, consistent with the backend rule.
- Warn that changing a user's role signs that user out of existing sessions
  (because `tokenVersion` is incremented).
- Provide loading, empty, error, disabled, success, and confirmation states.
- Use the existing `Cache-Control: no-store`-aligned request helpers and the
  existing safe error handling.
- Never store passwords, tokens, or other sensitive data in browser storage.
- Preserve keyboard accessibility, visible focus, semantic markup, labels, and
  non-color-only status communication.
- Preserve the existing dark navy/cyan visual system; this is not a redesign and
  adds no new design system or dependency.

### 13.3 Stale Session Snapshot

After a role change, an affected target's stored client role snapshot may be
stale until their next authenticated request. This is acceptable and consistent
with existing behavior; the backend re-derives authorization from the database
on every request.

---

## 14. First Administrator Provisioning

Public registration cannot create a privileged account, so the first real
administrator cannot be created through the application. Bootstrap must be
performed separately, with explicit authorization, and must not use the
application's role-change API (no administrator exists yet).

### 14.1 Required Properties

- Provisioning is a one-time, out-of-band operator action against a specific,
  explicitly named database.
- It requires explicit authorization for the exact step; it is never performed
  implicitly by a test, a fixture, a migration, or a deployment.
- It must not load `.env` by default, must not print credentials, must not
  modify environment variables, and must not access production data without the
  corresponding authorization.
- It promotes exactly one existing active account by setting `role` to `admin`.
- It must not rewrite passwords.

### 14.2 Acceptable Methods

In order of preference:

1. A documented operator action performed directly against the database by an
   operator using the database provider's own tooling with an appropriate
   operator credential, applied to a single existing active account and
   followed by verification that the account can sign in.
2. If a scripted path is genuinely required, a new, separately approved,
   one-shot provisioning script with a hard gate: it must refuse to run unless a
   dedicated authorization variable is set, must require the exact target email
   and an explicit confirmation argument, must set only `role`, and must never
   rewrite credentials or load a default environment file.

### 14.3 Prohibited Methods

- Reviving or re-enabling `apps/api/scripts/setupTestRoles.js`. That script is
  intentionally disabled and its own header states that promoting an account on
  a non-disposable database requires its own gate, approval, and review.
- Using S5 test fixtures or test launchers to promote an account on a
  non-disposable database.
- Any environment-variable allowlist that grants `admin` automatically at
  startup or first login.
- Any "first registered user becomes admin" behavior.

### 14.4 Post-Bootstrap

Once one administrator exists, all further role changes, including promoting a
second administrator, flow through the audited, transactional feature in
Sections 5 through 9. The bootstrap step itself is not recorded by the
application audit trail; that gap must be documented and compensated for by
operator verification.

---

## 15. Testing Requirements

### 15.1 Offline Tests (Required, No Database, No Network)

Route and authorization:

- Unauthenticated `GET` and `PATCH` return `401` without touching persistence.
- `user` and `staff` accounts receive `403`.
- An `admin` reaches the controller.
- `authenticate` is the first handler and `authorizeRoles("admin")` follows on
  every new route.
- Malformed `:userId`, missing/invalid/extra `role`, and unknown query
  parameters are rejected with `400` before any persistence.

Directory (finalized decisions):

- Default requests use `page` `1` and `pageSize` `20`.
- `pageSize` above the hard maximum `100` is rejected with `400` and is never
  silently clamped.
- Results are ordered by ascending `_id`, and paging is stable across requests.
- The directory response includes `email` and excludes every prohibited field
  (Section 4.3).
- A search or role-filter query parameter is rejected with `400` (no search
  exists in V1).

Rate limiting (finalized decision):

- The eleven-per-window role-change request from the same authenticated
  administrator receives `429`; the first ten are allowed.
- The limiter is keyed by `req.user.userId`, so one administrator's requests do
  not consume another's quota.
- Directory reads are not rate limited by this limiter.

Service (fake model, fake session, fake recorder):

- A real change sets `role` and increments `tokenVersion`, and writes the audit
  event with the same session.
- Every mocked operation in the transaction callback — actor revalidation,
  target lookup, guard update, last-admin count, conditional role update, and
  audit insert — receives the **same session object**; the audit recorder
  receives `{ session }`.
- The guard document update is issued **before** the last-admin count.
- A failed guard write, or a zero-match guard write, aborts the transaction
  instead of proceeding unserialized.
- An operation rejection inside the callback is never swallowed and aborts the
  transaction.
- The update document contains only `role` and `tokenVersion`; it never touches
  password or password-reset fields.
- Self-demotion is blocked with `409` (not `403`).
- Removing the last active administrator is blocked when only one remains and
  allowed when another active administrator exists.
- No-op returns success with no write, no `tokenVersion` increment, and no audit
  record.
- The in-transaction no-op and conflict outcomes are signaled by the dedicated
  sentinel error from Section 9.4.1: the callback `throw`s (it does not return a
  value after aborting), and the wrapper maps the sentinel without a commit and
  without classifying it as a transient retryable error.
- Denied role-change attempts emit at most one sanitized diagnostic containing
  none of the prohibited values, and write no persistent failure event.
- Unknown or inactive target returns `404`.
- A non-admin actor is rejected defensively even if a future route is
  misconfigured.
- An audit recorder failure aborts the transaction and leaves no role change.
- A transaction/commit failure surfaces a sanitized error and leaves no partial
  state.
- A conditional update that matches nothing resolves to the no-op success when
  the role already matches, and to a `409` conflict otherwise.
- Concurrency: two simulated concurrent demotions of the last two administrators
  result in at most one success.
- The audit event has the shape in Section 10.1 and contains no prohibited
  values.

Controller:

- Correct status codes and bodies for success, no-op, and every error case.
- `Cache-Control: no-store` on all responses.
- Only the minimal safe user fields are returned.

Regression (offline):

- Existing login, registration, and password-reset audit tests still pass.
- The audit service session tests still pass, including the real-`AuditLog`
  array-form regression in `apps/api/test/audit.service.session.test.js`
  (Section 11.1).
- Existing admin-only and staff/admin reporting authorization behavior is
  unchanged.

### 15.2 Rollback and Atomicity Tests

- Simulate an audit-write failure and assert the role is unchanged after the
  transaction (no committed role change without its audit record; the
  fail-closed behavior of Section 9.6).
- Simulate a role-update failure and assert no audit record is committed.
- Simulate a guard-write failure and assert no role change and no audit record
  are committed.
- Simulate a commit failure and assert no partial state.
- Assert the transaction is opened with `writeConcern: { w: "majority" }` and
  read concern `snapshot`.
- Assert the session is always ended, including on failure.

### 15.3 Concurrency Tests

- Assert the guard document is written by every role-change transaction, with
  the session, before the last-administrator count.
- Assert simultaneous conflicting changes to the same target yield one success
  and one conflict/no-op.
- Assert simultaneous mutual demotion of the last two administrators cannot
  reach zero administrators.
- These concurrency tests may be exercised offline with simulated sessions; the
  real write-conflict behavior is verified in Section 15.4.

### 15.4 Database-Backed Integration Verification (Separately Authorized)

These tests require a **separately authorized, disposable replica set**. They
cannot pass against a standalone server, and they must never run against
production or shared data. They are required, and they must run independently of
the offline suite, only after the offline suite passes and transaction support
is confirmed. They cover:

- Transaction rollback: an audit-write failure and a guard-write failure each
  leave the role unchanged and write no audit record.
- Atomicity: the audit record exists if and only if the role change committed;
  `create([document], { session })` is actually inside the transaction and is
  invisible until commit.
- Concurrent last-administrator protection: two concurrent demotions of the last
  two administrators cannot reach zero administrators, and the guard-document
  write conflict triggers the wrapper's retry.
- Guard pre-existence: the feature fails closed (aborts) when the guard document
  is absent or the guard write matches nothing.
- Majority durability: the transaction commits with
  `writeConcern: { w: "majority" }`.
- Sentinel-abort no-op (Section 9.4.1): after an in-transaction no-op signaled by
  the sentinel error, the guard document's `version` is unchanged, the target's
  `role` and `tokenVersion` are unchanged, and no audit record was written. This
  is the database-backed confirmation that the explicit abort took effect and
  that no commit occurred.
- Pagination correctness and ordering under real data: default `pageSize` `20`,
  rejection above `100`, and stable ascending `_id` ordering across pages.

These tests must not be enabled implicitly and must be explicitly authorized for
a named disposable database before each run.

---

## 16. Deployment and Verification Constraints

- Preserve existing Render services and configurations. This feature must not
  require a new Render service, a changed start command, or a changed build
  pipeline.
- GitHub `main` triggers automatic Render deployment; therefore no change that
  enables this feature may reach `main` until deployment is explicitly approved.
- Transaction support must not be assumed from the use of Atlas. The actual
  database topology must be verified (Section 11) before the feature is enabled.
  A standalone deployment cannot support this feature as specified.
- Credentials must never be exposed, printed, committed, or returned. Environment
  variables must not be modified as part of this feature.
- Production data must not be accessed during development or testing.
- All development and testing remain local until deployment is explicitly
  approved; deployment is a separate authorization step from commit and push.
- If the deployed topology turns out not to support transactions, the feature
  must remain disabled and the limitation documented, rather than shipping a
  weaker, non-atomic guarantee.
- The feature must remain disabled until the shared guard document exists in the
  target database (Section 17.2). Enabling role changes without the guard would
  silently remove last-administrator serialization.

---

## 17. Data Model and Approvals

### 17.1 Existing Collection Reuse

- The role change updates the existing `users` collection in place:
  `$set role` and `$inc tokenVersion` only.
- No user document field is added.

### 17.2 New Guard Collection and Initialization (Requires Separate Approval)

The concurrency guard needs a shared, pre-existing document:

- **Finalized V1 guard shape:** collection `systemLocks`, holding a single fixed
  document with `_id: "user-role-change"` and an integer `version` field that
  starts at `0` and increases monotonically. It is a singleton for this feature.
- It is written only inside role-change transactions and is never exposed
  through any API or response.
- **It must exist before role changes are enabled** (Section 16). The guard write
  is not an upsert; if the document is missing, the guard write matches nothing
  and the transaction must abort (Section 9.2).
- **Initialization is a one-time, separately authorized operator action**
  against a specific, explicitly named database, analogous to
  first-administrator provisioning (Section 14). It must be documented, must not
  print credentials, must not load `.env` by default, must not modify
  environment variables, and must not be folded into this or any other task.
- **Initialization must not occur during this task.** This specification is
  documentation only.
- The guard collection, its document shape, and its initialization all
  **require separate, explicit approval** before implementation.

### 17.3 AuditLog Schema Extension (Requires Approval)

The `previousRole` and `newRole` fields described in Section 10.2 are a
schema extension to the append-only `AuditLog` collection. Adding nullable
fields requires no backfill, but it is still a schema change and **requires
separate, explicit approval** before implementation.

### 17.4 Feature Approval

Because this is a new product capability, an approved specification and explicit
approval are required before any application code is written. Approval of this
document does not, by itself, approve any of the following; each requires its
own separate, explicit decision:

- the `AuditLog` role-transition fields `previousRole`/`newRole`
  (Sections 10.2 and 17.3);
- the guard collection, its document shape, and its initialization
  (Section 17.2);
- the first-administrator provisioning method and its authorization gate
  (Section 14).

---

## 18. Decisions

### 18.1 Resolved V1 Non-Operational Design Decisions

The following decisions are **finalized for V1** and are reflected throughout
this specification (API, testing, limitations, and completion criteria):

| Decision | Finalized resolution | Sections |
|---|---|---|
| Self-demotion status | `409 Conflict` (`403` is not used) | 5.5, 6 |
| Inactive or unknown target | Rejected with a generic `404`; no write | 5.2, 5.5 |
| Admin directory fields | `email` is included in the admin-only directory and role-change response | 4.3, 5.4 |
| Pagination | `page` default `1`; `pageSize` default `20`, hard maximum `100` (above max is `400`) | 4.2 |
| Directory ordering | Deterministic ascending `_id` | 4.2 |
| Directory search / filtering | Deferred to a future version; unknown query parameters are rejected | 4.2 |
| Role-change rate limit | `10` requests per `15` minutes per authenticated administrator | 12.1 |
| Successful role change audit | Persistent, transactional audit required; commits atomically with the role change | 9.1, 10.1 |
| Denied role-change attempts | Sanitized security diagnostics only; persistent failure event deferred | 10.4 |
| Audit persistence failure | Preserve existing fail-closed behavior; transient error-label improvement deferred | 9.6 |
| Shared guard | Collection `systemLocks`, `_id: "user-role-change"`, integer `version` field | 9.2, 17.2 |
| No-op / rejection control flow | Dedicated sentinel error thrown to force an abort; the wrapper maps it to `200` no-op or `409`; returning a normal callback result after an explicit abort is forbidden | 9.4.1 |

### 18.2 Remaining Unresolved Decisions and Outstanding Approvals

Blocking prerequisite:

1. **Database topology and transaction support (blocking).** The actual cluster
   topology must be confirmed to be a replica set or sharded cluster before the
   feature is enabled. Atlas membership is not proof (Sections 11.2 and 16).

Separately authorized decisions — none is granted by approving this document;
each requires its own explicit decision:

2. Whether the `AuditLog` schema extension (`previousRole`/`newRole`) is
   approved; if not, the audit event cannot record the role transition and
   Section 10.1 cannot be satisfied as written (Sections 10.2 and 17.3).
3. Approval of the guard collection, its document shape, and its one-time
   initialization (Section 17.2).
4. The exact first-administrator provisioning method and its authorization gate
   (Section 14).

Minor remaining decision:

5. Whether to emit a console `auditLog(...)` line in addition to the persistent
   success event (dual trail) or to persist only (Section 10.4).

Deferred to a future version:

6. Directory search and role filtering (Section 4.2).
7. Persistent `USER_ROLE_CHANGE_FAILED` failure events (Section 10.4).
8. Preserving MongoDB transient-error labels across the sanitized audit re-wrap so
   the wrapper can retry an audit-insert failure automatically (Section 9.6).

The earlier open question about whether the acting administrator's admin status
is re-verified inside the transaction is now **resolved**: it **is** revalidated
inside the transaction, with the session (Sections 9.1 and 11.2), and is no
longer discretionary.

---

## 19. Compatibility

This feature must not change:

- Registration behavior, including that public registration cannot assign a
  privileged role.
- Login behavior and the existing JWT structure and one-hour expiry.
- `authenticate` and `authorizeRoles` behavior for existing routes.
- `GET /api/auth/me`, profile, and change-password behavior.
- Password Reset V1 behavior.
- Reporting permissions, including shared IT staff access: `staff` and `admin`
  continue to share the review queue, review detail, messaging, claim, priority,
  start, and complete routes, and `admin` continues to hold the assignment and
  assignee-candidate routes. This feature adds no reporting permission and
  removes none.
- Research Analytics and its admin-only authorization.
- The deployment topology: the React frontend and Express API remain on their
  existing Render services, the API keeps using the existing MongoDB Atlas
  connection, and GitHub `main` continues to trigger automatic Render
  deployment. This feature changes no Render service or configuration, no
  environment variable, and no build or start command (Section 16).
- Any other feature's routes, responses, or page behavior.

---

## 20. Limitations

- The bootstrap of the first administrator is manual and outside the
  application audit trail; only subsequent changes are audited.
- A role change signs the target out of existing sessions via `tokenVersion`;
  there is no separate "you were demoted" notification.
- There is no role-change history viewer; the audit trail is reviewed through
  other means.
- The directory has no search and no role filter in V1 (deferred, Section 18);
  administrators navigate the deterministic ascending-`_id` ordering instead.
- Role-change requests are rate limited to `10` requests per `15` minutes per
  authenticated administrator (Section 12.1); exceeding the limit returns `429`.
- Denied role-change attempts produce transient sanitized diagnostics only. There
  is no persistent failure-event record for denied attempts in V1
  (Section 10.4).
- The guard document serializes role changes and adds a small contention cost;
  this is intentional and acceptable for the expected low volume.
- The guard document must be initialized out of band, by a separately authorized
  one-time step, before the feature is enabled (Section 17.2); until then the
  feature fails closed.
- Audit persistence failures are fail-closed: a failed audit write aborts the
  role change (Section 9.6). A transient error during the audit insert may not be
  retried automatically because the sanitized `AuditServiceError` can lose
  MongoDB's transient label; V1 accepts the abort over any partial write.
- If the database topology does not support transactions, the feature cannot be
  enabled at all; this is a hard limitation, not a tunable.

---

## 21. V1 Completion Criteria

User Role Management V1 is complete when:

- Only an authenticated, active administrator can use the feature.
- A paginated user directory returns only the minimal field set and never
  leaks credential or reset state.
- The directory uses the finalized V1 pagination and ordering: `page` default
  `1`, `pageSize` default `20` with hard maximum `100` (above `100` rejected with
  `400`), deterministic ascending `_id` ordering, no search or role filter, and
  `email` present only in the administrator-only response (Sections 4.2 and 4.3).
- An administrator can change an existing active user among `user`, `staff`,
  and `admin`.
- Self-demotion is rejected with `409 Conflict`; unknown or inactive targets are
  rejected with `404` (Sections 5.5 and 6).
- Role-change requests are rate limited to `10` requests per `15` minutes per
  authenticated administrator (Section 12.1).
- The last active administrator cannot be removed, including under concurrent
  requests, enforced with a shared database guard document that exists before
  role changes are enabled and whose absence fails closed (Sections 9.2 and
  17.2).
- `tokenVersion` is incremented exactly when the role changes, invalidating
  existing JWTs.
- An already-assigned role returns success without modifying data, and the
  in-transaction no-op and conflict outcomes are produced by the explicit
  sentinel-abort mechanism of Section 9.4.1 (verified offline and against a
  disposable replica set), never by returning a normal callback result after an
  explicit abort.
- The role change and its audit record commit atomically in one transaction,
  opened with `writeConcern: { w: "majority" }` (Section 9.3).
- Every MongoDB read and write in the transaction callback — actor
  revalidation, target lookup, guard update, last-admin count, conditional role
  update, and audit insert — uses the same session, and callback errors are never
  swallowed (Section 9.1).
- Audit persistence failures are fail-closed: the role update cannot commit
  without its audit record (Section 9.6), and this V1 behavior is preserved
  unchanged.
- Denied role-change attempts emit only sanitized security diagnostics and write
  no persistent failure event (Section 10.4).
- The audit event records the actor, target, previous role, and new role, with
  the supporting `AuditLog` extension approved and implemented.
- Mongoose session and transaction behavior has been verified and documented
  (Section 11.2), the audit service uses the required
  `create([document], { session })` array form with offline regression coverage
  (Section 11.1), and every transaction operation passes the same session
  (Section 9.1).
- The API is administrator-only and the frontend provides an administrator-only
  management page with safe states and no sensitive data exposure.
- Existing reporting permissions, including shared IT staff access, are
  unchanged.
- A separately authorized, documented method exists to provision the first real
  administrator, without reviving `setupTestRoles.js` or using test fixtures.
- Offline regression tests, rollback/atomicity tests, concurrency tests, and the
  separately authorized disposable-replica-set integration tests (transaction
  rollback, atomicity, and concurrent last-administrator protection;
  Section 15.4) are defined and pass within their authorized scope.
- No Render service or configuration is changed without explicit authorization,
  and transaction support has been verified rather than assumed.
