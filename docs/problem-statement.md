# PhishGuard — Problem Statement

**Document status:** Phase 1 research documentation.
**Scope:** Documentation only. No application code was changed.
**Research status:** **No participant research data has been collected.**

---

## 1. Purpose of this document

This document defines the cybersecurity awareness problem that PhishGuard was
built to address, identifies the users and stakeholders the system serves, and
states the boundaries of the problem. It separates three categories that are
frequently conflated in project reporting:

1. **Implemented software** — functionality that exists in the repository and is
   supported by source code.
2. **Proposed research** — study design that is planned but not yet executed.
3. **Unimplemented controls** — protections that are neither implemented nor
   currently in place.

No prevalence figures, survey results, or external research findings are cited
in this document. Where a claim would require evidence that does not exist in
this repository, the claim is omitted or explicitly marked as unverified.

---

## 2. Background of the phishing-awareness problem

Phishing and social engineering target human decision-making rather than
technical vulnerabilities. A defender can patch software, filter traffic, and
enforce password policy, but cannot fully prevent a user from acting on a
convincing message or link. The organisational exposure therefore depends
substantially on whether individuals recognise deceptive content and know what to
do when they encounter it.

This creates a recurring instructional problem for educational and workplace
settings:

- Awareness is often taught as abstract guidance ("be careful with links") rather
  than as a repeatable decision the user must make under time pressure.
- Training is frequently one-directional and unmeasured. An institution may
  deliver a session and have no way to determine whether comprehension or
  behaviour changed.
- Suspicious messages are frequently not reported, because users are uncertain
  whether an item is genuinely malicious or merely unusual. Without a low-friction
  reporting channel, the organisation receives no signal and cannot direct
  attention.
- When reports are submitted, they frequently arrive as unstructured text.
  Reviewing staff must triage each item individually without shared context,
  consistent criteria, or an audit trail.

PhishGuard addresses the instructional and reporting layers of this problem. It
does **not** address the underlying email or network infrastructure that
delivers phishing messages.

---

## 3. Intended users and stakeholders

### 3.1 Confirmed scope (implemented and verifiable)

The implemented system defines exactly three account roles, enforced as an enum
in the user schema and as server-side authorisation on every protected route.

| Role | Confirmed function | Evidence |
|---|---|---|
| Student (`user`) | Analyses URLs, completes training, completes two assessments, submits and tracks incident reports | `apps/api/src/models/User.js` (role enum); `apps/api/src/routes/analysis.routes.js`, `training.routes.js`, `awareness.routes.js`, `phishingIdentification.routes.js`, `reporting.routes.js` |
| IT reviewer (`staff`) | Views the review queue, claims reports, changes priority, starts review, posts messages, completes reports with a human assessment | `apps/api/src/routes/reporting.routes.js` (review routes gated on `authorizeRoles("staff", "admin")`) |
| Administrator (`admin`) | All staff capabilities, plus report assignment and exclusive access to research analytics. Password change and profile update are self-service and are **not** admin-gated | `apps/api/src/routes/research.routes.js`; `apps/api/src/routes/reporting.routes.js` (assignment route gated on `authorizeRoles("admin")`) |

Password change (`POST /api/auth/change-password`) and profile update
(`PATCH /api/auth/profile`) are self-service for **any authenticated account**,
including students. Both routes apply authentication, rate limiting where
applicable, and validation, but no role restriction: a client cannot act on
another account, and no role is required beyond being signed in.

Registration cannot self-assign a privileged role: the registration controller
creates the user record with only name, email, and password, so any role value
supplied by a client is discarded. This is verified by an automated test
asserting that forged staff and admin privileges are ignored.

The deploying organisation is assumed to be a school or similar educational
institution, based on the application's own wording and the presence of staff
and administrator review functions. **Pending verification:** the specific
institution, its size, and the intended number of student users have not been
established from the repository.

### 3.2 Proposed research participants (not yet recruited)

The research dataset defined in the approved specification draws its population
from **active accounts with the `user` role**, excluding staff, admin, and
inactive accounts. This population definition is implemented and tested.

However, **this is a population definition, not a recruited sample.** No
participant has been enrolled, no consent has been obtained, and no data has
been collected for analysis. The distinction is material:

- The code currently *would* include every active student account if the
  analytics view were opened, because the query selects by role and active
  status with no participation filter.
- No user-facing mechanism currently exists by which a student can consent to,
  decline, or later withdraw from research participation.

Consequently, until a consent and recruitment process is implemented and
approved, any analysis produced from existing accounts would represent
**involuntary participation**, and the resulting project could not be described
as research involving human participants. This is treated as a blocking issue in
`docs/ethics-and-data-governance.md`.

---

## 4. Problem with identifying suspicious links

Deceptive URLs are difficult to assess at the moment of decision. A user must
interpret a string of text quickly, often on a device they trust, frequently
under some pressure. Characteristics that distinguish a deceptive URL — a
punycode-encoded hostname, an unusually long subdomain chain, a non-standard
port, an `@` character that redirects the apparent destination, percent-encoded
characters — are not intuitive to non-specialists.

PhishGuard addresses this with a deterministic heuristic analysis that returns a
risk classification together with the specific indicators that produced it, so
the user sees *why* a URL was classified as it was, rather than an unexplained
verdict. The analysis is entirely local and deterministic: it performs no
external reputation lookup, threat-intelligence query, or machine-learned
inference. Its output is a weighted indicator total, not a probability and not a
confidence value.

A low risk classification is therefore **not** evidence that a URL is safe, and a
high risk classification is **not** evidence that a URL is malicious. The
accompanying explanatory text is written in deliberately calibrated language to
preserve that distinction.

---

## 5. Problem with understanding phishing indicators

Knowledge that phishing exists does not translate reliably into correct
recognition of specific indicators. Phishing messages commonly present multiple
plausible details and only one or two are genuinely diagnostic; recognition
requires attending to the correct feature, such as a sender domain that does not
match the expected organisational domain, rather than to a superficial feature
such as the message mentioning IT support.

PhishGuard separates this capability into two distinct constructs so they can be
measured separately rather than conflated:

- **Awareness Score** — general cybersecurity knowledge and correct practice,
  such as password handling, the purpose of multi-factor authentication, safe
  responses to urgent requests, and the role of software updates.
- **Phishing Identification Score** — recognition of the strongest phishing
  indicator within a specific presented message scenario.

Keeping these separate is what allows the project to ask whether general
knowledge and specific recognition capability move together, which is the
subject of research question RQ1.

---

## 6. Motivation for the implemented components

### 6.1 Awareness and phishing identification assessments

The assessments exist to convert awareness from an assumption into a
measurement. Without a recorded score, an institution has no measure of
comprehension at all.

Note that this does **not** mean the current design can detect change. It
supports neither change-over-time measurement — only the latest attempt per
participant is retained, so no baseline exists — nor cohort or group comparison.
See `docs/methodology-justification.md` §5 and §8.3.

The assessments are scored **server-side only**: the correct-answer key is held
in a frozen server constant and is never included in the response that delivers
questions to the browser, so a client cannot submit a score of its own choosing.

### 6.2 Training modules

Three self-contained modules cover recognising phishing indicators, password and
multi-factor authentication security, and safe handling and reporting. Training
completion is recorded only through an explicit server-side completion action,
never as a side effect of viewing content, so exposure reflects deliberate
completion rather than incidental page access.

Training Exposure — the proportion of the three modules a user has **completed** —
is the implemented measure of how much of the curriculum a user has worked
through. It records completion only: it does not record time spent,
comprehension, or retention. It is the exposure variable used in RQ2 and RQ3.

### 6.3 Incident reporting

A student who notices something suspicious needs a route to report it that is
faster than composing an email to IT. Reporting is tied to a specific URL
analysis, so the submitted item carries the automated heuristic result as
context for the reviewer. The report record also stores an immutable snapshot of
the analysis as it stood at submission time, which means later changes cannot
retroactively alter the evidence a reviewer was working from.

### 6.4 Human IT review

Automated heuristics cannot adjudicate an ambiguous report. The review workflow
therefore requires a human decision: a reviewer must classify a completed report
as one of three final outcomes, and the schema enforces that a completed report
cannot exist without both a final assessment and reviewer attribution.

This separation is deliberate and is central to the project's integrity claim:
**automated analysis and human assessment are distinct, and the system never
presents one as the other.** A reviewer may reach a different conclusion from
the automated classifier; the workflow is designed to record that divergence
rather than suppress it.

---

## 7. Scope and boundaries

### 7.1 In scope

- Deterministic lexical and structural URL risk analysis with explanatory indicators
- Two separately scored cybersecurity assessments
- A fixed three-module training curriculum with server-authoritative completion
- A student incident reporting workflow with a staff/admin human review lifecycle
- A research analytics module that derives aggregate descriptive statistics and
  pairwise associations from existing records
- Role-based access control with server-side enforcement

### 7.2 Explicitly out of scope

The following are not provided and must not be implied in any project claim:

- Malware detection or scanning
- External threat-intelligence or reputation-database lookup
- Machine-learned classification or predictive scoring
- Definitive determination that a URL is safe, malicious, or a phishing site
- Email filtering, gateway controls, or message filtering
- Incident containment, forensics, or remediation
- Causal evaluation of training effectiveness
- Statistical significance testing (excluded from the approved specification and
  not implemented)
- Automated research conclusions

### 7.3 Boundaries of the research problem

The research question set is restricted to associations among three variables
that the application already measures: awareness score, phishing identification
score, and training exposure. Variables not currently recorded — such as
demographic characteristics, prior cybersecurity training, years of computing
experience, frequency of suspected phishing exposure, or reported user
confidence — are outside the current design and are **not available in the
existing data model.**

---

## 8. Current research status

**PhishGuard has not collected participant research data.** No participant has
been recruited, no consent obtained, no dataset gathered, and no findings,
results, or conclusions exist.

What exists today is:

| Element | Status |
|---|---|
| Research questions | Proposed (see `docs/research-questions.md`) |
| Research design and method | Documented as a plan (see `docs/methodology-justification.md`) |
| Variable definitions and measurement | Implemented and verified in source code |
| Analytics computation | Implemented, unit-tested, and verified in source code |
| Analytics interface | Implemented (admin-only page and de-identified CSV export) |
| Participant recruitment | **Not started** |
| Informed consent | **Not implemented** |
| Data collection | **Not started** |
| Analysis execution on real data | **Not performed** |
| Findings and interpretation | **Do not exist** |

Any project report must therefore describe the research as **proposed and
pending**, not completed. Statements that PhishGuard has demonstrated, proven,
or measured any relationship between training and security outcomes are not
supported by this repository and must not be made.

---

## 9. Related documents

| Document | Content |
|---|---|
| `docs/research-questions.md` | The three proposed research questions and operational variable definitions |
| `docs/methodology-justification.md` | Proposed design, method selection, and known limitations |
| `docs/system-justification.md` | How the implemented system addresses this problem |
| `docs/ethics-and-data-governance.md` | Data collected, privacy risks, and actions required before recruitment |
| `specs/research-analytics-v1.md` | Approved feature specification governing the analytics module |
