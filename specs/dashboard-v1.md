# Dashboard V1 Specification

## 1. Purpose

Dashboard V1 adds a concise application overview to the existing protected PhishGuard Dashboard. It connects the user's latest Awareness Assessment result, latest Phishing Identification Assessment result, current Training Exposure progress, total owned URL analyses, and a small recent-analysis preview.

The overview is a read-only presentation of data that is already authoritative in the existing assessment, training, and analysis features. It must not create a new source of truth.

## 2. Approved V1 Scope

Dashboard V1 must:

- keep `/dashboard` as the existing Scanner and Analysis History page;
- add the overview above the existing scanner and history functionality;
- preserve all current URL analysis create, list, status-update, and delete behavior;
- provide one authenticated backend summary endpoint;
- use only the authenticated user's own data;
- return at most five recent analyses;
- reuse existing Training Exposure business logic;
- represent missing assessment attempts as `null`;
- preserve a completed assessment score of `0` as a completed result;
- provide quick actions to existing feature routes and Dashboard sections;
- provide accessible loading, empty, error, and expired-session states.

Dashboard V1 does not move Scanner or History to new frontend routes and does not perform a major frontend redesign.

## 3. Architecture

The backend follows the existing MERN structure:

```text
React /dashboard
  -> GET /api/dashboard/summary
  -> Express route
  -> authenticate middleware
  -> Dashboard controller
  -> Dashboard service
  -> existing domain services
  -> Mongoose models
  -> MongoDB
```

The Dashboard service must orchestrate existing domain behavior rather than call controller functions, duplicate scoring rules, or independently calculate authoritative metrics.

The following existing behavior should be reused:

- `authenticate` from `apps/api/src/middleware/auth.middleware.js`;
- owner-scoped latest Assessment lookup and serialization;
- `getTrainingProgressForUser(userId)` from `apps/api/src/services/training.service.js`;
- owner-scoped Analysis count and recent-list query logic.

Where latest Assessment lookup or Analysis history lookup is currently embedded in a controller, implementation may extract that behavior into the corresponding domain service while preserving every existing external API contract.

Dashboard V1 must not add a Dashboard Mongoose model or MongoDB collection. It must not persist copied scores, aggregate values, cached summaries, or other duplicated Dashboard data.

## 4. Endpoint and Authentication

### Endpoint

```http
GET /api/dashboard/summary
```

### Authentication

Every request must include a valid existing PhishGuard Bearer JWT:

```http
Authorization: Bearer <token>
```

The existing authentication middleware sets:

```js
req.user = {
  userId: decoded.userId,
  role: decoded.role
};
```

The Dashboard controller and service must use `req.user.userId` exclusively as the ownership identity.

The endpoint has no supported request body, path parameters, or query parameters. In particular, it must never accept, read, or trust a client-supplied `userId`.

All currently supported authenticated roles may retrieve their own normal Dashboard summary. Dashboard V1 must not add Staff- or Admin-specific metrics, cross-user access, or administrative functionality.

## 5. Exact Success Response

A successful request returns HTTP `200` with this exact top-level structure:

```json
{
  "success": true,
  "latestAwarenessAssessment": {
    "id": "ObjectId string",
    "rawScore": 8,
    "score": 80,
    "totalQuestions": 10,
    "completedAt": "ISO-8601 date string"
  },
  "latestPhishingIdentificationAssessment": {
    "id": "ObjectId string",
    "rawScore": 8,
    "score": 80,
    "totalScenarios": 10,
    "completedAt": "ISO-8601 date string"
  },
  "trainingProgress": {
    "completedModules": 2,
    "totalModules": 3,
    "trainingExposure": 66.67
  },
  "urlAnalyses": {
    "total": 7,
    "recent": [
      {
        "id": "ObjectId string",
        "url": "https://example.org/login",
        "risk": "medium",
        "score": 30,
        "status": "active",
        "createdAt": "ISO-8601 date string"
      }
    ]
  }
}
```

Contract requirements:

- `success` is always `true` on HTTP `200`.
- ObjectIds are serialized as strings.
- dates are serialized as ISO-8601 date strings.
- `latestAwarenessAssessment` is either the sanitized assessment result object or `null`.
- `latestPhishingIdentificationAssessment` is either the sanitized assessment result object or `null`.
- `trainingProgress` always contains `completedModules`, `totalModules`, and `trainingExposure`.
- `urlAnalyses.total` is always a non-negative integer.
- `urlAnalyses.recent` is always an array and contains no more than five items.
- each recent Analysis contains only `id`, `url`, `risk`, `score`, `status`, and `createdAt`.
- no additional top-level or nested Dashboard fields are required by V1.

The Assessment and Analysis uses of `score` are namespaced by their parent objects:

- a higher Assessment score means more correct answers;
- a higher Analysis score means more suspicious heuristic indicators.

The Dashboard must not visually or semantically imply that these scores have the same meaning.

## 6. Latest Assessment Semantics

### Selection

Each latest Assessment must be selected using the authenticated user's identity and deterministic newest-first ordering:

```js
{ completedAt: -1, _id: -1 }
```

A user's most recent completed Awareness Assessment and most recent completed Phishing Identification Assessment are independent. One may exist while the other is `null`.

### Missing attempt

If the authenticated user has no completed attempt for a feature:

```json
{
  "latestAwarenessAssessment": null
}
```

or:

```json
{
  "latestPhishingIdentificationAssessment": null
}
```

The summary endpoint returns HTTP `200` for these ordinary empty states. It must not return `404` merely because an Assessment has not been attempted.

The frontend must render this state as **Not yet completed** or equivalent clear empty-state wording. It must never display score `0` for a missing attempt.

### Completed score of zero

A persisted completed Assessment with:

```json
{
  "rawScore": 0,
  "score": 0
}
```

is a real completed result. The summary must preserve the result object and the frontend must display `0` normally.

The distinction is:

- `null` means no completed attempt exists;
- an assessment object with `score: 0` means a completed attempt scored zero.

### Authoritative score handling

The Dashboard must return the persisted, backend-calculated Assessment result. It must not rescore answers, reconstruct the score from selected answers, or substitute a default score.

## 7. Training Progress Semantics

Training progress must be obtained by calling:

```js
getTrainingProgressForUser(userId)
```

The Dashboard must not import module totals, duplicate completion records, or recalculate Training Exposure independently.

The response uses the existing exact Training fields:

```json
{
  "completedModules": 2,
  "totalModules": 3,
  "trainingExposure": 66.67
}
```

Training zero values are real progress values:

```json
{
  "completedModules": 0,
  "totalModules": 3,
  "trainingExposure": 0
}
```

The summary does not need the full training catalog, module content, individual completion timestamps, or a next-module recommendation.

Training Exposure represents completion of the fixed PhishGuard training catalog. It must not be described as proof of competence, learning effectiveness, or a causal influence on another Dashboard metric.

## 8. URL Analysis Count and Recent Analyses

### Total count

`urlAnalyses.total` is the backend-authoritative count of all Analysis documents owned by the authenticated user.

It must:

- filter by the authenticated `req.user.userId`;
- include `active`, `reviewed`, and `archived` analyses;
- exclude deleted documents;
- exclude every other user's analyses;
- avoid frontend reconstruction from an array length.

The Dashboard should use an owner-scoped database count rather than loading the complete history to count it.

### Recent limit and ordering

`urlAnalyses.recent` contains at most five analyses.

The query must be owner-scoped and ordered deterministically:

```js
{ createdAt: -1, _id: -1 }
```

`createdAt` determines recency. `_id` is a deterministic tie-breaker for records with the same creation timestamp. Updating an Analysis status does not change its creation timestamp or Dashboard recency position.

The recent limit is fixed by Dashboard V1. It is not accepted from the client.

### Recent response fields

Each recent item must expose only:

- `id`
- `url`
- `risk`
- `score`
- `status`
- `createdAt`

The recent preview does not need indicators, owner data, `updatedAt`, `__v`, or other Mongoose-managed/internal fields.

### Existing Analysis contract

The existing `GET /api/analyze` full-history response and all existing Analysis CRUD contracts must remain compatible. The Dashboard summary must not replace or redesign those contracts.

## 9. Response Sanitization

The summary must use explicit response mapping or safe projections. It must not spread raw Mongoose documents into the response.

The response must not expose:

- the authenticated user's database ID or profile fields;
- another user's data;
- assessment `answers`;
- correct answers or answer keys;
- correctness flags or hidden scoring metadata;
- Analysis owner references;
- Analysis `indicators` in the recent preview;
- Mongoose `__v`;
- passwords, JWTs, verification codes, or other secrets;
- internal configuration or error details.

The response intentionally contains no user name, email, or role. The existing frontend may use its stored display name for a cosmetic welcome message, but stored profile or role data must not be treated as backend authorization.

## 10. Ownership and Privacy Requirements

The Dashboard summary must preserve all existing ownership boundaries:

- use only `req.user.userId` as the owner identity;
- apply the owner predicate inside every database query;
- never accept a user ID from the client;
- never expose another user's scores, completions, count, or analyses;
- never provide Staff/Admin cross-user summaries in V1;
- keep recent Analysis URLs as non-clickable frontend text;
- avoid logging summary payloads, JWTs, Assessment answers, or analyzed URLs;
- prevent shared caching of authenticated personal Dashboard data.

React must render URLs and other untrusted values as escaped text. Dashboard V1 must not use `dangerouslySetInnerHTML` for model or API data.

## 11. Read-Only Behavior

The Dashboard endpoint is read-only.

It must:

- register only authenticated `GET /api/dashboard/summary`;
- perform no create, update, delete, completion, or assessment-submission operation;
- define no Dashboard mutation route;
- not change Analysis, Assessment, Training, User, or Dashboard state;
- not persist aggregate or cached data.

A Dashboard request must not mark a training module complete, submit an assessment, analyze a URL, or update an Analysis status.

## 12. Status Codes and Error Semantics

### HTTP 200

Return HTTP `200` for a valid authenticated request, including when:

- both Assessment attempts are missing;
- no training modules are completed;
- no URL analyses exist;
- only some Dashboard domains contain data.

### HTTP 401

Return the existing authentication response when credentials are missing:

```json
{
  "success": false,
  "error": "Authentication required"
}
```

### HTTP 403

Return the existing authentication response for an invalid or expired JWT:

```json
{
  "success": false,
  "error": "Invalid or expired token"
}
```

### HTTP 500

Unexpected service or database failures must be passed to the existing global error middleware and return only the existing safe internal-error response. Internal errors must not be represented as empty Dashboard data.

Dashboard V1 does not introduce a new JSON `404` contract for missing Assessment attempts.

## 13. Frontend Behavior

### Page placement and preservation

`/dashboard` remains the existing Scanner plus History page in `apps/web/src/pages/Dashboard.jsx`.

The new overview must be added above the existing functionality. Scanner, Analysis Result, Analysis History, status changes, deletion, Logout, and current navigation must continue to work.

Dashboard V1 does not create separate Scanner or History routes and does not perform a major frontend redesign.

### Overview content

The overview must include:

- a clear welcome or application-overview area;
- latest Awareness Assessment score/status;
- latest Phishing Identification Assessment score/status;
- Training completed-module count, total-module count, and backend Training Exposure;
- backend-authoritative total URL analyses;
- useful quick actions to existing functionality;
- a non-clickable recent-analysis preview when supported by the summary response.

Existing quick-action destinations are:

- Analyze a URL: `#scanner`;
- Review Analysis History: `#history`;
- Awareness Assessment: `/awareness`;
- Phishing Identification Assessment: `/phishing-identification`;
- Training: `/training`.

The frontend must make one Dashboard summary request through the centralized frontend API service. It must not independently call several feature endpoints and reconstruct the approved summary.

### Recent Analysis presentation

Recent URLs must be rendered as non-clickable text. Dashboard V1 must not wrap them in external links or navigate to the analyzed URL.

The recent preview is read-only. Existing status controls and deletion remain in Analysis History.

### Authoritative frontend data

The frontend must not hardcode or calculate authoritative:

- Assessment scores or status;
- training module totals;
- Training Exposure;
- total analysis counts;
- recent-analysis ordering or limits.

Frontend formatting such as adding a percent sign to the returned `trainingExposure` value or displaying a returned score out of its returned total is allowed. It must not recalculate the underlying authoritative value.

## 14. Loading, Empty, Error, and Session Behavior

### Loading

While the summary request is pending:

- show an accessible loading state for the overview;
- do not display fabricated scores, zeroes, counts, or progress;
- keep the existing scanner/history behavior intact.

### Empty states

When the summary succeeds:

- `null` Awareness means display **Not yet completed**, not score `0`;
- `null` Phishing Identification means display **Not yet completed**, not score `0`;
- zero completed training modules is a valid training state and must display the backend's zero values;
- zero total analyses is a valid count and must direct the user to existing analysis functionality.

### Error state

A non-session Dashboard summary failure must:

- show a clear, accessible error;
- offer a retry action;
- preserve any existing scanner/history capability that does not depend on the failed summary request.

The frontend must not replace a failed summary request with mock or locally reconstructed data.

### Authentication and expired session

The frontend must treat both existing session-error statuses as authentication/session failures:

- HTTP `401`;
- HTTP `403`.

On a session failure, the Dashboard must not display protected metrics and must offer a way to sign in again. Stale local credentials may be cleared as part of the existing client-side Logout/session-recovery behavior.

The existing `ProtectedRoute` token-presence check is not a substitute for backend authentication, and the Dashboard summary request remains protected by the backend.

## 15. Accessibility Expectations

Dashboard V1 must use semantic HTML and existing PhishGuard interface patterns.

Requirements include:

- a logical heading hierarchy;
- clearly labelled Assessment, Training, and Analysis summary sections;
- keyboard-accessible quick-action links;
- visible focus behavior;
- status/loading messages announced appropriately;
- errors exposed with `role="alert"` or equivalent;
- asynchronous regions marked with `aria-busy` where appropriate;
- recent URLs presented as readable, wrapping text rather than inaccessible clickable text;
- status and completion information not conveyed by color alone;
- responsive layouts that remain usable at narrow widths;
- no reliance on animation, gamification, or decorative effects to communicate meaning.

The frontend should reuse existing loading, inline-error, risk-badge, card, and responsive patterns where practical without redesigning the full application.

## 16. Explicit Non-Goals

Dashboard V1 must not include:

- a Dashboard model;
- a Dashboard MongoDB collection;
- persisted aggregate or cached Dashboard data;
- an optional Analysis `{ user: 1, createdAt: -1 }` index;
- Admin or Staff dashboard metrics, actions, or cross-user summaries;
- user comparisons, rankings, leaderboards, badges, streaks, or gamification;
- research correlation, regression, causal analysis, or aggregate-awareness reporting;
- interpretation categories for Assessment scores or Training Exposure;
- definitions of safe, malicious, phishing, or malware status based on a heuristic Analysis;
- a major frontend redesign;
- new Scanner or History frontend routes;
- a single-analysis detail route;
- new frontend test infrastructure;
- new packages;
- new environment variables;
- changes to existing assessment, Training, Analysis, authentication, or RBAC API contracts.

## 17. Compatibility Requirements

Implementation must preserve all existing functionality and contracts, including:

- Awareness Assessment questions, submission, latest result, validation, and HTTP `404` behavior when no attempt exists;
- Phishing Identification Assessment scenarios, submission, latest result, validation, and HTTP `404` behavior when no attempt exists;
- Training catalog, progress, exposure calculation, completion idempotency, and existing response shapes;
- Analysis create, full-history list, status update, and delete behavior;
- the current Scanner and Analysis History interface on `/dashboard`;
- authentication and role hierarchy;
- backend ownership checks;
- existing safe error handling;
- current API base URL and environment-variable contract.

Moving reusable query behavior from controllers into services is acceptable only when existing controllers continue to return the same external status codes and response structures.

## 18. Backend Test Requirements

Add automated backend coverage for the Dashboard summary endpoint using the repository's existing `node:test`, `node:assert/strict`, JWT, HTTP, and MongoDB test patterns.

Tests must cover at least:

### Authentication and route behavior

- `GET /api/dashboard/summary` without a JWT returns HTTP `401`;
- an invalid or expired JWT returns HTTP `403`;
- no mutating Dashboard route is registered;
- a Dashboard GET does not change record counts or state.

### Exact empty response

For an authenticated user with no Dashboard records, assert:

- HTTP `200`;
- `success: true`;
- `latestAwarenessAssessment: null`;
- `latestPhishingIdentificationAssessment: null`;
- `trainingProgress.completedModules: 0`;
- `trainingProgress.totalModules: 3`;
- `trainingProgress.trainingExposure: 0`;
- `urlAnalyses.total: 0`;
- `urlAnalyses.recent: []`.

### Nullable Assessment semantics

- a missing Awareness attempt is `null`;
- a missing Phishing Identification attempt is `null`;
- Awareness and Phishing Identification may be present or absent independently;
- a completed zero-score Assessment remains an object with `score: 0`;
- a valid score-zero result is never converted to `null`;
- multiple attempts select the greatest `completedAt`;
- equal completion timestamps are resolved deterministically by descending `_id`;
- another user's newer attempt cannot be selected.

### Training semantics

- Dashboard returns the exact result of `getTrainingProgressForUser()`;
- zero, one, two, and three completions retain the approved exposure values `0`, `33.33`, `66.67`, and `100`;
- another user's completions do not affect progress;
- Dashboard does not require or expose the full module catalog.

### Analysis count and recency

- total includes all owned statuses: `active`, `reviewed`, and `archived`;
- total excludes other users' and deleted analyses;
- more than five owned analyses returns exactly five recent items;
- recent items are ordered by descending `createdAt`, then descending `_id`;
- status updates do not change Dashboard recency;
- the recent limit cannot be changed by a client parameter;
- Analysis `_id` values are exposed as `id`;
- a client-supplied `userId` cannot change the authenticated owner's result.

### Response sanitization

Assert exact permitted response fields and verify that the serialized summary does not contain:

- `user`;
- `answers`;
- answer keys or correct answers;
- correctness metadata;
- recent-item `indicators`;
- `__v`;
- passwords, JWTs, or unrelated profile data.

### Regression

All existing Awareness, Phishing Identification, Training, Analysis, authentication, authorization, and validation tests must continue to pass.

No frontend test dependency or package should be added. Frontend implementation must pass the existing lint and production build checks when that implementation phase begins.

## 19. Definition of Done

Dashboard V1 is complete when:

- `GET /api/dashboard/summary` is authenticated and read-only;
- ownership comes exclusively from `req.user.userId`;
- the exact summary contract is implemented;
- missing and zero-score Assessment states remain distinct;
- Training reuses `getTrainingProgressForUser()`;
- total and recent analyses are backend-authoritative and owner-scoped;
- no more than five recent analyses are returned in deterministic order;
- the Dashboard overview appears above the preserved Scanner and History functionality;
- loading, empty, error, and session states are accessible;
- recent URLs are non-clickable text;
- no Dashboard collection, persisted aggregate, package, environment variable, Admin/Staff feature, or major redesign is introduced;
- existing API and Dashboard behavior remains compatible;
- backend tests, frontend lint, and frontend production build pass during implementation verification.
