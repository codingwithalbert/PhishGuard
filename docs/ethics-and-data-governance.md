# PhishGuard — Ethics and Data Governance

**Document status:** Phase 1 research documentation.
**Critical status:** **No participant research data has been collected. No
consent mechanism exists. No withdrawal mechanism exists. No retention policy
exists.**

> ## Governing principle for this document
>
> This document records what PhishGuard does, what it does not do, and what must
> be resolved before any participant data is gathered.
>
> Where a control is absent, it is described as absent. Nothing in this document
> should be read as asserting that a consent, deletion, withdrawal, or retention
> mechanism exists. **None of them do.**

---

## 1. Purpose and scope

This document covers the ethical and governance position of the PhishGuard
project, with specific reference to the proposed research programme described in
`docs/research-questions.md` and `docs/methodology-justification.md`.

It is written on the assumption that the research will involve human
participants who are, in the main, students in an educational setting. That
assumption creates a genuine imbalance of power: participants may feel implicit
pressure to participate, may believe participation affects assessment or
standing, and may be unable to decline without cost. Governance must therefore be
established **before** recruitment, not afterwards.

**The deploying institution, its data-protection requirements, and any
applicable research-ethics review process are not established from this
repository. Pending verification.**

---

## 2. Data collected by existing application workflows

PhishGuard collects personal data as a normal consequence of its product
functions. This is not yet "research data" — most of it serves the application.
The distinction matters, because a collection justified for operational purposes
does not automatically become justified for research purposes.

### 2.1 Account data — collection `users`

| Field | Purpose | Sensitivity |
|---|---|---|
| `name` | Display and identification | Personal identifier |
| `email` | Sign-in, password reset, notifications | **Direct identifier** |
| `password` | Sign-in | Stored as a bcrypt hash; the plaintext is never stored |
| `role` | Authorisation (`user`, `staff`, `admin`) | Access-control attribute |
| `isActive` | Account state and cohort inclusion | Account state |
| `tokenVersion` | Session invalidation | Security-relevant |
| `passwordResetTokenHash`, `passwordResetExpiresAt` | Password reset | Excluded from normal queries |
| `createdAt`, `updatedAt` | Audit and deterministic ordering | Temporal metadata |

The password hash and both reset-state fields are excluded from default queries
so they cannot be returned by an ordinary request.

### 2.2 Assessment data — `awarenessAssessments` and `phishingIdentificationAssessments`

Each submission stores the participant's individual answers, the raw correct
count, the resulting score, the item total, and a completion timestamp. The
individual answer pattern is retained per attempt, not merely the score.

### 2.3 Training data — `trainingCompletions`

One record per participant per completed module, storing the module identifier
and completion timestamp. A unique index prevents duplicate records for the same
participant and module.

### 2.4 URL analysis data — `analyses`

Stores the submitted URL, the computed risk classification, the score, the
detected indicators, a status value, and a timestamp, associated with the
owning account. **The URL string itself may contain identifying or sensitive
information** — for example, a link containing a token, an identifier, or a
personal name in the path.

### 2.5 Incident data — `reports` and `reportMessages`

A report stores a ticket number, the reporting participant, the linked analysis,
an immutable snapshot of that analysis, a reason category, free-text details, a
status, a priority, reviewer assignment, a human assessment outcome, a reviewer
note, and reviewer attribution. Messages store the conversation between a
participant and a reviewer.

**This is the most sensitive collection in the system.** Free-text report
details and message content may describe a genuine security incident, name
individuals, or disclose information about a third party who is not a PhishGuard
user and has given no consent to any processing.

### 2.6 Operational counters — `reportTicketCounters`

Ticket-number allocation state. Not participant data.

### 2.7 Data collected outside the database

- **Email address** of message recipients in outbound notifications to the
  transactional email provider.
- **Server logs**, including an authentication audit trail recording event type,
  timestamp, method, path, account identifier, and role. Query strings are
  stripped from recorded paths.
- **The browser session token**, held in local storage for the duration of a
  session.

---

## 3. Intended research variables

The proposed research uses exactly three variables:

| Variable | Type | Derivation | Identifiability |
|---|---|---|---|
| Awareness Score | 0–100 | Latest completed awareness attempt | None directly; reflects an individual's capability |
| Phishing Identification Score | 0–100 | Latest completed identification attempt | None directly |
| Training Exposure | 0 / 33.33 / 66.67 / 100 | Count of completed modules | None directly |

The research dataset also carries a pseudonymous participant identifier and two
completion timestamps. **No name, email address, account identifier, password,
URL, report, message, or authentication record is carried into the research
dataset.**

### 3.1 A distinction that must not be blurred

Awareness and identification scores are derived from **assessments**, which
users may reasonably expect to be part of their own learning record. The same
scores are also **research variables**. A participant who completes an
assessment for learning purposes has no way to know that the result is also
available for research aggregation.

**This is precisely the gap that consent must close, and consent does not exist.**
Until it does, research participation is involuntary by default.

---

## 4. Data minimisation and de-identification

### 4.1 Measures implemented

| Measure | Implementation |
|---|---|
| Research dataset holds only the three variables plus a pseudonym and timestamps | `buildResearchParticipantDataset()` |
| Direct identifiers never enter the dataset | Name and email are not selected into the research records |
| Database identifiers never exported | ObjectId is used internally for joins but is not part of any exported column |
| Pseudonymous, deterministic participant identifiers | `PG-R0001`, `PG-R0002`, … assigned in account-creation order; transient and never persisted |
| Fixed export column allowlist | Exactly seven columns; the export adds no derived values and no spreadsheet formulas |
| Formula-injection neutralisation | Export values beginning with a spreadsheet formula character are prefixed before serialisation |
| Aggregation is de-identified by construction | Statistical responses expose no participant-level records |
| Response caching disabled | Analytics responses are marked not to be stored by intermediary caches |
| Credential fields excluded from queries | Password and reset-state fields cannot leak through an ordinary response |
| Credential secrets never logged | Logging emits fixed classifications only; error messages, stacks, and request bodies are never serialised |
| Query strings stripped from audit records | Prevents tokens or identifiers in a URL from reaching logs |

These are genuine, implemented, and tested measures. They substantially reduce
re-identification risk **in the research dataset**.

### 4.2 What de-identification does not solve

De-identification is a mitigation, not a guarantee. The research variables are
drawn from a **small, bounded population**: within one institution, with four
possible exposure values and eleven possible values on each score. A dataset of
this shape with modest size is vulnerable to re-identification by linkage
against other information an organisation already holds — for example, a known
cohort of students who completed all three modules.

Pseudonymous identifiers are also **deterministic**. Re-running an export on an
unchanged population reproduces the same identifier for the same account. This is
deliberate, and it guarantees reproducibility of reported figures — but it also
means the identifier is a **persistent pseudonymous key** for that population, so
repeated exports accumulate a longitudinal record of the same individuals.

De-identification addresses the research dataset. It does not address the
underlying operational collections.

---

## 5. Current access restrictions

| Resource | Restriction | Enforced |
|---|---|---|
| Research analytics and CSV export | Authenticated administrator only | **Server-side**, on both endpoints |
| Review queue and reviewer actions | Staff or administrator | **Server-side** |
| Report assignment | Administrator only | **Server-side** |
| Analyses, reports, and messages | Owning participant only, unless a reviewer route applies | **Server-side**, via ownership constraints |
| Account profile and password change | The authenticated caller only; a client cannot act on another account | **Server-side** |

Additional relevant properties:

- Roles are **re-read from the account record on every protected request**. A
  token's stored role claim is deliberately never used for authorisation, so a
  role change takes effect immediately and a stale token cannot retain
  privileges.
- Public registration **cannot assign a privileged role**; any client-supplied
  role value is discarded.
- Frontend visibility is a usability control only and is never the security
  boundary.

### 5.1 Access is necessary but not sufficient

Server-side access control is a strong technical control and is well
implemented. It is not a substitute for consent. Restricting who may *see* the
data does not establish that the people whose behaviour produced it agreed to its
research use.

### 5.2 The auditor is not independent

Administrators administer both the system and the research. Those roles are not
separated. A small institution will likely have a very small number of people who
can both grant roles and view analytics. This concentrates access and is worth
recording as a governance weakness. **No audit-log review procedure currently
exists.**

---

## 6. Potential privacy risks

| # | Risk | Current state |
|---|---|---|
| 1 | **Unconsented research use.** Scores and training completion are available for research aggregation with no notice, no consent, and no opt-out | **Unmitigated** |
| 2 | **Sensitive free-text in reports.** Incident details and messages may contain personal or third-party information | Collected; no automated redaction; access restricted to the reviewer workflow |
| 3 | **URLs as potential identifiers.** Submitted URLs may embed names, identifiers, or tokens in the path or query | Stored in full in the analysis record. Audit records capture the **request endpoint path only** — for example `/api/analyze` — and never the submitted URL, which travels in the request body and is not logged |
| 4 | **Behavioural profiling by association.** Combining scores, exposure, and reporting produces a capability profile of an individual student | No mechanism currently prevents an administrator from combining these views |
| 5 | **Small-cohort re-identification.** See §4.2 | Partially mitigated by de-identification |
| 6 | **Persistent pseudonymous linkage.** Deterministic identifiers accumulate across exports | By design; documented here as a residual risk |
| 7 | **Email disclosure to a third party.** Recipient addresses are sent to an external transactional email provider | Operational necessity; no consent record |
| 8 | **Long-lived retention.** No deletion, expiry, or anonymisation schedule exists for any collection | **Unmitigated** |
| 9 | **No data-subject rights.** No self-service export, correction beyond display name, or deletion | **Unmitigated** |
| 10 | **Consequence of refusal.** No mechanism exists by which a user learns that declining is possible or consequence-free | **Unmitigated** |
| 11 | **Session token in browser storage.** An accessible token is a live credential | Product security issue; see the audit |
| 12 | **No breach-response procedure.** No documented process for detecting or handling a data breach | **Unmitigated** |

Risks 1, 8, 9, 10, and 12 are governance gaps rather than code defects, and they
are the items that most directly concern research ethics.

---

## 7. Absent controls — explicit statement

The following are **not implemented**. This section exists so that no reader,
panel, or future report mistakes a requirement for a capability.

| Control | Status | Consequence |
|---|---|---|
| **User-facing research consent** | **Absent.** The registration form contains only name, email, and password fields | Participants cannot agree to research use because they are never asked |
| **Privacy policy or notice** | **Absent.** No privacy notice exists anywhere in the application | No disclosure of what is collected or why |
| **Research participation flag** | **Absent.** The population query selects by role and active status only | Every active student account is inside the potential dataset |
| **Withdrawal mechanism** | **Absent.** No endpoint, control, or user-facing option exists | A participant who wished to withdraw could not do so, and could not request that their records be removed from the analysis |
| **Data deletion** | **Absent.** No account or record deletion exists | No route to erasure for any collection |
| **Data-subject access or portability** | **Absent.** A participant cannot obtain a machine-readable copy of their own research records | Limited ability to exercise access rights |
| **Data-retention policy** | **Absent.** No schedule, expiry, or anonymisation procedure is defined | Data is retained indefinitely by default |
| **Retraction of a produced result** | **Absent.** No analysis has been produced, and no mechanism would exist to retract or recompute a result if a participant withdrew |
| **Institutional or ethics approval record** | **Not established** | See §10 |
| **Data-processing register or inventory** | **Absent** | This document is the first attempt at one |

---

## 8. Why consent is required before recruitment

Voluntary, informed participation is a precondition, not an optional
refinement. Three reasons apply specifically to this project.

**8.1 The current behaviour is not voluntary participation.** Because the
population query filters on role and active status only, a study executed today
would include accounts that were created for ordinary product use or for
testing, and never asked to take part. Using a person's assessment results for
research without notice or agreement is not informed participation, regardless
of how the data is anonymised. **De-identification does not substitute for
consent.**

**8.2 The participant population is structurally disadvantaged.** Where
participants are students and the researchers are also teachers, instructors, or
administrators of the same institution, refusal is not obviously cost-free. A
student may reasonably fear that declining affects assessment or standing. For
participation to be voluntary, the invitation must make declining explicitly
easy, explicitly consequence-free, and visibly so.

**8.3 Withdrawal must be possible to make consent meaningful.** Consent that
cannot be withdrawn is not informed consent. Without a withdrawal route, a
participant could only consent to a permanent, unconditional use of their data.

---

## 9. What informed consent would need to contain

Proposed content, subject to approval. **None of this is implemented.**

- That assessment results and training completion may contribute to aggregate
  research statistics.
- The specific variables involved.
- That individual records are not published; only aggregate statistics are
  reported.
- That participation is **voluntary**, and that declining or withdrawing has **no
  effect** on access to the system, on assessment standing, or on any grade or
  evaluation.
- How to withdraw, and the point after which withdrawal is no longer possible.
- How long data will be retained.
- That results will be reported as **associations only**, and will not be
  presented as evidence of causation.
- That the analysis is exploratory and descriptive, with no significance testing.
- Who to contact with questions or concerns.
- That the participant may decline to answer any question without consequence.

---

## 10. Institutional and instructor approval

**This requirement is unresolved and cannot be satisfied from the repository.**

Before any participant data is collected, the following must be confirmed with
the supervising institution:

| Question to resolve | Status |
|---|---|
| Does institutional policy permit research use of student activity data? | **Unresolved** |
| Is formal research-ethics or institutional review required? | **Unresolved** |
| If so, what is the submission route and timeline? | **Unresolved** |
| Is instructor approval required to invite students? | **Unresolved** |
| Is instructor approval required to access assessment results for research? | **Unresolved** |
| What is the approved retention period? | **Unresolved** |
| Must participants be informed that instructors may see their results? | **Unresolved** |
| Does the institution require a data-processing agreement for the external email provider? | **Unresolved** |
| Is parental or guardian consent required for any participant? | **Unresolved** |
| What data-protection obligations apply to this jurisdiction and institution? | **Unresolved** |

Approval must be obtained in writing **before** recruitment begins. Proceeding
first and seeking approval afterwards would invalidate the consent obtained.

---

## 11. Existing research limitations

Recorded here so that a limitation register exists before results are produced,
rather than being written to fit whatever results emerge.

**Design limitations**

- Cross-sectional; no baseline, so no change or improvement can be measured.
- Correlational; no causal inference is possible.
- Latest-attempt selection introduces systematic bias toward improving
  participants.
- Self-selected exposure; the comparison between exposed and unexposed
  participants is confounded.
- No recorded confounders, so no adjustment is possible.
- Small institutional population, which affects achievable sample size.

**Measurement limitations**

- Both instruments are short, single-correct-answer recognition tasks of equal
  length, and may partly measure a shared capability. An apparent relationship
  between them could reflect overlapping item content.
- Neither instrument has undergone reliability or validity testing.
- Training Exposure has only four possible values and records completion rather
  than comprehension.
- Single-attempt scoring gives no estimate of measurement error.

**Analytical limitations**

- No measure of dispersion; only minimum, maximum, mean, and median.
- No inferential framework; **no significance testing, confidence intervals, or
  effect sizes**.
- Linear association only, on an ordinal exposure variable.
- No outlier screening or robustness checks.
- No correction for examining multiple relationships.

**Because no significance testing exists, no result may ever be described as
statistically significant, confirmed, or proven.**

---

## 12. Actions required before collecting participant research data

These are prerequisites. The research should not begin until each is resolved.

### 12.1 Blocking — must be completed before any data is collected

Every item below requires approval. The Owner column records who must act; the
final column records that no action has been taken.

| # | Action | Type | Owner | Status |
|---|---|---|---|---|
| B1 | Obtain written institutional and instructor approval for research use of student data (§10) | Governance | Supervisor / institution | **Not started** |
| B2 | Confirm whether ethics or institutional review is required and complete it | Governance | Supervisor | **Not started** |
| B3 | Implement a user-facing research consent mechanism, or a decision not to conduct research with participants | Product decision | Requires approval | **Not implemented** |
| B4 | Establish a defined, recruited participant cohort — replacing the current "all active user accounts" rule | Research design | Requires approval | **Not implemented** |
| B5 | Publish a privacy notice describing what is collected and why | Product decision | Requires approval | **Not implemented** |
| B6 | Define and document a data-retention policy, including what is deleted and when | Governance | Requires approval | **Not implemented** |
| B7 | Define and document the withdrawal procedure and its consequences | Governance | Requires approval | **Not implemented** |

### 12.2 Strongly recommended before recruitment

| # | Action | Type |
|---|---|---|
| R1 | Decide whether a deletion mechanism is required for account data, report data, or both | Product decision |
| R2 | Provide participants a route to obtain their own research records | Product decision |
| R3 | Document a breach-response procedure | Governance |
| R4 | Clarify the intended scope of the report free-text field and whether redaction is appropriate | Research decision |
| R5 | Establish who may hold administrator access, and separate administration from research access where possible | Governance |
| R6 | Confirm whether assessments are formative or summative, since this affects how participation may be perceived | Research decision |
| R7 | Document that research participation and product usage are separable in practice | Governance |

### 12.3 Documented limitation of this list

Adding a consent checkbox and a participant flag would **alter application
behaviour, the user data model, and the research population query.** These are
product and research decisions that require explicit approval and a supporting
specification. They are identified here as prerequisites; they are **not**
implemented by this documentation phase, and this document must not be read as
suggesting that any of them is in place.

---

## 13. Current governance position

De-identification of the research dataset is **implemented**, as is server-side
restriction of research data to administrators. Every consent, withdrawal,
deletion, retention, notice, and approval control is **absent**; the full list is
in §7. No participant data has been used for research.

The defensible current statement is:

> PhishGuard has built the technical capability to derive de-identified
> aggregate research statistics, and has restricted access to administrators on
> the server. It has not collected participant research data, has not obtained
> consent, and has not established a retention or withdrawal policy. The research
> programme is **proposed and pending governance approval**, and no findings
> exist.

---

## 14. Related documents

| Document | Content |
|---|---|
| `docs/problem-statement.md` | The problem, and the proposed/recruited distinction |
| `docs/research-questions.md` | Proposed questions and operational definitions |
| `docs/methodology-justification.md` | Design, method, biases, and why causation cannot be claimed |
| `docs/system-justification.md` | How the system addresses the problem, with honest limits |
| `specs/research-analytics-v1.md` | Approved specification, §11 (privacy), §12 (pseudonyms), §13 (export), §18 (security requirements), §22 (limitations) |
