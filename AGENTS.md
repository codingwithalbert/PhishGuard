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

## Existing Functionality

Preserve working functionality unless the requested task explicitly changes
it.

Implemented functionality includes:

- Registration
- Login
- Logout
- bcrypt password hashing
- JWT authentication and expiration
- User, Staff, and Admin roles
- Backend role-based authorization
- URL analysis
- Analysis history
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

Features that may be implemented in later phases include:

- Explainable URL Analysis
- suspicious-URL Reporting
- meaningful Staff/Admin report review
- forgot/reset password and email delivery
- final UI/UX refinement

A feature listed as planned must not be represented as implemented until its
code has been completed and verified.

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

Standard backend verification:

`cd apps/api && npm test`

After frontend changes, run:

`cd apps/web && npm run lint`

and:

`cd apps/web && npm run build`

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