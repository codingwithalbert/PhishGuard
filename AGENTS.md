\# PhishGuard Development Instructions



\## Project Purpose



PhishGuard is a MERN cybersecurity awareness and phishing-risk assessment application.



The currently implemented practical module analyzes URLs using heuristic and lexical phishing indicators. It provides a risk assessment, not a definitive determination that a website is safe, malicious, or phishing.



Do not claim planned features are implemented unless they actually exist in the repository.



\## Architecture



Preserve the existing MERN architecture:



React frontend

\-> REST/HTTPS

\-> Node.js + Express backend

\-> routes

\-> validation/auth middleware

\-> controllers

\-> Mongoose models

\-> MongoDB



Repository structure:



\- `apps/web` - React/Vite frontend

\- `apps/api` - Node.js/Express/Mongoose backend



Do not replace React, Express, Mongoose, MongoDB, or the existing architecture unless explicitly instructed.



\## Existing Functionality



Preserve working functionality unless the requested task explicitly changes it:



\- Registration

\- Login

\- Logout

\- bcrypt password hashing

\- JWT authentication and expiration

\- User, Staff, and Admin roles

\- Role-based authorization

\- URL analysis

\- Analysis history

\- Analysis create/read/update/delete operations

\- User ownership checks

\- Input validation

\- Rate limiting

\- Audit logging

\- Helmet security headers

\- Safe error responses

\- MongoDB persistence

\- Render deployment configuration



Role hierarchy currently demonstrated:



\- User: normal authenticated functions only

\- Staff: normal functions plus Staff-protected function

\- Admin: normal functions plus Staff and Admin-protected functions



Do not weaken backend authorization merely to make frontend behavior work.



\## Security Rules



Never:



\- read or expose `.env`

\- print secrets

\- hard-code MongoDB credentials

\- hard-code JWT secrets

\- hard-code passwords

\- expose authentication tokens

\- commit secrets

\- log passwords

\- log JWTs

\- store plaintext passwords

\- return stack traces or sensitive internal information to clients

\- bypass authentication, authorization, validation, or ownership checks



`.env.example` may be inspected and updated when configuration documentation requires it.



Use bcrypt for password hashing and preserve the existing secure authentication design.



Public registration must not allow users to assign themselves privileged Staff or Admin roles.



\## External Services and Cost



Do not introduce any paid API, pay-as-you-go API, purchased API credits, subscription service, or other service that can create additional charges.



Do not require a new external service without explicit approval.



Prefer the project's existing services and free/local functionality.



If a requested feature appears to require a paid service, stop and explain the requirement instead of adding it.



\## Scope



The approved broader PhishGuard concept may eventually include:



\- cybersecurity awareness questionnaires

\- controlled educational phishing scenarios

\- training modules

\- training completion tracking

\- user progress

\- aggregate awareness analytics



These are planned features unless they are actually implemented.



Do not represent them as completed features.



The research concept may examine relationships among:



\- Cybersecurity Awareness Score

\- Phishing Identification Score

\- Training Exposure



Correlation must be described as association, not causation.



\## URL Analysis



The URL analyzer is heuristic.



Do not describe:



\- low risk as proof that a URL is safe

\- high risk as proof that a URL is malicious

\- the analyzer as malware detection

\- the analyzer as definitive phishing verification



Preserve clear educational/risk-assessment wording.



\## Development Workflow



Before changing code:



1\. Inspect the relevant existing files.

2\. Understand the current implementation.

3\. Make the smallest coherent change that satisfies the task.

4\. Avoid unrelated refactors.



After backend changes, run the relevant backend tests.



Standard backend verification:



`cd apps/api \&\& npm test`



After frontend changes, run:



`cd apps/web \&\& npm run lint`



and:



`cd apps/web \&\& npm run build`



For full-stack changes, run both backend and frontend verification.



Do not claim a change works unless it has been verified or clearly state what remains unverified.



\## Git Rules



Do not run `git push`.



Do not create commits unless explicitly instructed.



Do not rewrite Git history.



Do not use destructive Git commands.



The human developer reviews diffs and decides what is committed and pushed.



Use `git status` and `git diff` for inspection when useful.



Known-good baseline before the initial OpenCode harnessing phase:



`3d3ce75 Add frontend RBAC demonstration`



\## Coding Guidelines



Follow the style already present in the repository.



Prefer clear, maintainable JavaScript and React code.



Keep backend responsibilities separated among routes, middleware, controllers, services, and models.



Perform input validation before business logic where appropriate.



Keep authorization enforcement on the backend even when the frontend also hides or disables controls.



Avoid unnecessary dependencies.



Do not perform large rewrites when a focused change is sufficient.



\## AI Harnessing Behavior



You are operating as a coding agent under human supervision.



For each development task:



1\. Inspect before editing.

2\. Briefly state the intended implementation.

3\. Modify only relevant files.

4\. Run appropriate verification.

5\. Report files changed.

6\. Report tests/lint/build results.

7\. Report remaining risks or assumptions.

8\. Wait for human review before any commit or deployment.



Do not expand the task scope without approval.

