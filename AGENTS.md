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

- Phase 1 — Final Feature Completion: complete
- Phase 2 — Feature Freeze & Cleanup: complete
- Phase 3 — Major UI/UX V1: current

The current `main` branch is the feature-frozen functional baseline.

During Major UI/UX V1, existing product behavior and backend/API contracts
must remain unchanged unless an explicitly approved task says otherwise.

## Major UI/UX V1 Guardrails

The following rules apply during the Major UI/UX V1 phase:

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

- Research analytics must not imply causation, statistical significance, or
  predictive validity beyond what the implementation supports.

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
- Render deployment configuration

Backend Staff/Admin authorization tests and protected endpoints remain part of
the security implementation even when the normal frontend does not expose
temporary RBAC demonstration controls.

Do not weaken backend authorization merely to make frontend behavior work.

## Current Product Boundaries

Implemented learning variables include:

- Cybersecurity Awareness Score
- Phishing Identification Score
- Training Exposure

Training Exposure is based on explicit completion of the fixed PhishGuard
training modules.

When discussing relationships among research variables, describe statistical
relationships as associations unless the research design supports a causal
claim.

## URL Analysis

The URL Analyzer is heuristic.

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
- Training Exposure
- URL-analysis scores or risk classifications

The frontend may present backend results but must not silently recreate
authoritative business rules.

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

Before changing code:

1. Inspect the relevant existing files.
2. Understand the current implementation.
3. Read the relevant approved specification, if one exists.
4. Briefly state the intended implementation.
5. Make the smallest coherent change that satisfies the task.
6. Avoid unrelated refactors.

After backend changes, run the relevant backend tests.

Standard backend verification (Windows PowerShell):

`cd apps/api`
`npm test`

After frontend changes, run:

`cd apps/web`
`npm run lint`

and:

`cd apps/web`
`npm run build`

For full-stack changes, run both backend and frontend verification.

Run `git diff --check` before recommending that changes are committed.

Do not claim a change works unless it has been verified, or clearly state
what remains unverified.

## Git Rules

Do not run `git push`.

Do not create commits unless explicitly instructed.

Do not stage files unless explicitly instructed.

Do not rewrite Git history.

Do not use destructive Git commands.

The human developer reviews diffs and decides what is staged, committed, and
pushed.

Use `git status` and `git diff` for inspection when useful.

Treat the current human-reviewed `main` branch as the development baseline
unless the task explicitly identifies another baseline.

## Coding Guidelines

Follow the style already present in the repository.

Prefer clear, maintainable JavaScript and React code.

Keep backend responsibilities separated among routes, middleware,
controllers, services, and models.

Perform input validation before business logic where appropriate.

Keep authorization enforcement on the backend even when the frontend also
hides or disables controls.

Avoid unnecessary dependencies.

Do not perform large rewrites when a focused change is sufficient.

Preserve existing external API behavior unless the approved task explicitly
changes it.

When extending an existing API, prefer backward-compatible additions where
practical.

## AI Harnessing Behavior

You are operating as a coding agent under human supervision.

For each development task:

1. Inspect before editing.
2. Read applicable specifications.
3. Briefly state the intended implementation.
4. Modify only relevant files.
5. Run appropriate verification.
6. Report files changed.
7. Report tests, lint, or build results.
8. Report remaining risks or assumptions.
9. Wait for human review before any commit or deployment.

Do not use subagents unless explicitly requested.

Do not expand the task scope without approval.