# Report Email Notifications V1 Specification

## 1. Purpose

Report Email Notifications V1 provides best-effort transactional email notifications to the student who submitted a PhishGuard report when school IT staff take one of two authoritative actions on that report:

- **IT sends a message** to the student on the report.
- **IT completes** the student's report.

The feature reuses the existing Brevo transactional-mail infrastructure already proven by Password Reset V1. It introduces no new endpoints, no new request/response fields, no new environment variables, and no new email provider.

The reporting operation is authoritative. Email is a secondary best-effort side effect attempted only after the corresponding database write has succeeded.

---

## 2. Scope

### 2.1 Included in V1

- Email notification to the report owner when IT staff/admin successfully sends a message on a report.
- Email notification to the report owner when IT staff/admin successfully completes a report.
- Server-side recipient resolution from the report ownership relationship.
- Safe, static email templates with minimal allowed interpolation.
- Best-effort delivery with bounded timeout, no retries, no queue.
- Sanitized, request-independent observability for notification success and failure.
- Full test coverage through dependency injection and existing Node test patterns.

### 2.2 Not Included in V1

See Section 15 for the complete out-of-scope list.

---

## 3. Trigger / Non-Trigger Matrix

### 3.1 Triggers

| # | Trigger | Existing Operation | HTTP Endpoint | Notification Type |
|---|---------|-------------------|---------------|-------------------|
| A | IT staff/admin successfully sends a message to the student on a report | `createReviewReportMessage` | `POST /api/reports/review/:reportId/messages` | `message` |
| B | IT staff/admin successfully completes a student's report | `completeReviewReport` | `PATCH /api/reports/review/:reportId/complete` | `completion` |

**Timing:** The email attempt occurs only after the corresponding authoritative database write has been confirmed successful (the mongoose document has been created/updated and the service function is about to return).

### 3.2 Non-Triggers

The following actions must **NOT** trigger any email notification:

| Action | HTTP Endpoint | Reason |
|--------|---------------|--------|
| Student creates a report | `POST /api/reports` | Out of scope — new-report-to-IT email is explicitly excluded |
| Student sends a message on their own report | `POST /api/reports/:reportId/messages` | Out of scope — student is the actor, not IT |
| IT claims a report | `PATCH /api/reports/review/:reportId/claim` | Out of scope |
| IT assigns/reassigns a report | `PATCH /api/reports/review/:reportId/assignment` | Out of scope |
| IT changes priority | `PATCH /api/reports/review/:reportId/priority` | Out of scope |
| IT starts review | `PATCH /api/reports/review/:reportId/start` | Out of scope |
| Any GET/read operation | Various | Read-only, no notification |
| Any authentication or account operation | Various | Unrelated |

---

## 4. Recipient Resolution

### 4.1 Rules

1. **Server-side only.** The recipient is resolved from the `Report.user` ObjectId reference to the `User` document's `email` field.
2. **No client-supplied recipient.** The notification service accepts only `reportId` and `type`. There is no `email`, `recipient`, or `to` parameter. The client cannot control the recipient through request body, query, or path.
3. **Actual report owner.** The recipient is always the user who submitted the report (`Report.user`), never the IT staff member performing the action.
4. **Owner must exist.** If the `Report.user` reference cannot be resolved to a User document, the notification is skipped.
5. **Owner must be active.** If the owner User has `isActive: false`, the notification is skipped.
6. **Owner email must be valid.** The resolved email must satisfy the existing safe email-shape validation (`EMAIL_SHAPE_PATTERN` in `mail.service.js`).
7. **No email in API responses.** The notification service returns only a sanitized outcome object. The recipient email is never exposed in any API response.

### 4.2 Resolution Flow

```
reportId
  → Report.findById(reportId).select("user")
  → user ObjectId
  → User.findById(user).select("email isActive")
  → { email, isActive }
  → validate email shape
  → send or skip with fixed reason code
```

### 4.3 Skip Behavior

If the owner is missing, inactive, or has an invalid email, the notification is skipped without affecting the report operation. The skip is logged with the appropriate fixed reason code (see Section 10).

---

## 5. Email Content Contract

### 5.1 Message Notification (Trigger A)

**Subject:**
```
New message on your PhishGuard report
```

**Body (plain text):**
```
Hello,

A PhishGuard staff member has sent a new message on your report <ticketNumber>.

Sign in to PhishGuard to view the message and respond if needed.

<CLIENT_URL>

Automated message from PhishGuard. Please do not reply.
```

### 5.2 Completion Notification (Trigger B)

**Subject:**
```
Your PhishGuard report has been completed
```

**Body (plain text):**
```
Hello,

Your PhishGuard report <ticketNumber> has been completed by the IT team.

Sign in to PhishGuard to view the completed report.

<CLIENT_URL>

Automated message from PhishGuard. Please do not reply.
```

### 5.3 Allowed Data Elements

The following values may appear in the email subject or body:

| Element | Source | Notes |
|---------|--------|-------|
| PhishGuard branding | Static text | "PhishGuard" in greeting and footer |
| Generic notification statement | Static text | "A PhishGuard staff member has sent a new message" or "has been completed by the IT team" |
| Ticket number | `Report.ticketNumber` | Human-facing identifier (e.g., `PG-2026-000123`), already shown in the UI |
| Sign-in instruction | Static text | "Sign in to PhishGuard to view..." |
| `CLIENT_URL` | Environment variable | Frontend URL for the sign-in link |
| Automated/no-reply wording | Static text | "Automated message from PhishGuard. Please do not reply." |

### 5.4 Template Construction

Templates are constructed from **static text** with only the explicitly allowed values interpolated. No report message content, assessment, reviewer note, URL data, or other dynamic report fields flow into the template. The interpolation points are:

- `<ticketNumber>` — replaced with `Report.ticketNumber`
- `<CLIENT_URL>` — replaced with the configured `CLIENT_URL` value

### 5.5 Completion Notification Restriction

The completion notification must **NOT** mention whether a reviewer note exists. The body uses the fixed instruction: "Sign in to PhishGuard to view the completed report."

---

## 6. Privacy / Security Restrictions

### 6.1 Forbidden Email Data

The following must **NEVER** appear in the email subject or body:

| Forbidden Data | Source |
|----------------|--------|
| Suspicious/analyzed URL | `Report.analysisSnapshot.url` |
| Automated risk score or indicators | `Report.analysisSnapshot.risk`, `.score`, `.indicators` |
| Report reason | `Report.reason` |
| Report details/free text | `Report.details` |
| Reviewer note | `Report.reviewerNote` |
| Human assessment value | `Report.assessment` |
| Report-message contents | `ReportMessage.message` |
| Sender/student/staff names | `User.name` |
| Internal MongoDB ObjectIds | `Report._id`, `User._id`, `ReportMessage._id`, etc. |
| Passwords / password hashes | `User.password` |
| JWT / auth tokens | `req.headers.authorization` |
| Reset-token state | `User.passwordResetTokenHash`, `User.passwordResetExpiresAt` |
| Authorization headers | `req.headers` |
| Provider credentials | `BREVO_API_KEY` |
| Arbitrary client-supplied content | Any request body/query/path value |

### 6.2 Enforcement

The email body is a static template string. The only interpolation is `ticketNumber` and `CLIENT_URL`, both of which are safe. No code path exists for report message content, assessment, reviewer note, or URL data to reach the template.

### 6.3 Forbidden Log/Audit Data

The following must **NEVER** appear in logs or audit entries:

- Recipient email address
- Email subject or body
- Suspicious URL / report evidence
- Reviewer note / assessment
- Authorization header values
- `BREVO_API_KEY`
- Passwords / tokens / reset state
- Provider response body
- Exception stack/message containing provider or internal data

---

## 7. Delivery / Failure Semantics

### 7.1 Core Principle

The reporting operation is authoritative. Email is a best-effort secondary behavior.

### 7.2 Behavior Matrix

| Scenario | Report Operation | API Response | Email | Observability |
|----------|-----------------|--------------|-------|---------------|
| Mail success | Succeeds | 200/201 success (unchanged) | Sent | `REPORT_NOTIFICATION_SENT` |
| Mail failure (network, Brevo 5xx, timeout) | Succeeds | 200/201 success (identical) | Not sent | `REPORT_NOTIFICATION_FAILED` |
| Mail not configured | Succeeds | 200/201 success (identical) | Not attempted | `REPORT_NOTIFICATION_FAILED` |
| Owner not found | Succeeds | 200/201 success (identical) | Not attempted | `REPORT_NOTIFICATION_FAILED` |
| Owner inactive | Succeeds | 200/201 success (identical) | Not attempted | `REPORT_NOTIFICATION_FAILED` |
| Owner email invalid | Succeeds | 200/201 success (identical) | Not attempted | `REPORT_NOTIFICATION_FAILED` |

### 7.3 Rules

1. **No rollback.** Email failure never rolls back the report message or completion. The database write is already committed before email is attempted.
2. **No error propagation.** The notification service catches all errors internally. The reporting service awaits the notification call but ignores its result.
3. **No response difference.** The API response is byte-identical whether email succeeds, fails, or is skipped.
4. **Await with catch.** The notification is awaited (not fire-and-forget) to guarantee a clear audit trail. The existing bounded mail timeout (10 seconds) limits the additional latency.
5. **No retries.** V1 does not retry failed sends. A single attempt is made.
6. **No queue.** V1 does not introduce a background job or queue system.
7. **No durable delivery guarantee.** V1 does not guarantee delivery beyond the single attempted send.

### 7.4 Timeout

The existing `MAIL_REQUEST_TIMEOUT_MS` (10 seconds) from `mail.service.js` applies. The email send uses `AbortSignal.timeout`.

---

## 8. Mail Architecture / Reuse

### 8.1 Current State

`apps/api/src/services/mail.service.js` exports `sendPasswordResetEmail`, which is password-reset-specific:
- Hardcoded subject: `"Reset your PhishGuard password"`
- Hardcoded body builder: `buildPasswordResetEmailText`
- Hardcoded URL validation in `assertSendInput`

### 8.2 Proposed Refactor (Minimal, Non-Breaking)

**Step 1:** Add a generic `sendTransactionalEmail(...)` primitive to `mail.service.js`:

```
sendTransactionalEmail({ recipient, subject, textContent, config, fetchImpl, timeoutMs })
```

This function contains the core Brevo API call logic currently embedded in `sendPasswordResetEmail`. It accepts caller-provided `subject` and `textContent` instead of hardcoded values. It uses the same Brevo endpoint, headers, timeout, and error handling.

**Step 2:** Preserve `sendPasswordResetEmail(...)` as the Password Reset-specific wrapper. It calls `sendTransactionalEmail` with the existing subject and body. The external behavior is identical — same Brevo payload, same validation, same error codes, same return value.

**Step 3:** The new `reportNotification.service.js` calls `sendTransactionalEmail` directly with its own subject and body.

### 8.3 Why This Approach

- **Minimal refactoring:** One new function added to `mail.service.js`; `sendPasswordResetEmail` becomes a thin wrapper.
- **No destabilization:** The password-reset code path is preserved exactly. All existing password-reset tests continue to pass.
- **Consistent infrastructure:** Both features use the same Brevo endpoint, config resolution, timeout, and error handling.
- **No new provider:** Reuses the existing Brevo integration.

### 8.4 Alternative Considered and Rejected

Creating a separate `reportNotification.mail.js` that duplicates the Brevo call logic. Rejected because it duplicates the fetch/timeout/error-handling code and creates two places to maintain.

---

## 9. Reporting Integration Points

### 9.1 Trigger A: IT Sends a Message

**File:** `apps/api/src/services/reporting.service.js`
**Function:** `createReviewReportMessage`

**Current flow:**
```
findReportState → validate status → ReportMessage.create → getPopulatedMessage → return DTO
```

**Proposed flow:**
```
findReportState → validate status → ReportMessage.create → getPopulatedMessage → return DTO
                                                                        ↓
                                                         notifyReportOwner({ reportId, type: "message" })
                                                         [awaited, result ignored]
```

The notification call is placed after `ReportMessage.create()` succeeds and before the return. The `reportId` is already available in the function parameters.

### 9.2 Trigger B: IT Completes a Report

**File:** `apps/api/src/services/reporting.service.js`
**Function:** `completeReviewReport`

**Current flow:**
```
validate → findReportState → runConditionalReportUpdate → return DTO
```

**Proposed flow:**
```
validate → findReportState → runConditionalReportUpdate → return DTO
                                                    ↓
                                     notifyReportOwner({ reportId, type: "completion" })
                                     [awaited, result ignored]
```

The notification call is placed after `runConditionalReportUpdate` succeeds. The `reportId` is already available.

### 9.3 Why the Service Layer

- The service is where persistence happens, guaranteeing email is attempted only after the write succeeds.
- The controller is a thin HTTP layer; putting business logic there violates the existing architecture.
- The service already has access to `deps.User` for recipient resolution via the existing `resolveDependencies` pattern.
- The existing dependency injection pattern allows clean test injection.

### 9.4 Dependency Injection

The notification service is injected into the reporting service through the existing `resolveDependencies` / `options` pattern. This preserves testability: tests can inject a mock notification service that records calls without sending real emails.

---

## 10. Safe Observability Contract

### 10.1 Notification Service Outcome

`notifyReportOwner(...)` returns a sanitized outcome object. It is HTTP-independent and never throws.

**Success:**
```json
{ "sent": true }
```

**Failure / Skip:**
```json
{
  "sent": false,
  "reason": "<fixed reason code>"
}
```

### 10.2 Fixed Failure Reason Codes

| Code | Meaning |
|------|---------|
| `not_configured` | `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, or `MAIL_FROM_NAME` is missing or invalid |
| `owner_not_found` | The `Report.user` reference resolves to no User document |
| `owner_inactive` | The owner User has `isActive: false` |
| `owner_email_invalid` | The resolved email fails the existing email-shape validation |
| `delivery_failed` | Brevo API returned non-201, network error, or timeout |

### 10.3 What the Notification Service Never Returns

The notification service must never return:
- Recipient email address
- Provider response body
- API key or config values
- Email subject or body
- Report evidence (URL, assessment, reviewer note, message content)
- Exception stack or message containing provider/internal data

### 10.4 Request-Independent Observability

The notification domain/mail service must remain **HTTP-independent**. It must not depend on an Express `req` object.

For V1, notification delivery observability uses a **request-independent safe structured log/helper** rather than passing Express `req` into the notification service.

**Preferred events:**
- `REPORT_NOTIFICATION_SENT`
- `REPORT_NOTIFICATION_FAILED`

**Safe fields:**
- `reportId` — only if represented as the existing internal report identifier already used safely in server logs
- `notificationType` — `message` or `completion`
- `reason` — fixed failure reason code (for failures only)

**Never logged:**
- Recipient email
- Message content
- Email body/subject
- Suspicious URL / report evidence
- Reviewer note / assessment
- Authorization header
- `BREVO_API_KEY`
- Passwords / tokens / reset state

### 10.5 Implementation Note

If the current codebase does not already have a suitable request-independent audit helper, the implementation should specify a tiny dedicated safe notification logger as an implementation detail rather than forcing the existing `req`-based `auditLog` abstraction into the domain service. This helper is **not** created during the specification stage.

### 10.6 Sender Config Note

`MAIL_FROM_EMAIL` and `MAIL_FROM_NAME` should not deliberately be logged. However, their mere appearance in a log line is **not** equivalent to leaking `BREVO_API_KEY` or recipient/report evidence. Tests should specifically enforce absence of:

- `BREVO_API_KEY`
- Recipient email
- Authorization values
- Passwords / tokens / reset state
- Report/message/reviewer evidence
- Provider response / internal exception detail where unsafe

---

## 11. Environment / Configuration

### 11.1 Existing Variables (Sufficient)

| Variable | Purpose | Already in `.env.example` |
|----------|---------|---------------------------|
| `BREVO_API_KEY` | Brevo API authentication | Yes |
| `MAIL_FROM_EMAIL` | Sender email address | Yes |
| `MAIL_FROM_NAME` | Sender display name | Yes |
| `CLIENT_URL` | Frontend URL for email link | Yes |

### 11.2 No New Environment Variables

All existing configuration is sufficient. No new environment variables are introduced.

### 11.3 Configuration Validation

The existing `resolveMailConfig(env)` in `mail.service.js` validates all three mail variables. The notification service calls this before attempting to send. If validation throws `MailServiceError` with code `MAIL_NOT_CONFIGURED`, the notification is skipped and logged with reason `not_configured`.

### 11.4 CLIENT_URL Usage

`CLIENT_URL` is used as the base for the "sign in" link in the email body. No token or sensitive path is appended. The value is interpolated directly into the static template.

---

## 12. Duplicate / Idempotency Semantics

### 12.1 Completion Notification (Trigger B)

**At most one notification attempt per report.** The `runConditionalReportUpdate` filter includes `status: { $in: UNFINISHED_STATUSES }`. Only the first completion attempt succeeds; subsequent attempts receive `REPORTING_CONFLICT` (409) and never reach the notification call. Therefore, successful completion causes at most one notification attempt through the application workflow. V1 does not claim exactly-once email delivery: provider/network ambiguity means application-observed delivery state is not equivalent to guaranteed mailbox delivery.

### 12.2 Message Notification (Trigger A)

**Not idempotent by design.** Each `createReviewReportMessage` call creates a distinct `ReportMessage` document and triggers one notification. If IT sends the same message twice (or a network retry causes a duplicate POST), two emails are sent. This is accepted V1 behavior because:

- Each message is a distinct user-facing event.
- The existing message-creation endpoint has no idempotency key (existing behavior, not introduced by notifications).
- V1 does not require deduplication infrastructure.

### 12.3 HTTP-Level Retry

If a client retries `POST /api/reports/review/:reportId/messages` due to a network timeout:
- The first attempt may have succeeded (message persisted, email sent).
- The retry creates a second message and sends a second email.
- This is existing behavior for message duplication; notifications do not make it worse.

If a client retries `PATCH /api/reports/review/:reportId/complete`:
- The first attempt succeeds (report completed, email sent).
- The retry receives 409 CONFLICT (report already completed).
- No second email is sent.

### 12.4 Conclusion

No additional deduplication is necessary for V1. The completion path allows at most one notification attempt per report. The message path follows existing message-creation semantics.

---

## 13. API Compatibility

### 13.1 No API Changes

This feature introduces:
- **No new endpoints**
- **No new request fields**
- **No new response fields**
- **No changed response shapes**
- **No changed status codes**
- **No changed error messages**

### 13.2 External Identity Preserved

The API contract for all existing endpoints remains byte-identical. Email notification is a pure side effect. Existing reporting API behavior must remain externally identical apart from the email side effect.

---

## 14. Testing Requirements

### 14.1 Test Contract

Tests must cover at minimum:

| # | Test | What It Verifies |
|---|------|-----------------|
| 1 | IT message success triggers one message notification attempt after persistence | `notifyReportOwner` is called with `type: "message"` after `ReportMessage.create` succeeds |
| 2 | Completion success triggers one completion notification attempt after persistence | `notifyReportOwner` is called with `type: "completion"` after `runConditionalReportUpdate` succeeds |
| 3 | Recipient resolves from report owner server-side | The `recipient` in the Brevo payload equals the owner's email from the database |
| 4 | Client cannot control recipient | The notification service accepts only `reportId` and `type`; no email parameter exists |
| 5 | Excluded report actions trigger no email | `claimReviewReport`, `assignReviewReport`, `updateReviewReportPriority`, `startReviewReport`, `createOwnReportMessage` do not call the notification service |
| 6 | Correct static subject/body and allowed interpolation only | Subject and body match the frozen templates with only `ticketNumber` and `CLIENT_URL` interpolated |
| 7 | Suspicious URL absent from mail payload | `analysisSnapshot.url` does not appear in the Brevo payload |
| 8 | Report reason/details absent | `Report.reason` and `Report.details` do not appear in the Brevo payload |
| 9 | Reviewer note/assessment absent | `Report.reviewerNote` and `Report.assessment` do not appear in the Brevo payload |
| 10 | Report-message body absent | `ReportMessage.message` does not appear in the Brevo payload |
| 11 | Internal ObjectIds absent from email | No MongoDB ObjectId values appear in the email subject or body |
| 12 | Owner missing → skipped safely | When `Report.user` resolves to no User document, no email is sent; outcome is `{ sent: false, reason: "owner_not_found" }` |
| 13 | Owner inactive → skipped safely | When owner has `isActive: false`, no email is sent; outcome is `{ sent: false, reason: "owner_inactive" }` |
| 14 | Invalid owner email → skipped safely | When resolved email fails shape validation, no email is sent; outcome is `{ sent: false, reason: "owner_email_invalid" }` |
| 15 | Missing/invalid mail configuration → skipped safely | When `resolveMailConfig` throws, no email is sent; outcome is `{ sent: false, reason: "not_configured" }`; no Brevo API call is made |
| 16 | Brevo/network/provider failure → reporting operation still succeeds unchanged | When `sendTransactionalEmail` throws, the notification service catches it, returns `{ sent: false, reason: "delivery_failed" }`, and the reporting service still returns its normal DTO with identical status |
| 17 | Notification outcome contains only sanitized fields | The return value contains only `sent` and optionally `reason`; no email, config, or report data |
| 18 | Safe notification observability contains no sensitive content | Captured log output does not contain recipient email, `BREVO_API_KEY`, Authorization values, passwords/tokens, or report evidence |
| 19 | Completion retry/conflict sends no duplicate completion notification | A second `completeReviewReport` on an already-completed report receives CONFLICT and does not trigger a second notification |
| 20 | Two successful IT message creations may produce two notifications | Two `createReviewReportMessage` calls produce two notification attempts, matching existing semantics |
| 21 | Password Reset mail behavior/regression tests remain unchanged after mail.service refactor | All existing `passwordReset.stage4.test.js` tests pass unchanged |
| 22 | Existing Reporting V1 regressions remain passing | All existing reporting tests (`reporting.stage1.test.js` through `reporting.integration.test.js`) pass unchanged |

### 14.2 Test Infrastructure

- Use the existing `createFetchStub` pattern from `passwordReset.stage4.test.js` to mock Brevo API responses.
- Use the existing `captureConsole` pattern to verify no sensitive data leaks into logs.
- Use the existing `createReportingController` and `createReportingRouter` factory patterns for dependency injection.
- Tests run with `node --test` (existing convention).
- No new component/integration framework is required; the current Node test architecture covers all cases through dependency injection and existing patterns.

---

## 15. Out of Scope

The following are explicitly **NOT** part of Report Email Notifications V1:

| Excluded | Notes |
|----------|-------|
| New-report → IT email | Students creating a report does not notify IT |
| IT mailbox configuration | No configurable school IT mailbox |
| Emailing all staff/admin | Only the report owner is notified |
| Notification preferences | No user-configurable notification settings |
| In-app notifications | No in-app notification system |
| SMS / push | No SMS or push notification channel |
| Attachments | No email attachments |
| Email replies | No reply-to or reply handling |
| Rich HTML email | Plain-text only |
| Queue / background jobs | No queue or worker system |
| Durable retries | No retry mechanism |
| Delivery tracking / read receipts | No delivery or read tracking |
| Idempotency keys / deduplication infrastructure | No deduplication for message notifications |
| New database collection | No new MongoDB collections |
| New email provider | Reuses existing Brevo integration |

---

## 16. Implementation Stages

### Stage 1: Generic Transactional-Mail Primitive + Password Reset Regression Protection

**Objective:** Add `sendTransactionalEmail(...)` to `mail.service.js` and refactor `sendPasswordResetEmail` to use it, with zero external behavior change.

**Changes:**
- `apps/api/src/services/mail.service.js`: Extract generic `sendTransactionalEmail` function; refactor `sendPasswordResetEmail` to call it.

**Verification:**
- All existing `passwordReset.stage4.test.js` tests pass unchanged.
- The Brevo payload for password reset is byte-identical before and after the refactor.

### Stage 2: Report Notification Domain Service + Recipient/Content/Security Tests

**Objective:** Create `reportNotification.service.js` with recipient resolution, safe templates, and sanitized outcome. Stage 2 does **not** wire the notification into `reporting.service.js`; it tests the domain service in isolation.

**Changes:**
- `apps/api/src/services/reportNotification.service.js`: New file with `notifyReportOwner(...)`.
- `apps/api/test/reportNotification.service.test.js`: New test file covering domain-service tests 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18 from Section 14. These cover recipient resolution, no client-controlled recipient, static subject/body, allowed interpolation only, forbidden report/message/security data absent, owner missing/inactive/invalid-email skips, missing/invalid configuration, mail delivery failure sanitization, sanitized outcomes, and safe request-independent observability.

**Verification:**
- All new domain unit tests pass.
- No sensitive data appears in logs or outcomes.

### Stage 3: Reporting-Service Integration + Notification/Reporting Regressions

**Objective:** Wire `notifyReportOwner` into `createReviewReportMessage` and `completeReviewReport` after persistence, and verify the reporting workflow triggers notifications correctly.

**Changes:**
- `apps/api/src/services/reporting.service.js`: Add notification calls in the two trigger functions.
- `apps/api/test/reporting.notification.integration.test.js`: New integration test file covering tests 1, 2, 5, 16, 19, 20, 22 from Section 14. These cover: successful IT message persistence triggers one notification attempt; successful completion persistence triggers one notification attempt; excluded reporting actions trigger no notification; completion conflict/retry triggers no second attempt; two successful IT message creations produce two attempts; reporting API remains unchanged when mail fails; existing Reporting V1 regressions.

**Verification:**
- All new integration tests pass.
- All existing reporting tests pass unchanged.
- All existing password-reset tests pass unchanged.

### Stage 4: Local E2E, Deployment, Production Verification

**Objective:** Verify the feature end-to-end with real Brevo delivery and in the deployed environment.

**Steps:**
1. Local E2E: Send a real IT message and complete a real report; verify emails arrive in the test inbox.
2. Verify email content matches the frozen templates.
3. Verify no sensitive data appears in server logs.
4. Deploy to production with valid `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, `CLIENT_URL`.
5. Verify production email delivery.
6. Verify production logs contain only safe observability fields.

---

## 17. Acceptance Criteria

Report Email Notifications V1 is complete when:

1. **Trigger A works:** IT sending a message on a report sends exactly one email to the report owner after the message is persisted.
2. **Trigger B works:** IT completing a report causes at most one notification attempt to the report owner after the completion is persisted.
3. **Recipient is correct:** The email recipient is always the report owner, resolved server-side. No client-controlled recipient exists.
4. **Content is safe:** Email subject and body match the frozen templates. No forbidden data appears in the email.
5. **Delivery failure is safe:** A Brevo/network/provider failure does not affect the reporting API response. The report operation succeeds unchanged.
6. **No API changes:** All existing reporting endpoints return identical responses (apart from the email side effect).
7. **No new configuration:** No new environment variables are required.
8. **Password Reset intact:** All password-reset tests pass unchanged after the mail service refactor.
9. **Reporting regressions intact:** All existing reporting tests pass unchanged.
10. **Observability is safe:** Notification logs contain only `reportId`, `notificationType`, and fixed `reason` codes. No sensitive data is logged.
11. **Idempotency is correct:** Completion notification attempts are naturally limited to at most one per report. Message notifications follow existing message-creation semantics.
12. **Tests pass:** All tests listed in Section 14 pass.
