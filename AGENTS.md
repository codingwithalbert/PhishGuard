# PhishGuard Development Instructions

## Project Purpose

PhishGuard is a MERN cybersecurity awareness and phishing-risk assessment
application.

The URL Analyzer evaluates lexical and structural URL characteristics using
heuristics. It provides a risk assessment, not a definitive determination
that a website is safe, malicious, or phishing.

Do not claim planned features are implemented unless they actually exist in
the repository.

## Architecture

Preserve the existing MERN architecture:

React frontend
-> REST/HTTPS
-> Node.js + Express backend
-> routes
-> validation/auth middleware
-> controllers
-> services
-> Mongoose models
-> MongoDB

Repository structure:

- `apps/web` - React/Vite frontend
- `apps/api` - Node.js/Express/Mongoose backend
- `specs` - approved feature specifications
- `harness` - project verification tooling

Do not replace React, Express, Mongoose, MongoDB, or the existing architecture
unless explicitly instructed.

## Current Development Phase

- Phase 1 — Core Foundation: COMPLETE
- Phase 2 — Product Features: COMPLETE
- Phase 3 — Major UI/UX V1: COMPLETE
- Phase 4 — Security & QA + Final V1 Refinement: CURRENT, near completion
- Phase 5 — Documentation & Research Readiness: NEXT
- Phase 6 — V1 Release Candidate: FINAL V1 PHASE

Honor the baseline specified by each task; otherwise use the current
human-reviewed `main` baseline, including approved fixes.

Throughout the remaining V1 phases, existing product behavior and API contracts
must remain unchanged unless an explicitly approved task says otherwise.

Remaining V1 work is bounded to QA/security refinement, verification,
documentation/research readiness, release-candidate preparation, and explicitly
approved fixes. It does not authorize unrelated feature expansion. Optional/V2
ideas require separate approval. Do not reopen completed UI work without approval.

### Resolved Security & QA Checkpoint

These findings are resolved with regression coverage, not outstanding work:

- Research Analytics owner projections corrected — `0676a0b`.
- Global error logging sanitized — `44d3690`.
- Audit request paths stripped of query strings — `921f828`.

These commits identify the checkpoint, not a permanent task baseline.

## Continuing V1 Guardrails

The following rules apply throughout the remaining V1 phases:

### Functional Preservation

- UI/UX work must preserve existing functionality.
- Do not alter backend behavior merely to simplify frontend redesign.
- Do not change API contracts unless explicitly approved.
- Do not change URL-analysis heuristics, scores, thresholds, or findings logic.
- Do not reintroduce the removed Analysis.status frontend controls.
- Analysis History remains a product feature.
- Frontend role visibility is UX only; backend authorization remains the
  security boundary.

### Risk Communication

- Automated URL analysis remains heuristic.
- LOW risk must not be presented as proof that a URL is safe.
- HIGH risk must not be presented as proof of phishing/maliciousness.
- Human IT assessment must remain visually and conceptually distinct from
  automated heuristic analysis.
- Report workflow status must remain distinct from Analysis.status.

### Research Analytics

- Preserve the active `role=user` cohort and latest applicable assessment
  attempts under the approved Research Analytics specification.
- Preserve participant ownership associations and the corrected projection
  behavior; do not drop fields required to associate source records with owners.
- Reuse authoritative fixed three-module Training Exposure semantics.
- Missing assessment values remain null (blank in CSV); legitimate zero values
  remain zero.
- Preserve transient pseudonymous participant IDs and de-identified output.
- Keep analytics descriptive/exploratory and preserve pairwise-complete Pearson
  calculations and safely nullable undefined correlations.
- Research analytics must not imply causation, statistical significance, or
  predictive validity beyond what the implementation supports. Correlation does
  not establish causation.

### Accessibility and States

- Preserve loading, error, empty, disabled, and success states.
- Design responsive behavior intentionally for desktop and small screens.
- Preserve or improve semantic HTML, keyboard usability, visible focus states,
  labels, contrast, and non-color-only status communication.
- Do not claim formal accessibility/WCAG compliance unless verified.

### Implementation

- Prefer reusable components when actual reuse exists, but avoid abstraction
  for its own sake.
- Avoid unnecessary dependencies or UI frameworks.
- Preserve the existing React/Vite stack.

### Visual Direction

- Professional, trustworthy, modern, calm, security-oriented.
- Appropriate for a school environment.
- Approachable for students.
- Efficient for IT staff/admins.
- Preserve the existing dark navy/cyan visual system.
- Avoid generic templated/"AI slop" redesigns.

Existing GSAP motion is sufficient. Three.js remains intentionally limited
mainly to the auth visual treatment. Preserve reduced-motion behavior and
static fallbacks; do not add decorative animation merely for polish.

Avoid:

- Stereotypical hacker-terminal design.
- Neon/cyberpunk overload.
- Matrix-style decoration.
- Excessive glow or gradients.
- Gaming-dashboard aesthetics, gamification, streaks, rankings, leaderboards,
  or achievement badges.
- Decorative cybersecurity clichés.

The installed design skills may help with UI work, but PhishGuard project
instructions and approved specifications take precedence over generic design
recommendations.

## Existing Functionality

Preserve working functionality unless the requested task explicitly changes
it.

Implemented functionality includes:

- Registration
- Login
- Logout
- Forgot Password / Reset Password (via Brevo transactional email)
- Profile management
- Change Password
- bcrypt password hashing
- JWT authentication and expiration
- User, Staff, and Admin roles
- Backend role-based authorization
- URL analysis (heuristic)
- Explainable URL Analysis (structured findings with explanations)
- Analysis History
- Analysis create/read/update/delete operations
- User ownership checks
- Input validation
- Login rate limiting
- Authentication audit logging
- Helmet security headers
- Safe error responses
- MongoDB persistence
- Awareness Assessment
- Phishing Identification Assessment
- Training modules and Training Exposure tracking
- Dashboard V1
- Progress V1
- Student incident reporting (suspicious-URL reports)
- Staff/Admin IT report review workflow
- Report messaging between students and IT staff
- Human IT assessment and report completion workflow
- Report Email Notifications (message and completion notifications)
- Research Analytics (aggregate statistics and correlations)
- Admin CSV research export (de-identified)
- Render frontend and backend/API deployment

Backend Staff/Admin authorization tests and protected endpoints remain part of
the security implementation even when the normal frontend does not expose
temporary RBAC demonstration controls.

Do not weaken backend authorization merely to make frontend behavior work.

### Established Deployment and Prior Verification

The frontend and backend/API are already deployed on Render. HTTPS has
previously been verified, and production security smoke checks have previously
been performed. Missing Render manifests/configuration in the repository are
not evidence that the application is undeployed.

Prior verification also includes a broader backend suite with intentional
opt-in integration skips, frontend lint/build passes, backend/frontend npm
audits reporting zero vulnerabilities, and a verification harness PASS. This
is historical project evidence, not fresh verification by the current task.

## Current Product Boundaries

Implemented learning variables include:

- Cybersecurity Awareness Score
- Phishing Identification Score
- Training Exposure

Training Exposure is based on explicit completion of the fixed PhishGuard
training modules. Completion and exposure are backend-authoritative; completion
must result from explicit server-side completion actions, never merely viewing
content, timers, animation, or frontend/local state.

When discussing relationships among research variables, describe statistical
relationships as associations unless the research design supports a causal
claim.

## URL Analysis

The URL Analyzer performs deterministic heuristic lexical/structural URL
analysis. It does not use external reputation/threat-intelligence lookup unless
separately approved and implemented. Its score is not an ML probability or
confidence value.

Do not describe:

- low risk as proof that a URL is safe
- high risk as proof that a URL is malicious
- the analyzer as malware detection
- the analyzer as definitive phishing verification

Preserve clear educational and risk-assessment wording.

Do not change URL-analysis heuristics, scoring weights, or risk thresholds
unless the approved task or specification explicitly requires it.

## Server Authority

Security-sensitive and research-relevant values must remain
server-authoritative where the existing architecture makes them authoritative.

Do not trust the frontend to determine:

- authentication or authorization
- object ownership
- privileged roles
- assessment scores
- Training completion
- Training Exposure
- URL-analysis scores or risk classifications

The frontend may present backend results but must not silently recreate
authoritative business rules. Awareness and Phishing Identification scoring
remain backend-authoritative.

## Security Rules

Never:

- read or expose `.env`
- print secrets
- hard-code MongoDB credentials
- hard-code JWT secrets
- hard-code passwords
- expose authentication tokens
- commit secrets
- log passwords
- log JWTs
- store plaintext passwords
- return stack traces or sensitive internal information to clients
- bypass authentication, authorization, validation, or ownership checks

`.env.example` may be inspected and updated when configuration documentation
requires it.

Use bcrypt for password hashing and preserve the existing secure
authentication design.

Public registration must not allow users to assign themselves privileged
Staff or Admin roles.

Global unexpected-error diagnostics are intentionally sanitized. Do not
reintroduce raw error-object logging that may expose messages, stacks, bodies,
request data, secrets, or other sensitive values. Audit events intentionally
record query-free request paths; do not reintroduce arbitrary query-string
logging or mutate request URLs/routing state to sanitize logs. Client-facing
errors must remain safe/sanitized.

## External Services and Cost

Do not introduce any paid API, pay-as-you-go API, purchased API credits,
subscription service, or other service that can create additional charges.

Do not require a new external service without explicit approval.

Prefer the project's existing services and free/local functionality.

If a requested feature appears to require a paid service, stop and explain
the requirement instead of adding it.

## Feature Specifications

When an approved specification exists under `specs`, read it before
implementing that feature.

Treat the approved specification as the feature contract.

Do not silently expand the specification or add adjacent features.

If the specification conflicts with the current implementation in a way that
requires a product, security, data-model, or compatibility decision, stop and
report the conflict before making that decision.

## Development Workflow

Commands must be compatible with Windows PowerShell. Do not use `&&` or `||`
in PowerShell commands; use separate commands or semicolons where appropriate.

Before changing code:

1. Inspect the relevant existing files.
2. Understand the current implementation.
3. Read the relevant approved specification, if one exists.
4. Briefly state the intended implementation.
5. Make the smallest coherent change that satisfies the task.
6. Avoid unrelated refactors.

After backend changes, run the relevant backend tests within the authorized
scope. Inspect what test commands execute before running them: backend test
discovery includes live API/database-dependent suites.

For bounded tasks, prefer relevant isolated tests that require no live
API/database or production access. Live MongoDB, running-API, production, or
environment-dependent verification requires explicit authorization and a
known-safe environment. Never access secrets or `.env` merely to make tests run.

Full backend verification command (only when its environment/scope is approved):

`cd apps/api`
`npm test`

After frontend changes, run:

`cd apps/web`
`npm run lint`

and:

`cd apps/web`
`npm run build`

For full-stack changes, run both backend and frontend verification within the
same safety and authorization boundaries. Documentation-only changes normally
need diff review and whitespace checks, not application tests.

Run `git diff --check` before recommending that changes are committed.

Do not claim a change works unless it has been verified, or clearly state
what remains unverified.

Report the exact commands, scope, pass/fail/skip counts, and what was not run.
Historical results must not be represented as current-task execution.
Differently scoped counts are not automatically contradictions; describe
intentional opt-in integration skips accurately, not as executed passing tests.

## Git Rules

Staging, committing, pushing, and deployment each require explicit authorization
for that specific step under the approval workflow below. Never perform these
independently. Deployment authorization is separate from commit/push approval.

Do not rewrite Git history.

Do not use destructive Git commands.

Do not delete branches or force-push.

Use `git status` and `git diff` for inspection when useful.

Honor the task-specified baseline; otherwise use current human-reviewed `main`.

## Coding Guidelines

Follow the style already present in the repository.

Prefer clear, maintainable JavaScript and React code.

Keep backend responsibilities separated among routes, middleware,
controllers, services, and models.

Perform input validation before business logic where appropriate.

Keep authorization enforcement on the backend even when the frontend also
hides or disables controls.

Avoid unnecessary dependencies. Package installation outside the approved task
requires explicit approval; do not install packages merely to make progress.

Do not perform large rewrites when a focused change is sufficient.

Preserve existing external API behavior unless the approved task explicitly
changes it.

When extending an existing API, prefer backward-compatible additions where
practical.

## AI Harnessing Behavior

You are operating as a coding agent under human supervision.

Canonical approval workflow:

1. ChatGPT/user scopes and approves a task.
2. OpenCode performs only the bounded task.
3. The user returns output/diff/tests to ChatGPT.
4. ChatGPT reviews and explicitly decides whether staging is appropriate.
5. The authorized staged set is verified.
6. ChatGPT explicitly decides whether a commit is appropriate.
7. The authorized commit and resulting status are verified.
8. ChatGPT explicitly decides whether a push is appropriate.

Task completion does not authorize any later step. Deployment requires its own
explicit authorization. OpenCode must not independently stage, commit, push,
deploy, rewrite history, delete branches, perform destructive Git operations,
access secrets, expand scope, install unnecessary dependencies, or fix unrelated
findings. Report unrelated findings separately rather than making extra fixes.

For each development task:

1. Inspect before editing.
2. Read applicable specifications.
3. Briefly state the intended implementation.
4. Modify only relevant files.
5. Run appropriate verification.
6. Report files changed.
7. Report tests, lint, or build results.
8. Report remaining risks or assumptions.
9. Stop for human/ChatGPT review and separate authorization of any staging,
   commit, push, or deployment step.

Do not use subagents unless explicitly requested.

Do not expand the task scope without approval.
