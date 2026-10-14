# PhishGuard — System Justification

**Document status:** Phase 1 research documentation.
**Scope:** Justifies the implemented system against the problem defined in
`docs/problem-statement.md`.
**Research status:** **No participant data has been collected. No research
validation exists.** Nothing in this document asserts that PhishGuard has been
proven effective, that it outperforms other products, or that its research has
been validated.

---

## 1. What this document claims, and what it does not

This document makes two kinds of statement, and they are kept strictly apart:

**Claims of implementation** — what the software does. Each is supported by a
file path and, where useful, a function name in the source code.

**Claims of intent and reasoning** — why a design choice was made, and what
problem it addresses.

Three things are deliberately **not** claimed:

- **No effectiveness claim.** Nothing here states that PhishGuard improves
  awareness, identification ability, or reporting rates. No study has been
  conducted that could support such a statement.
- **No comparative claim.** No claim is made that PhishGuard is better than,
  more secure than, or more usable than any other product, tool, or training
  approach. No comparison was performed.
- **No research-validation claim.** The analytics module is an instrument for
  analysis, not evidence that an analysis has been carried out.

---

## 2. How PhishGuard addresses the identified problem

The problem statement in `docs/problem-statement.md` identifies five connected
gaps: difficulty recognising deceptive links, conflation of general knowledge
with specific recognition, absence of measurable awareness outcomes, an
unstructured reporting route that gives reviewers no shared criteria or audit
trail, and absence of any basis for evaluating outcomes.

PhishGuard addresses each with a distinct component:

| Problem | Component | Evidence |
|---|---|---|
| Deceptive links are hard to evaluate under time pressure | Deterministic URL analysis returning a risk classification and the indicators behind it | `apps/api/src/services/analysis.service.js`, `analysis.findings.js` |
| General knowledge and specific recognition are conflated | Two separately scored, separately keyed instruments | `awareness.service.js`, `phishingIdentification.service.js` |
| Awareness training is unmeasured | Server-authoritative scores and completion records | Assessment and training services |
| Reporting is unstructured and unreviewable | Report workflow with an enforced human review lifecycle | `apps/api/src/models/Report.js`, `reporting.service.js` |
| No basis to evaluate outcomes | Aggregate descriptive analytics over de-identified records | `researchAnalytics.dataset.js`, `researchAnalytics.statistics.js` |

The design principle throughout is that **automated assistance and human
judgement are separate and are never presented as one another.** Every
explanation delivered to a user is calibrated to avoid implying a certainty the
system does not have.

---

## 3. URL risk analysis — purpose

### 3.1 What it does

The analyzer applies ten deterministic lexical and structural checks to a
submitted URL. Each check is a recognisable property of a URL rather than a
reputation judgement:

suspicious keyword presence; excessive subdomain depth; punycode hostname;
non-standard port; percent-encoded characters; unusually long hostname; absence
of HTTPS; a bare IP address in place of a domain; unusual overall length; and an
`@` character, which can obscure the true destination.

Each check contributes a fixed score contribution. The contributions are summed
and mapped to a risk classification: a total of 50 or above is `high`, 25 or
above is `medium`, otherwise `low`.

### 3.2 Why a heuristic and not a reputation service

The decision to use deterministic local analysis rather than an external
reputation or threat-intelligence lookup was made for three reasons.

1. **Predictability and explainability.** Every finding can be traced to a named
   check with a fixed contribution. The user can be told exactly why a
   classification was produced.
2. **No external dependency or cost.** The analysis requires no third-party
   service, no API key, no network call, and no per-query charge. An automated
   test explicitly asserts that URL analysis makes **zero outbound network
   attempts**, including for loopback, private, and link-local targets — the
   system cannot be used to reach internal network resources through the
   analysis feature.
3. **Educational appropriateness.** A heuristic makes visible the specific
   structural features a user should learn to notice, which an opaque risk score
   from a black-box service would not.

This choice is a genuine trade-off, and it has a cost that must be stated
plainly: **a purely lexical and structural method cannot detect a
compromised-but-legitimate domain, a newly registered domain, or a hostile page
hosted on a well-known domain.** Those cases fall outside what any URL string can
reveal. The analysis narrows the decision, and the human review path exists
precisely because the analysis cannot close the question.

---

## 4. Explainable indicators — educational value

An unexplained verdict conveys no reason. A verdict paired with a specific,
reasons-giving indicator is designed to support transferable learning. That is a
**design intent, not a tested outcome**; this project contains no evidence about
what users actually learn from the explanations.

Each finding in the analysis carries a title, a score contribution, and a written
explanation. The explanations are deliberately two-sided: each states both why
the property is a recognised warning sign **and** why it also occurs on
legitimate sites. For example, the HTTPS finding explains that HTTPS protects
data in transit but that its presence does not establish that a website is
trustworthy; the punycode finding explains that punycode legitimately supports
internationalised domain names but can also enable visually deceptive hostnames.

Three consequences are intended from this design:

1. **Transferable reasoning rather than a bare verdict.** The intended skill is
   recognising the property in an unfamiliar context, rather than recognising
   one particular output label.
2. **Avoiding over-trust in the tool.** Because every indicator carries its
   legitimate-use caveat, a single finding is not presented as proof of malice.
3. **Honest self-description.** The analysis does not claim to detect phishing.
   It reports observable properties of a URL string and leaves the judgement
   where it belongs.

Findings are derived for presentation rather than stored, so the explanation
layer cannot drift out of step with the stored indicators.

---

## 5. Awareness and phishing identification assessments — role

The two assessments exist to make awareness measurable. Without a recorded
score, an institution has no measure of comprehension at all.

Two capabilities are **not** provided and should not be inferred from the
existence of the scores: the design supports neither **cohort comparison** nor
**change-over-time measurement**, because only the latest attempt per participant
is retained and no stratification is performed. See
`docs/methodology-justification.md` §5 and §8.3.

**Why two instruments rather than one.** A single combined score would blur two
capabilities that can diverge: knowing what a safe practice is in the abstract,
and recognising a diagnostic feature inside an actual message. Separating them
is what makes the question of whether general knowledge and specific recognition
move together answerable at all — the subject of RQ1.

**Why scoring is server-side.** Correct answers are held in frozen server
constants and excluded from the response that serves question content to the
browser. A client never receives the key and never supplies a score; the server
computes it from the submitted responses. This prevents a client from submitting
a score of its own choosing, and protects the measurement's integrity as a
research variable as well as its integrity as a product feature.

**What server-side scoring does not establish.** It does not establish *who*
completed the assessment, nor that the responses were the account holder's own
unaided work. The instrument is unproctored and self-administered, so guessing,
assistance, or completion by another person cannot be detected by this design.
See `docs/methodology-justification.md` §4.4.

**Calibrated language is required, and it is preserved.** The assessments are
project-specific instruments without formal psychometric validation. Their
scores are described as project measures, not as validated scales.

---

## 6. Training modules — purpose

Three modules cover recognising phishing indicators, password and
multi-factor-authentication security, and safe handling and reporting. Module
content is fixed and server-held.

**Why completion is recorded only on explicit server action.** Exposure must
measure deliberate engagement. If completion were inferred from viewing a page
or from elapsed time, the variable would measure incidental access rather than
completed learning, and it would not be defensible as a research measure.
Consequently, viewing content never advances the completion record; only an
explicit server-side completion action does.

**Why three fixed modules.** A small, fixed curriculum keeps exposure bounded,
comparable, and easy to interpret, at the cost of coarse granularity — a
limitation stated in `docs/methodology-justification.md` §4.3. The value of
training here is that it gives participants a standardised exposure to the same
material, which is what makes a comparison against assessment scores meaningful
in principle.

**No effectiveness is claimed.** That completing these modules improves any
measurement has not been tested. What is implemented is the delivery mechanism
and the exposure record.

---

## 7. Student reporting and human IT review

### 7.1 Why a structured reporting route

Sending an email to IT places the burden of triage on the reporter and gives the
recipient an unstructured item. Reporting inside PhishGuard attaches the
automated analysis as context and produces a record with a stable identifier and
a defined lifecycle.

### 7.2 Why the report is tied to an analysis

Requiring a report to reference a specific analysis means the reviewer receives
the heuristic result alongside the user's reason for reporting. It also
establishes a one-report-per-analysis-per-user constraint, enforced by a unique
index, which prevents duplicate submissions of the same item.

### 7.3 Why an immutable analysis snapshot

A report stores a frozen copy of the analysis as it stood at submission: the
URL, risk classification, score, and indicators. If the underlying analysis were
later modified or deleted, the reviewer's original evidence would be
undisturbed. For an audit trail this is a structural requirement rather than a
convenience.

### 7.4 Why the review lifecycle is enforced in the schema

The review state machine is enforced at the document level rather than only in
application code. A completed report cannot exist unless it carries a final
human assessment and reviewer attribution, and an unfinished report cannot carry
a non-pending assessment. This means an inconsistent review record cannot be
written even if application-layer validation were bypassed.

The supported lifecycle moves from submission to review to completion, with
claim, assignment, and priority controls. Assignment is restricted to
administrators; review actions are available to staff and administrators.

### 7.5 Why a human assessment is required

Automated heuristics cannot adjudicate an ambiguous report. The workflow requires
a reviewer to classify the report as phishing, suspicious, or no threat
identified before completion. A reviewer is therefore entitled — and expected —
to reach a different conclusion from the automated classifier, and the workflow
records that divergence rather than suppressing it.

**This separation is a core integrity property.** The automated analysis result
and the human assessment are distinct fields with distinct vocabularies, and
the system never presents one as the other. A human assessment of "no threat
identified" is a meaningful and recordable outcome, not a system failure.

### 7.6 Notifications

Message and completion notifications are sent to the relevant party through an
outbound transactional email provider. Notification is treated as
best-effort: an unexpected delivery failure is contained and never rolls back or
fails the underlying workflow, because a mail outage must not prevent a report
from being reviewed or closed.

---

## 8. Research analytics — value

### 8.1 What it is

An administrator-only module that derives aggregate statistics from records the
application already holds. It computes a cohort overview, descriptive statistics
for the two score variables, a Training Exposure distribution, and three pairwise
correlations, and exports a de-identified participant-level dataset as CSV.

### 8.2 Why it is justified

1. **It closes the measurement loop.** The application records awareness scores,
   identification scores, and training completion. Without aggregation, those
   records support only individual review. Aggregation is what makes aggregate
   outcome reporting possible at all.
2. **It is derived, not duplicated.** No analytics source of truth is persisted.
   Every figure is computed from the authoritative collections at read time, so
   an analytics figure cannot disagree with the underlying record.
3. **It is backend-authoritative.** All calculation occurs server-side. The
   frontend renders returned values and never recomputes a statistic, which
   prevents the displayed figure from diverging from the computed one.
4. **It is de-identified by construction.** Participant records carry only
   pseudonymous identifiers and the three research variables. Names, email
   addresses, account identifiers, and authentication data are not present in
   the dataset and cannot appear in an export.
5. **It is access-restricted.** Both endpoints require an authenticated
   administrator, enforced on the server. Frontend visibility is a usability
   control and is not treated as the security boundary.
6. **It discloses its own method.** The API returns methodology metadata that the
   interface renders, including the population rule, the missing-data rule, and
   an explicit statement that association does not establish causation.

### 8.3 What it is not

It is not a reporting dashboard with trend analysis, and it does not support
inferential conclusions. It is an exploratory descriptive instrument. Full
justification and its limits are in `docs/methodology-justification.md`.

**Its value at present is prospective.** The capability exists; no analysis has
been run. Its research value is contingent on the prerequisites in
`docs/ethics-and-data-governance.md`.

---

## 9. Limitations of heuristic URL analysis

Stated explicitly, because overstating this component would misrepresent the
system.

### 9.1 The score is not a probability

The output is a weighted sum of ten indicator contributions divided into three
bands. It is **not** a probability of compromise, **not** a confidence value,
**not** a likelihood, and **not** calibrated against any observed base rate. A
score of 60 is not "60% likely to be malicious." No such calibration exists and
none is claimed.

### 9.2 Low risk is not proof of safety

A `low` classification means few warning properties were detected in the URL
string. It does not mean the URL is safe. Phishing pages hosted on well-known
domains, compromised legitimate sites, and pages whose only deception is in the
message content rather than the URL will typically produce few or no
indicators.

### 9.3 High risk is not proof of phishing

A `high` classification indicates several warning properties. It does not
establish that the URL is malicious. Many legitimate services use layered
subdomains, long paths, non-standard ports, and internationalised domains. Every
finding's explanation states its legitimate-use case for this reason.

### 9.4 It is not malware detection

The analyzer performs no download, no content inspection, no sandboxing, and no
file analysis. It cannot detect malicious content served by a URL.

### 9.5 It has no external intelligence

It has no reputation database, no blocklist, no domain-age information, and no
threat feed. It cannot recognise a newly registered or previously seen
compromised domain.

### 9.6 It cannot assess the surrounding message

Phishing frequently relies on context — an unexpected invoice, a fake deadline,
a claimed IT request — that does not appear in the URL. The analyzer sees only
the URL the user chose to submit.

### 9.7 Correct operational consequence

The output is a **prompt to pause and think, and a reason to report** — not a
verdict. Its design is consistent with this: it returns reasons rather than
conclusions, and the human review workflow exists because the classification
cannot close the question.

---

## 10. Why the implemented architecture fits the project's scope

The stack is MongoDB, Express.js, React, and Node.js.

### 10.1 Why this stack

**MongoDB.** The workload is document-shaped: an assessment submission is a set
of answers with a score; a report is a record with a mutable workflow state and
an immutable embedded evidence snapshot. Documents map to these naturally
without a separate join layer. Flexible fields suit an instrument that may need
revision between iterations.

**Express.js.** The system is a JSON API consumed by a single first-party
client. Express's middleware model directly expresses the required security
chain — authentication, then authorisation, then rate limiting, then validation,
then the controller — making the security posture explicit and reviewable rather
than distributed across handler code.

**React.** The interface is a collection of authenticated, stateful pages that
consume JSON. React's component model suits this.

**Node.js.** One language across both tiers reduces the surface for
inconsistency and simplifies deployment.

### 10.2 Architectural characteristics that support the scope

| Characteristic | Evidence | Why it fits |
|---|---|---|
| Layered separation | Routes → middleware → controllers → services → models | Business rules live in services and are testable without HTTP. Research statistics are computed in a pure module with no database or framework dependency, so every figure is directly unit-testable |
| Server-side authority | Roles re-read from the account on every protected request; assessment scoring server-side; registration cannot assign a role | Security-relevant and research-relevant values cannot be set by a client |
| Object-level authorisation | Ownership constraints on analyses, reports, and messages | Prevents access to other users' records independently of role |
| Schema-level integrity | Enum constraints, immutability, unique indexes, and a document-level validation hook on the report workflow | Data integrity is enforced by the database layer, not only by application code |
| Purpose-built indexes | Including a compound unique ticket index, an owner-history index, and a review-queue index aligned with the queue's sort order | Supports the query patterns the application actually issues |
| Role-restricted access | Research analytics restricted to administrators on the server | Sensitive aggregate data is restricted at the security boundary |
| Aggregation for review queue | A MongoDB aggregation pipeline with joins and deterministic ordering | Retrieves the review queue and its related records in one round trip |
| Minimal external dependency | No analytics or tracking dependency, and no external script loaded from a CDN; the only third-party client libraries are bundled animation and 3D rendering. URL analysis itself makes no outbound calls. The single outbound third-party integration is the transactional email provider, used for password reset and report notifications | Reduces third-party surface in a security-awareness product |
| Honest naming in the data model | Report workflow state and human assessment stored separately from the automated risk result | Prevents the two concepts from being conflated in storage or in display |

### 10.3 Honest architectural limitations

Stated so that scope justification is not mistaken for a claim of completeness:

- **Rate limiting is in-process.** Counters are held in memory on a single
  application instance. They are not shared across replicas and reset on
  restart. This is adequate for a single-instance deployment and would require a
  shared store before horizontal scaling. **The actual deployed topology is not
  verifiable from this repository.**
- **Deployment manifests are not in the repository.** The deployed environment is
  configured outside version control. Deployment cannot be reproduced from the
  repository alone.
- **Continuous integration is not configured.** Verification is harness-driven
  rather than automatic.
- **Visualisation of analytics is minimal.** Results are presented as tables. No
  charting is implemented.
- **Authentication relies on a single factor.** Multi-factor authentication is
  not implemented, although it is covered as curriculum content in one training
  module.
- **Session handling is client-side on logout.** There is no server-side logout
  endpoint, and the session token is held in browser local storage rather than a
  cookie unavailable to scripts.

These are recorded in the assessment readiness audit and are stated here because
a justification document that omitted them would misrepresent the system.

---

## 11. Summary of justified claims

| Component | Implementation verified | Effectiveness claimed? |
|---|---|---|
| URL heuristic analysis | Yes | **No** — documented limitations in §9 |
| Explainable findings | Yes | **No** |
| Two separate assessments | Yes | **No** |
| Server-authoritative scoring | Yes | **No** |
| Three training modules with explicit completion | Yes | **No** |
| Structured reporting and human review | Yes | **No** |
| Immutable evidence snapshot and enforced workflow | Yes | **No** |
| De-identified aggregate analytics | Yes | **No** — capability exists, no analysis performed |
| Research validation | **Nothing exists** | **No** |

The system is justified as a coherent implementation addressing a defined
problem. It is not justified, and must not be presented, as a validated or
proven intervention.

---

## 12. Related documents

| Document | Content |
|---|---|
| `docs/problem-statement.md` | The problem this system addresses |
| `docs/research-questions.md` | Proposed questions — explicitly unanswered |
| `docs/methodology-justification.md` | Design, method, and limitations |
| `docs/ethics-and-data-governance.md` | Data handling and prerequisites before recruitment |
| `specs/research-analytics-v1.md` | Approved analytics specification |
| `specs/reporting-v1.md` | Approved reporting specification |
| `specs/explainable-url-analysis-v1.md` | Approved explainability specification |
