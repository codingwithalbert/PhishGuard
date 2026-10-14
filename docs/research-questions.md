# PhishGuard — Research Questions

**Document status:** Phase 1 research documentation.
**Research status:** **Proposed only. No participant data has been collected and
no findings exist.**
**Nature of the questions:** Exploratory and correlational. These questions
concern **association**, not causation.

---

## 1. Status disclaimer

The questions below are **proposed**. They have not been answered.

PhishGuard has not recruited participants, has not obtained consent, and has not
collected a research dataset. No statistical result, effect estimate,
participant count, or conclusion is reported anywhere in this document. Any
figure appearing here describes the **measurement design**, never an observed
result.

The analytics machinery required to answer these questions is implemented and
tested. What is missing is the data, the ethics and governance prerequisites, and
the analysis execution described in `docs/ethics-and-data-governance.md`.

---

## 2. Research variables — operational definitions

Operational definitions below are taken from the running implementation. Each
variable is server-derived and cannot be set or altered by a client.

### 2.1 Cybersecurity Awareness Score

| Property | Value | Source |
|---|---|---|
| Instrument | 10 multiple-choice questions, four options each (A–D), one correct answer | `apps/api/src/services/awareness.service.js` (`AWARENESS_TOTAL_QUESTIONS = 10`) |
| Content | Password practices; purpose of multi-factor authentication; safe response to an urgent login link; not sharing passwords or verification codes; value of software updates; risk on untrusted networks; refusing unsolicited password requests; handling unexpected attachments; responding to a suspected account compromise; the purpose of reporting suspicious activity to appropriate personnel | Same file, question bank |
| Scoring | `rawScore` = number of correct answers (0–10); `score = (rawScore / 10) × 100`, range 0–100 | `scoreAwarenessAnswers()` |
| Answer-key protection | The key is a deep-frozen server constant and is excluded from the response that serves questions to the browser | `getAwarenessQuestions()` projects only `questionId`, `text`, `choices` |
| Attempt selection | **Latest** completed attempt, ordered by `completedAt` descending, then `_id` descending as a deterministic tie-breaker | `LATEST_ATTEMPT_SORT` in `apps/api/src/services/researchAnalytics.dataset.js` |
| Missing value | `null` when the participant has never completed the assessment | `createParticipantRecord()` |
| Storage | `rawScore` 0–10, `score` 0–100, `totalQuestions` fixed at 10, `completedAt` recorded | `apps/api/src/models/AwarenessAssessment.js` |

### 2.2 Phishing Identification Score

| Property | Value | Source |
|---|---|---|
| Instrument | 10 message scenarios, each with a four-option multiple-choice question (A–D), one correct answer | `apps/api/src/services/phishingIdentification.service.js` (`PHISHING_IDENTIFICATION_TOTAL_SCENARIOS = 10`) |
| Content | A presented message (for example, a display name that differs from the sender domain) plus the question "Which detail is the strongest phishing indicator?" | Same file, scenario bank |
| Scoring | `rawScore` = number of correct answers (0–10); `score = (rawScore / 10) × 100`, range 0–100 | `scorePhishingIdentificationAnswers()` |
| Answer-key protection | As above — the key is never serialised to the client | `getPhishingIdentificationScenarios()` |
| Attempt selection | **Latest** completed attempt, same ordering rule as above | `researchAnalytics.dataset.js` |
| Missing value | `null` when the participant has never completed the assessment | `createParticipantRecord()` |
| Storage | Mirrors the awareness assessment structure | `apps/api/src/models/PhishingIdentificationAssessment.js` |

**Distinction from Awareness Score.** The Awareness assessment targets general
knowledge and correct practice. The Phishing Identification assessment targets
recognition of the most diagnostic indicator within a specific message
scenario. They are separate instruments with separate answer keys and separate
scores. Their measurement properties are discussed in
`docs/methodology-justification.md` §4.

### 2.3 Training Exposure

| Property | Value | Source |
|---|---|---|
| Underlying unit | Completion of a fixed set of **three** training modules | `apps/api/src/services/training.service.js` (`TRAINING_TOTAL_MODULES = 3`) |
| Curriculum | (1) Recognizing Phishing Indicators; (2) Password and MFA Security; (3) Safe Handling and Reporting | `TRAINING_MODULES` |
| Completion semantics | Recorded only by an explicit server-side completion action; never inferred from viewing content or elapsed time | Training service and its specification |
| Formula | `Math.round((completedModules / 3) × 10000) / 100` | `calculateTrainingExposure()` |
| Realised values | **0, 33.33, 66.67, 100** | `TRAINING_EXPOSURE_LEVELS` in `researchAnalytics.dataset.js` |
| Missing value | Never `null`. A participant who has completed nothing has a measured exposure of `0`, which is a **real value, not missing data** | `createParticipantRecord()`; approved specification §5 |
| Storage | One document per user-module pair, unique-indexed, with `completedAt` and timestamps | `apps/api/src/models/TrainingCompletion.js` |

**Note on measurement granularity.** Training Exposure takes only four distinct
values. It is therefore a coarse ordinal measure with a bounded range, not a
continuous dosage variable, and it records completion rather than engagement or
learning. Its consequences for analysis are addressed in
`docs/methodology-justification.md` §4.3, and the ordinal-treatment consequence in
§8.3.

### 2.4 Research population

| Criterion | Rule | Source |
|---|---|---|
| Role | `role === "user"` only; `staff` and `admin` are excluded | `RESEARCH_PARTICIPANT_ROLE`, `isEligibleResearchUser()` |
| Account state | `isActive === true` only; inactive accounts are excluded | Same |
| One record per participant | Each eligible account contributes exactly one research record | `buildResearchParticipantDataset()` |
| Pseudonymous identifier | `PG-R0001`, `PG-R0002`, … assigned in deterministic account-creation order; transient, never persisted, never an authentication identifier | `formatParticipantId()`, `PARTICIPANT_ORDER_SORT` |

**Pending verification.** Whether this population is the *intended* research
population is an open decision. The current rule selects by role and active
status only, and would include every active student account, including accounts
created for unrelated testing. Recruitment scope requires a decision — see
`docs/ethics-and-data-governance.md` §12.1 (B3, B4).

---

## 3. The proposed research questions

### RQ1 — Awareness and phishing identification

> **RQ1:** What is the relationship between cybersecurity awareness scores and
> phishing identification scores among participants in the research population?

- **Variables:** Awareness Score (0–100), Phishing Identification Score (0–100)
- **Units of analysis:** One record per eligible participant
- **Addressing mechanism:** Pairwise-complete observations; participants lacking
  either measurement are excluded from this specific calculation
- **Planned treatment of undefined values:** Where the coefficient cannot be
  mathematically defined, the implementation returns `null` rather than a
  fabricated number. Reporting `null` is a valid and expected outcome, not a
  failure.
- **Not established:** The direction, magnitude, or existence of any
  relationship. No hypothesis is stated, and none should be inferred.

### RQ2 — Training exposure and awareness

> **RQ2:** What is the relationship between training exposure and cybersecurity
> awareness scores among participants in the research population?

- **Variables:** Training Exposure (0 / 33.33 / 66.67 / 100), Awareness Score
  (0–100)
- **Units of analysis:** One record per eligible participant
- **Addressing mechanism:** Pairwise-complete observations
- **Planned treatment of undefined values:** `null` where undefined
- **Not established:** Whether exposure is associated with awareness score at
  all, and if so in which direction. No hypothesis is stated.

### RQ3 — Training exposure and phishing identification

> **RQ3:** What is the relationship between training exposure and phishing
> identification scores among participants in the research population?

- **Variables:** Training Exposure (0 / 33.33 / 66.67 / 100), Phishing
  Identification Score (0–100)
- **Units of analysis:** One record per eligible participant
- **Addressing mechanism:** Pairwise-complete observations
- **Planned treatment of undefined values:** `null` where undefined
- **Not established:** As RQ2. No hypothesis is stated.

---

## 4. Scope of the claims these questions permit

### 4.1 What an answer would mean

A result from RQ1–RQ3 would describe **the observed statistical association among
available participant measurements**. Phrasing such a result as an observed
association between the available measurements is accurate and appropriate.

### 4.2 What an answer would not mean

Even with a large and clean dataset, results from RQ1–RQ3 would **not** support
any statement that:

- completing training *causes* higher awareness or identification scores;
- training is *effective*;
- training exposure *improves* security behaviour;
- a reported association would persist under a different population or period;
- the association is statistically significant.

The approved specification explicitly excludes significance testing, and the
implementation provides no p-value, confidence interval, or effect size.
**Statistical significance cannot be claimed, and it is not claimed here.**

### 4.3 Why association is not causation

The design cannot support causal inference. The reasons are structural, not
remediable by increasing sample size:

1. **No randomisation.** Exposure is determined by whether a user chose to
   complete modules, and completion is not randomly assigned.
2. **No baseline.** Only the *latest* assessment attempt is used. There is no
   pre-exposure measurement, so no change can be measured and no
   before-and-after comparison is possible.
3. **No temporal ordering rule in the analysis.** Exposure is evaluated as a
   static snapshot rather than as a time-ordered sequence.
4. **Confounding is uncontrolled.** Prior cybersecurity knowledge, prior
   training, computing experience, or motivation may influence both exposure and
   assessment scores, and none of these are recorded.
5. **Self-selection.** Participants who complete training modules may differ
   systematically from those who do not.

A complete treatment appears in `docs/methodology-justification.md` §11.

---

## 5. Questions explicitly excluded from the current design

These are common and reasonable questions that the current instruments and data
model **cannot** answer. Listing them prevents accidental overreach in reporting.

| Excluded question | Why it cannot be answered |
|---|---|
| Does training improve awareness scores? | Requires baseline/pre-post measurement and preferably random assignment |
| Is there a difference between high- and low-exposure groups? | Requires inferential group comparison, which is out of approved scope |
| Are the associations statistically significant? | No significance testing is implemented or approved |
| Does training reduce real-world phishing susceptibility? | No behavioural or outcome data is collected |
| Does awareness score predict reporting behaviour? | The reporting behaviour itself is not a research variable |
| Do participant demographics relate to scores? | Demographic variables are not recorded |
| Which training module has the greatest effect? | Exposure is measured only as a total count, not per module |

The last row deserves emphasis: the data model *does* record per-module
completion with timestamps, but the analytics layer deliberately reduces this to
a three-part count. A per-module or time-ordered analysis is therefore a
**possible future extension requiring a new approved specification**, not a
current capability.

---

## 6. Standing of these questions

| Element | Status |
|---|---|
| The questions themselves | Proposed |
| Operational variable definitions | Implemented and verified in source code |
| Instrumentation for the variables | Implemented and verified |
| Analysis method | Implemented, unit-tested; documented in `docs/methodology-justification.md` |
| Participant recruitment | **Not started** |
| Informed consent | **Not implemented** |
| Data collection | **Not started** |
| Execution of the analysis | **Not performed** |
| Findings | **Do not exist** |

---

## 7. Related documents

| Document | Content |
|---|---|
| `docs/problem-statement.md` | The problem these questions address |
| `docs/methodology-justification.md` | Design, method selection, and limitations |
| `docs/system-justification.md` | How the implemented system addresses the problem |
| `docs/ethics-and-data-governance.md` | Conditions that must be met before recruitment |
| `specs/research-analytics-v1.md` | Approved specification, §9 (relationships), §11–§13 (privacy, pseudonyms, export) |
