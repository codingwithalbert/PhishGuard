# PhishGuard — Methodology Justification

**Document status:** Phase 1 research documentation.
**Research status:** **No participant data has been collected. No analysis has
been executed. No findings exist.**
**Constraint:** This document does not introduce inferential statistics and does
not claim statistical significance. Both are outside the approved specification
and are not implemented.

---

## 1. What this document does and does not cover

This document justifies the *proposed* research design and documents the *actual*
measurement and computation behaviour found in the source code.

Throughout, a distinction is maintained between:

- **Implemented** — exists in the repository, verifiable by file and function.
- **Planned** — required to execute the study but not yet performed.
- **Requires approval** — would require a new approved specification before it
  could be built.

Where the implemented analysis differs from ideal research practice, the
difference is stated plainly rather than presented as a strength.

---

## 2. Proposed research design

### 2.1 Design classification

The proposed study is:

| Property | Classification | Rationale |
|---|---|---|
| Approach | **Quantitative** | All three variables are numeric and derived from scored instrument responses or completion counts |
| Time structure | **Cross-sectional** | All measurements are taken at a single point in time; no repeated or pre-post observation is analysed |
| Purpose | **Exploratory** | The questions investigate whether relationships are present in available data, without pre-specified directional hypotheses |
| Analysis strategy | **Correlational** | Relationships are examined through a single correlation coefficient per variable pair |

### 2.2 Why cross-sectional

A cross-sectional design was selected because it matches the data the application
actually records, and because it is the design the approved specification
authorises.

A longitudinal or pre-experimental design would be preferable if the objective
were to evaluate change over time. It was not selected because:

- the analytics module analyses only the **latest** assessment attempt per
  participant, so no baseline is available in the analytical dataset;
- exposure is summarised as a count of completed modules rather than a dated
  sequence of events;
- a pre-exposure measurement does not exist, because participants may complete
  training before, during, or after any assessment attempt.

**This is a substantive limitation, not a neutral simplification.** The design
therefore cannot measure change, improvement, or effect. It is stated again in
§11.

### 2.3 Why exploratory

The questions were not derived from pre-specified directional hypotheses, and no
theoretical model was used to predict the sign or magnitude of any relationship.
The analysis is therefore exploratory: it describes what is present in the data
without testing a pre-existing expectation.

An exploratory analysis of this kind is vulnerable to capitalising on chance when
many relationships are examined. With three relationships, this risk is modest,
but it is noted in §8.3 rather than dismissed.

---

## 3. Research population and inclusion criteria

### 3.1 Implemented criteria

The population query is implemented in
`apps/api/src/services/researchAnalytics.dataset.js`
(`buildResearchParticipantDataset()`).

| Criterion | Rule | Effect |
|---|---|---|
| Role | `role === "user"` | Excludes `staff` and `admin` |
| Account state | `isActive === true` | Excludes deactivated accounts |
| Records per participant | Exactly one | Collapsed from potentially many assessment attempts |
| Record identity | Transient pseudonym `PG-R0001`, … | Deterministic order by account creation time, then `_id` |
| Direct identifiers | Never retained | Name, email, and ObjectId are not carried into the research dataset |

### 3.2 Rationale for exclusion of privileged accounts

Staff and administrators are privileged accounts with different usage patterns,
and would not be comparable to the student cohort. They are also the reviewers
who would administer a study, so including them would confound the participant
and observer roles and would place privileged accounts inside a research dataset
without a research purpose.

### 3.3 Open decision — recruitment scope

The implemented rule selects **by role and active status only**. It contains no
consent flag, no participation flag, and no cohort marker. Consequently, it
would include every active student account, including any created for testing or
demonstration.

**This is a blocking decision, not a defect to be noted and accepted.** Until
recruitment scope is decided and a participation mechanism exists, the dataset
cannot be considered a research sample. See `docs/ethics-and-data-governance.md`
§12.1 (B3, B4).

---

## 4. Variable measurement

Full operational definitions, with the content of each instrument, are given in
`docs/research-questions.md` §2. This section addresses measurement adequacy.

### 4.1 Cybersecurity Awareness Score

Ten multiple-choice items, each with one correct answer, scored as
`(rawScore / 10) × 100`. The resulting scale takes eleven values: 0, 10, 20, …,
100.

**Measurement limitations.**

- **Short scale.** Eleven attainable values constrain resolution and reduce
  sensitivity to small differences between participants.
- **Unvalidated instrument.** The item bank was authored for this project. No
  construct validity, criterion validity, or reliability analysis has been
  performed. The score should be described as a project-specific measure, not as
  a validated scale with established psychometric properties.
- **Coverage.** The bank addresses password practice, multi-factor
  authentication, response to urgent requests, software updates, untrusted
  networks, and attachment handling. It does not cover social engineering
  beyond messaging, physical security, data handling, or legal or regulatory
  obligations.

### 4.2 Phishing Identification Score

Ten message scenarios, each with a four-option question asking for the strongest
phishing indicator, scored on the same basis.

**Measurement limitations.**

- **Response format.** Every item has one correct answer and no partial credit.
  This measures recognition of a designated correct feature, which is not the
  same as realistic judgement under uncertainty.
- **Scenario homogeneity.** All items follow one pattern — a presented message
  plus a single-select question. Performance on this format does not
  automatically transfer to multi-channel, time-pressured, or multi-step
  encounters, which are the conditions in which users actually encounter
  phishing.
- **Construct overlap with Awareness Score.** Both instruments are
  single-correct-answer recognition tasks of equal length, and the Awareness
  bank contains at least one item requiring the respondent to recognise a
  suspicious message and choose a safe response. The two scores may therefore
  partly measure a shared capability. **This has a direct methodological
  consequence for RQ1:** an association between them could reflect overlapping
  item content rather than a distinct relationship between two separate
  constructs. Formal measurement of this overlap has **not** been performed and
  would require a separate approved analysis.

### 4.3 Training Exposure

`Math.round((completedModules / 3) × 10000) / 100`, taking exactly four values:
0, 33.33, 66.67, 100.

**Measurement limitations.**

- **Coarse ordinal scale.** Four levels is a very limited exposure variable.
  Exposure is discrete, and its four levels are spaced by equal 33.33-point
  increments only because the three modules are weighted identically. Treating
  it as a continuous quantity in a correlation therefore assumes equal weighting
  and equal-interval spacing, which the measure does not independently
  establish.
- **Counting is not dosing.** Completing a module records that it was
  completed; it does not record time spent, comprehension, or retention. It is a
  record of completion, not of engagement or learning.
- **Order and timing are discarded by the analysis.** The underlying collection
  stores a completion timestamp per module and enforces uniqueness per
  user-module pair, but the analytics layer reduces this to a count. Sequencing
  information is therefore available in the database yet unused.

  This is worth stating plainly: the data model *could* support a richer
  longitudinal or per-module analysis. The current specification deliberately
  does not use it. Extending the analysis in that direction would **require a
  new approved specification** and is out of scope for this document.

### 4.4 Server authority

All three variables are computed server-side. The answer keys are deep-frozen
server constants excluded from responses that serve instrument content, and the
completion count derives from server-recorded completion actions. A client
cannot submit a score of its own choosing. This protects measurement integrity
against trivial tampering, which is a genuine strength and is verified by
automated tests.

**The limit of that protection.** Server-side scoring prevents a client from
submitting an arbitrary *score*. It does **not** establish that the assessment
was completed independently, or establish who completed it. The instrument is
unproctored and self-administered: a client may submit guessed responses, may be
completed by someone other than the account holder, or may be resumed across
sittings. Any inference drawn from a score therefore rests on the assumption
that responses reflect the account holder's own unaided understanding. That
assumption cannot be verified by the current design.

---

## 5. Assessment selection rule

Where a participant has multiple assessment attempts, **one** attempt is
selected.

| Rule | Implementation |
|---|---|
| Ordering | `completedAt` descending, then `_id` descending as a deterministic tie-breaker |
| Rationale | Deterministic ordering ensures repeated runs on unchanged data return identical results, so a reported figure is reproducible and not dependent on insertion order or timing |
| Consistency | The same ordering is used by the assessment and progress services, so the research figure cannot silently disagree with what a user sees elsewhere in the application |

**Limitation — latest-attempt bias.** Selecting the latest attempt
systematically favours higher scores in participants who improve across
attempts, and systematically reflects a bad final attempt in participants who
decline. This is a known property of the design and is not correctable within the
current specification. It affects every score-based variable and should be
disclosed in any reporting of results.

---

## 6. Missing-data rules

| Situation | Treatment | Rationale |
|---|---|---|
| Assessment never completed | Variable is `null` | A missing measurement is recorded as missing; it is never substituted, imputed, or estimated |
| Training not started | Training Exposure is `0` | A genuine measured value, not missing data |
| Participant present in cohort but absent from a statistic | Excluded from that statistic only | Each statistic uses only participants with an available value for the variable in question |
| Sample with no available values | `n = 0`, all statistics `null` | Zero is never fabricated as a statistic |

**Rules for specific calculations.**

- Descriptive statistics use only participants with a non-null value for that
  variable.
- Correlation uses only participants with non-null values for **both** variables
  in that pair — pairwise-complete analysis, not listwise deletion across the
  whole dataset.
- Every aggregate result reports its applicable sample size.

**Strength.** These rules are implemented rather than merely intended, and are
covered by automated tests.

**Limitation.** Missingness here is almost certainly not random. A participant
who never completes an assessment may differ systematically from one who does —
for example in motivation, available time, or perceived relevance. Because the
mechanism is unknown and unmeasured, pairwise-complete deletion may introduce
bias. No missingness analysis is implemented, and adding one would **require
approval**.

---

## 7. Descriptive statistics

### 7.1 Implemented

For Awareness Score and Phishing Identification Score, the implementation
computes sample size, mean, median, minimum, and maximum
(`computeDescriptiveStatistics()` in
`apps/api/src/services/researchAnalytics.statistics.js`).

| Statistic | Implementation detail |
|---|---|
| Sample size (`n`) | Count of finite numeric observations |
| Mean | Arithmetic mean, rounded to 2 decimal places |
| Median | Standard median; even samples average the two central values, rounded to 2 decimal places |
| Minimum / Maximum | Smallest and largest retained observation |
| Empty sample | `n = 0`, all statistics `null` |

Non-finite values are excluded from the observation list rather than propagated.
An undefined statistic is reported as `null` and never as `NaN`, `Infinity`, or a
fabricated zero.

A Training Exposure distribution is also produced, giving participant counts at
each of the four realised levels.

### 7.2 Justification for the selected statistics

Descriptive statistics are appropriate here because the immediate requirement is
to characterise a cohort before relationships between variables are examined.
Reporting the centre of a score distribution alongside its minimum, maximum, and
sample size gives a reader enough information to judge how much variation exists
and whether a correlation would be computed over a plausibly spread sample.

Reporting a distribution by category is appropriate for Training Exposure because
the variable takes four discrete values; counts per level describe the cohort
more honestly than a single mean would.

### 7.3 Limitations of the descriptive statistics

**These are the limitations most likely to be raised, and they are not
cosmetic:**

1. **No measure of dispersion.** Standard deviation, variance, interquartile
   range, and confidence intervals are **not implemented**. Reporting only
   min, max, mean, and median gives no direct indication of spread beyond the
   extremes. A cohort consisting almost entirely of one score and a single
   outlier would produce the same mean as a broadly distributed cohort.
2. **Min and max are highly sensitive to individual observations** and are
   unstable in small samples.
3. **No standard error**, so the precision of the mean cannot be assessed.
4. **Rounding is fixed** at two decimal places for the mean and median and three
   for the correlation. In a very small sample this can imply a precision the
   data does not support. Rounding is applied backend-side for consistency, as
   the specification requires.
5. **No distributional assessment.** There is no normality check, and none
   should be inferred: with two bounded, eleven-valued discrete scores and a
   four-valued exposure variable, distributional assumptions are weak at best.

---

## 8. Pearson correlation

### 8.1 Implemented

For each of the three variable pairs, the implementation computes a Pearson
product-moment correlation coefficient over pairwise-complete observations
(`computePearsonCorrelation()` in
`apps/api/src/services/researchAnalytics.statistics.js`).

| Rule | Implementation detail |
|---|---|
| Coefficient | Pearson product-moment correlation |
| Observations | Pairwise-complete; pairs with a non-numeric or non-finite member are dropped |
| Sample size | The applicable `n` is returned with every result |
| Undefined cases | Returns `null` for fewer than two paired observations, for zero variance in either variable, and for any non-finite result |
| Rounding | 3 decimal places |
| Labelling | **No qualitative label is attached.** The implementation does not classify a coefficient as strong, moderate, weak, good, bad, significant, or insignificant |

The undefined cases are handled deliberately rather than accidentally. Pearson
correlation is undefined when a variable has no variation at all — for example,
if every participant has identical training exposure. Returning `null` is the
mathematically correct response, and returning a fabricated number in that case
would be actively misleading.

### 8.2 Justification

Pearson correlation is chosen because the research questions ask what
relationships exist among the variables, and the coefficient summarises the
strength and direction of a linear association in a single interpretable
quantity.

Crucially, **Pearson correlation is chosen as a descriptive summary only.** It is
not used here as an inferential test, and the absence of an associated test is
not an oversight concealed by the report — it is an approved exclusion.

### 8.3 Limitations of the current statistical methods

These are the substantive methodological weaknesses and should be disclosed
alongside any result.

1. **No inferential framework.** No p-value, confidence interval, significance
   test, or effect size is computed. It is therefore impossible to state
   whether any observed association is distinguishable from chance, or how
   precisely it has been estimated. **Statistical significance cannot be
   claimed.** The approved specification places significance testing explicitly
   out of scope, and the implementation honours that.
2. **Linear association only.** Pearson correlation does not detect curvilinear
   relationships, and with a four-level ordinal exposure variable a linear
   summary may misrepresent the pattern entirely.
3. **Small-sample distortion.** The coefficient is highly unstable in small
   samples, and can appear large or near ±1 from very few observations. Because
   no minimum-`n` threshold or stability check is implemented, a large reported
   coefficient from a very small sample is possible. Reporting `n` alongside
   every coefficient mitigates this but does not eliminate it.
4. **Sensitivity to outliers.** The coefficient is notably sensitive to
   outlying observations. No outlier screening is performed, and no sensitivity
   analysis is available.
5. **No confounding control.** A raw correlation includes every confounder
   present in the data. No stratification, adjustment, or regression is
   performed, so the reported coefficient is an unadjusted association.
6. **Ordinal variable treated as interval.** Training Exposure is ordinal with
   four levels but is analysed as a continuous quantity. This is a known
   approximation, not a neutral choice.
7. **Multiple comparisons.** Three relationships are examined. Without any
   correction or test, the analysis has no protection against chance patterns —
   one of the reasons the exploratory framing in §2.3 matters.
8. **No robustness checks.** No alternative coefficient, no split-sample
   analysis, and no outlier-exclusion rerun are implemented.

---

## 9. Potential biases

| Bias | Present? | Description |
|---|---|---|
| Self-selection | **Yes** | Participants who choose to complete training may differ from those who do not. Exposure is never randomly assigned, so the two groups may have differed before training began. This is the single most serious threat to interpreting RQ2 and RQ3. |
| Latest-attempt bias | **Yes** | Always using the most recent attempt systematically favours improving participants and penalises declining ones (§5) |
| Construct overlap | **Yes** | Awareness and Phishing Identification scores may partly measure a shared capability, which could inflate any observed RQ1 association (§4.2) |
| Exposure misclassification | **Yes** | Completion is recorded, not comprehension. A participant may complete without engaging |
| Non-random missingness | **Likely** | Participants who never attempt an assessment may differ systematically from those who do (§6) |
| Instrument validity | **Unknown** | Neither instrument has undergone reliability or validity testing (§4.1) |
| Survivorship of active accounts | **Possible** | Only `isActive === true` accounts are included; if account deactivation correlates with disengagement, the cohort is filtered |
| Temporal confound | **Unquantified** | Participants who joined earlier may have had different exposure opportunities |
| Measurement and response bias in the instruments | **Possible** | Single-correct-answer recognition items may reward test familiarity rather than genuine skill |

Neither research variable is self-reported: both scores derive from scored
instrument responses and exposure derives from completion records. Recall and
social-desirability bias therefore do not arise under the current design. They
would become relevant only if self-reported measures were added later.

**Confounders not recorded at all:** prior cybersecurity training, computing
experience, security role, motivation, and frequency of encountering phishing.
Their absence means confounding cannot be adjusted for even in principle with
the current data model.

---

## 10. Sample-size reporting

Every aggregate result returns its applicable `n`, and this is a deliberate
design requirement rather than incidental behaviour.

A coefficient without its sample size is close to uninterpretable: `r = 0.7` over
four observations and `r = 0.7` over four hundred are not comparable, and
reporting only the coefficient would misrepresent both. Sample size is therefore
returned alongside every descriptive statistic and every correlation, and the
frontend is required to display it.

**Limitation.** No minimum sample size, power analysis, or precision target is
defined. Whether the achieved cohort is adequate for stable correlation cannot
be determined until data exists. **Pending verification.**

---

## 11. Why association cannot establish causation

The implemented analysis produces an unadjusted correlation among three
variables measured at a single point in time. It has no design feature capable
of supporting a causal claim.

| Requirement for causal inference | Present in this design? |
|---|---|
| Random assignment of exposure | **No** — self-selected |
| Baseline measurement before exposure | **No** — only the latest attempt is used |
| Temporal ordering of exposure and outcome | **Not analysed** — exposure is a static count |
| Control of confounding variables | **No** — confounders are neither recorded nor adjusted |
| Control group or comparison condition | **No** |
| Sufficient sample size for stable estimates | **Unknown** — no data collected |
| Exclusion of alternative explanations | **No** |

Because none of these are satisfied, a reported correlation describes what
co-occurred in the available data. It does not identify a cause.

### 11.1 Concrete alternative explanations

Even if a positive association were observed, at least the following would be
consistent with it, and the design cannot distinguish between them:

- completing training improved scores;
- participants who already had higher scores were more inclined to complete
  training;
- participants who had already scored higher were more comfortable attempting an
  assessment at all;
- a third unmeasured factor — prior exposure, computing experience, or role —
  influences both;
- the association is a chance pattern of a small sample;
- the two scores partly measure the same capability (§4.2).

### 11.2 Permitted and prohibited language

| Permitted | Prohibited |
|---|---|
| "An observed association was present between the available participant measurements." | "Training improves awareness scores." |
| "Participants with higher exposure tended to score higher in the available data." | "Training has a positive effect on phishing identification." |
| "The relationship cannot be established as causal." | "The correlation proves causation." |
| "The result may reflect confounding or selection effects." | "Statistical analysis confirmed the relationship." |
| "No significance test was performed; none is claimed." | Any statement of significance, confidence, or probability. |

The user-facing methodology text shipped with the analytics module states the same
position: results are descriptive and exploratory, and association does not
establish causation.

---

## 12. Implementation status summary

| Element | Status |
|---|---|
| Variable definitions and measurement | **Implemented** and covered by automated tests |
| Research population query | **Implemented** |
| Latest-attempt selection rule | **Implemented** |
| Missing-data rules | **Implemented** |
| Descriptive statistics (n, mean, median, min, max) | **Implemented** |
| Training Exposure distribution | **Implemented** |
| Pearson correlation with pairwise-complete observations | **Implemented** |
| Safe handling of undefined correlations | **Implemented** |
| Sample-size reporting on every result | **Implemented** |
| De-identified CSV export | **Implemented** |
| Admin-only authorisation on analytics and export | **Implemented** |
| **Participant recruitment** | **Not started** |
| **Informed consent mechanism** | **Not implemented** |
| **Withdrawal mechanism** | **Not implemented** |
| **Data-retention policy** | **Not implemented** |
| **Analysis execution on real data** | **Not performed** |
| **Findings** | **Do not exist** |
| **Inferential statistics** | **Excluded by approved specification**; would require a new specification and approval |
| **Missingness analysis** | **Not implemented**; would require approval |
| **Measure of dispersion (SD, variance, IQR)** | **Not implemented**; would require approval |
| **Per-module or time-ordered exposure analysis** | **Not implemented**; underlying timestamps exist but are unused; would require a new specification |
| **Recruitment-scope decision** | **Open — blocking.** See §3.3 |

---

## 13. Related documents

| Document | Content |
|---|---|
| `docs/problem-statement.md` | The problem and its boundaries |
| `docs/research-questions.md` | RQ1–RQ3 and operational definitions |
| `docs/system-justification.md` | How the system addresses the problem |
| `docs/ethics-and-data-governance.md` | Conditions required before recruitment |
| `specs/research-analytics-v1.md` | Approved specification, §2 (exclusions), §5 (missing data), §7–§10 (statistics, precision), §22 (limitations) |
