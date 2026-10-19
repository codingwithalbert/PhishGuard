# PhishGuard — Analytics Visualization V1 (Revised Specification)

**Status:** IMPLEMENTED — UNCOMMITTED · synthetic/disposable demonstration data only  
**Baseline:** `main @ 0445786` (committed baseline; the implementation in section 7 exists only as uncommitted working-tree changes)  
**Specification date:** 2026-10-17 · **Status reconciled:** 2026-10-17  
**Source of the technical revisions below:** OpenCode read-only review of `specs/analytics-visualization-v1.md` (12 revisions, four blocking). Those revisions are unchanged.

## Status reconciliation (2026-10-17)

The earlier status line on this document read "REVIEW CANDIDATE — NO
IMPLEMENTATION AUTHORIZED". That was accurate when written and no longer
describes the repository. This block replaces it. **Every technical section
below — statistical definitions, response contracts, suppression rules, chart
requirements, acceptance tests, and research limitations — is unchanged.**

| Dimension | Actual state |
|---|---|
| **Implementation authorization** | Granted for this feature as specified, **limited to synthetic or disposable demonstration data**. See section 5.3 and section 9 item 1. |
| **Backend implementation** | **Implemented, uncommitted.** New untracked `apps/api/src/middleware/research.validate.middleware.js` and `apps/api/src/services/researchAnalytics.suppression.js`; modified `research.routes.js`, `research.controller.js`, `researchAnalytics.dataset.js`, `researchAnalytics.statistics.js`. |
| **Frontend implementation** | **Implemented, uncommitted.** New untracked `apps/web/src/components/research/{ResearchCharts.jsx,ExposureLevelFilter.jsx,researchChartUi.js}`; modified `ResearchAnalytics.jsx`, `api.js`, `index.css`. |
| **Automated verification completed** | New untracked `apps/api/test/analyticsVisualization.gate1.test.js` — **45 tests, 45 pass, 0 fail, 0 skipped**. Modified `researchAnalytics.statistics.test.js` and `researchAnalytics.stage2.test.js`. Full isolated backend suite: **549 tests, 547 pass, 0 fail, 2 skipped** (the 2 are intentional opt-in MongoDB suites, not passes). `npm run lint` and `npm run build` both pass. |
| **Browser / responsive / keyboard / screen-reader verification** | **OUTSTANDING. Not performed.** `npm run build` does not verify rendering. No browser, viewport, keyboard, or assistive-technology check has been run against this surface. |
| **Institutional privacy approval** | **NOT OBTAINED.** No institutional decision exists on threshold approval, complementary suppression, unfiltered-baseline inference, CSV implications, retention, or consent. |
| **Real student data** | **NOT PERMITTED for display, projection, or screenshots** under this authorization. |
| **Committed** | **No.** Nothing in this feature is committed. Staging, commit, push, and deployment each still require separate explicit authorization. |
| **Dependency audit** | **Not re-run for this reconciliation.** A clean audit at the committed baseline exists in `audit-reports/`; it does not cover the uncommitted work. |
| **This document authorizes** | **No new or additional functionality.** It records an already-implemented feature. Any scope beyond sections 1–8 requires a new approved task. |

## 1. Scope
Add to the existing **admin-only in-app Research Analytics** dashboard:
1. Training Exposure Distribution (four-category bar chart).
2. Assessment Score Comparison (mean awareness and mean phishing-identification, with each valid `n`).
3. Pearson Correlation Comparison (three relationships, horizontal signed bars on [-1, 1]).
4. Training Exposure filter: `All`, `0%`, `33.3%`, `66.7%`, `100%`.

No external Google Forms survey integration, CSV export filtering, new database collections, participant-level API responses, new route, MFA, session changes, or analytics efficacy claims. Preserve existing design tokens, UI language, and privacy caveat.

## 2. Verified current contract
- `GET /api/research/analytics` and `GET /api/research/export.csv`, both behind `authenticate` then `authorizeRoles("admin")`.
- Analytics response top-level keys: `success`, `cohort`, `awareness`, `phishingIdentification`, `trainingExposureDistribution`, `relationships`, `methodology`.
- `cohort` has **six existing fields**; preserve them exactly.
- `trainingExposureDistribution` entries currently have `{trainingExposure, count}` with canonical percent values `0`, `33.33`, `66.67`, `100`.
- `awareness` and `phishingIdentification`: `{n, mean, median, min, max}`.
- `relationships` keys: `awarenessPhishingIdentification`, `trainingExposureAwareness`, `trainingExposurePhishingIdentification`; each existing entry has `{variables, n, r}`.
- Pearson `r` is rounded by the backend to **three decimal places**; `null` denotes insufficient data or zero variance.
- Eligibility is exactly `role === "user" && isActive === true`, not research consent or completed assessments.
- Training exposure is the count of distinct completed modules from IDs 1, 2, 3; `completedTrainingModules` is already present for every in-memory participant. Missing completion documents mean **zero completed modules**, not unknown exposure.
- Latest assessments selected per user using `{completedAt:-1, _id:-1}`; missing assessment scores remain `null`, excluded metric-by-metric.
- Existing CSV export is independent of analytics summary filtering and must remain unchanged.

These contracts were originally verified findings reported by OpenCode rather
than independently re-executed tests. **As of the 2026-10-17 reconciliation they
are additionally exercised by executed automated tests**: the unfiltered
response's exact top-level key set, the equality of an explicit `all` response
with an omitted one, the six `cohort` fields, and the distribution and
relationship shapes are asserted in `analyticsVisualization.gate1.test.js` and
`researchAnalytics.stage2.test.js`. Those tests run against the real
router/controller/service chain with in-memory model stand-ins; **real MongoDB
projection and index behaviour remains unverified** because no live-database
suite was executed.

## 3. Filter contract and semantics

**Single existing endpoint:** `GET /api/research/analytics?exposureLevel=<value>` where value is one of `all|0|1|2|3`. Missing parameter means `all`. No new endpoint.

Filter `E` (all currently eligible users) using each participant's existing integer `completedTrainingModules` *before* calling `buildResearchAnalyticsSummary(participants)`. For level `k`, `E_k = { p in E | p.completedTrainingModules === Number(k) }`.

- `all` and omitted filter must produce identical aggregate values to the existing unfiltered behavior.
- Preserve the original six `cohort` fields and their meanings; in filtered results they describe `E_k`.
- Preserve existing statistical functions and pairwise missing-value exclusions.
- Distribution must show all four categories in fixed order; when filtered, only the selected category may have a nonzero count. Subtitle: **Distribution within selected cohort**.
- `Σ trainingExposureDistribution[].count === cohort.totalEligibleParticipants`.
- `0%` is a valid measured exposure category, not missing data.
- Display labels are derived from the server-provided `methodology.trainingExposureLevels` canonical values (`0`, `33.33`, `66.67`, `100`), formatted consistently to `0%`, `33.3%`, `66.7%`, `100%`; do not duplicate a literal percent mapping in the frontend (condition F).

### Query validation
Reject with sanitized 400:
- Empty (`?exposureLevel` or `?exposureLevel=`), invalid (`4`, `-1`, `1.5`, `alll`, etc.), bracketed (`exposureLevel[]`), unknown parameters, and duplicate parameters (Express 5 parses duplicate values as arrays).
- Never accept arbitrary participant IDs, roles, or filter expressions.
- Route authorization must execute **before** query validation.

## 4. Additive response changes

**No renames, removals, or changes to existing unfiltered numerical values.** Keep existing `cohort` untouched in shape. Keep existing `trainingExposureDistribution[].trainingExposure`, existing `relationships` keys and `variables` values.

**Proposed additive top-level field**:
```json
"filter": {
  "exposureLevel": "2",
  "label": "66.7%",
  "applied": true,
  "scope": "in_app_eligible_users"
}
```
`all` has `applied:false`. **Pinned envelope rule (condition E):** include the `filter` field **if and only if** `exposureLevel` was explicitly supplied (including `all`). When omitted, return the original response shape exactly; the frontend treats absence as `all`. Explicit `?exposureLevel=all` returns identical aggregate values with the additional `filter` metadata.

Do **not** add `completedComponents` to each distribution entry in V1: the UI already has the canonical percentage and counts, and adding it would force changes to test-pinned deep-equality assertions without being needed for any of the three charts. The internal filtering logic uses `completedTrainingModules` instead. This is a deliberate simplification of the OpenCode recommendation, preserving more existing contracts.

Do **not** add `unavailableReason` to the shared `computePearsonCorrelation` return in V1: existing `{n,r}` deep-equality tests are pinned and the UI can distinguish fixed exposure using `filter.applied` and known relationship keys. Other `r:null` states display the generic `Not available (insufficient observations or no variation)` message. This is another deliberate minimal-contract choice. If detailed reasons become mandatory, they require separate additive-contract approval.

## 5. Privacy suppression, inference, and governance

**Proposed threshold:** `MIN_REPORTABLE_N = 5`. This is a proposed display safeguard, **not** an institutionally approved privacy policy. Do not use real student data in screenshots, projection, or public demonstrations without institutional authorization.

### 5.1 Per-metric suppression (blocking correction B1)

For an **explicitly selected exposure level** (`0`, `1`, `2`, or `3`), first compute the existing full summary. Then suppress numerical values based on the **valid observation count for each individual metric**, not `cohort.totalEligibleParticipants`:
- When `awareness.n < 5`, set `awareness.mean`, `.median`, `.min`, and `.max` to `null`.
- When `phishingIdentification.n < 5`, set `phishingIdentification.mean`, `.median`, `.min`, and `.max` to `null`.
- For **each** `relationships[key]`, when `relationships[key].n < 5`, set `.r` to `null`.
- Preserve all cohort counts, distribution counts, and `n` values; never replace an unavailable value with `0`.
- Set `filter.statisticsSuppressed = true` if **any** value was suppressed, even when cohort headcount is at least five. Set `filter.minimumStatisticN = 5`.
- A null from the statistical function (e.g. zero variance) remains null. Never fabricate a coefficient.

### 5.2 Default-off, post-summary policy (blocking correction B2)

`buildResearchAnalyticsSummary(participants)` must retain its **existing one-argument output exactly**, including small-fixture numerical values. Suppression is a separate, opt-in **post-summary transformation** for filtered HTTP results, e.g. `applyReportingSuppression(summary, { minimumStatisticN: 5, ... })`. Do not insert unconditional suppression into `computeDescriptiveStatistics`, `computePearsonCorrelation`, or the existing one-argument summary function. Preserve test-pinned `{n,r}` and `{n,mean,median,min,max}` object shapes.

### 5.3 Complementary inference (condition I)

Simple per-metric suppression is **not** a complete privacy protection: a suppressed subgroup's mean can sometimes be reconstructed from the unfiltered mean and other visible subgroups. For each metric, a defensible real-data display policy must account for the **valid observation counts in every exposure subgroup**, including complementary groups, and for the existing unfiltered endpoint and CSV export.

**Conservative V1 demonstration rule:** Until an institutional policy is approved, use **synthetic/disposable records only** for chart/filter demonstrations; do not present real student analytics. For a future real-data deployment, require an approved complementary-suppression design (potentially suppressing all exposure-level means and correlations for a metric whenever any subgroup is below threshold), and evaluate whether the unfiltered baseline and existing admin CSV make suppression ineffective. Do not describe per-metric suppression alone as eliminating inference.

### 5.4 Existing CSV and consent limitations (condition H)

The existing admin CSV export contains training exposure and assessment scores, so an authorized admin can recompute small-subgroup statistics offline. The proposed API threshold is principally a **display/accidental-disclosure safeguard**, especially for projected screens and screenshots; it is **not** a security boundary against that admin. CSV export behavior and permissions remain unchanged.

The existing in-app cohort comprises active `role=user` accounts, with no dedicated research-consent/withdrawal mechanism. Consent for the separate instructor-approved Google Forms survey does **not** authorize reuse of in-app analytics. Seek an institutional decision on whether these analytics may be displayed at all, the threshold, complementary suppression, retention, and consent before real-data use.

## 6. Chart rendering and UX
- **A:** Four vertical bars, count y-axis starting at zero; count and within-cohort percent in tooltip/table. Show `N`.
- **B:** Two bars on 0–100 scale for existing `awareness.mean` and `phishingIdentification.mean`; show distinct `n` values. Null means `Not available`, never 0.
- **C:** Three horizontal diverging bars, with an explicit visible `+` or `−` sign in the bar label **and text alternative** for defined nonzero `r`, native three-decimal display, and axis [-1,1] (condition G). For a selected exposure level, the two exposure-related `r` values are undefined due to zero variance: show `Not available — exposure is constant in this cohort`; the awareness-identification `r` may be defined. Null must never render as a zero bar.
- Keep existing six KPIs and current CSV functionality; filtered KPI values must match the filtered API response. Label all KPI values **Within selected exposure cohort** when filtered; clarify that `participantsWithTrainingExposure` becomes 0 for level 0 and N for levels 1–3, while `participantsWithFullTrainingExposure` becomes N only for level 3 (condition D).
- Filter defaults to `All`; changing it fetches a new server-side aggregate. Ignore/abort stale responses during rapid switching.
- Loading, errors, empty cohort, suppressed metrics, and undefined correlations have distinct labels. `filter.statisticsSuppressed` is the suppression-specific signal (condition C): display **Suppressed — below minimum reporting size** rather than generic **Not available** when a value was suppressed. Because a single Boolean does not identify which fields were suppressed, infer per-metric suppression from the corresponding `n < filter.minimumStatisticN`; otherwise display the existing undefined-statistic explanation.
- Use accessible inline SVG with existing CSS/design tokens; keyboard-accessible filter and tabular/text equivalents. No charting dependency without separate approval.
- Do not display real-looking hard-coded sample numbers. Screenshots using synthetic data must be labeled as demonstrations.

## 7. Implementation sequence
1. Verify baseline contracts, test commands, and privacy approval status.
2. Implement optional query validator after the admin gate.
3. Implement server-side participant-array filter between dataset construction and summary computation.
4. Add the pinned conditional `filter` envelope and opt-in, post-summary **per-metric** suppression; preserve all existing field names and default one-argument summary behavior.
5. Add backend tests for validation, authorization, statistics, threshold, and compatibility.
6. Implement frontend filter, stale-response protection, charts A/B/C, text alternatives, responsive styling.
7. Run isolated backend tests, frontend lint/build, dependency audit, manual keyboard/screen-reader/responsive checks.
8. Record verified evidence, commits, and manuscript screenshots in the master task tracker.

### 7.1 Step completion status (recorded 2026-10-17)

The eight steps above are unchanged requirements. Their actual completion state:

| Step | State | Evidence / gap |
|---|---|---|
| 1. Verify baseline contracts, test commands, privacy approval status | **Partially complete** | Contracts and test commands verified. **Privacy approval status: not obtained.** |
| 2. Optional query validator after the admin gate | **Complete (uncommitted)** | `research.validate.middleware.js`; mounted after `authenticate` and `authorizeRoles("admin")` in `research.routes.js` |
| 3. Server-side participant-array filter | **Complete (uncommitted)** | `filterParticipantsByExposureLevel` in `researchAnalytics.dataset.js`; runs before `buildResearchAnalyticsSummary` |
| 4. Conditional `filter` envelope + opt-in post-summary per-metric suppression | **Complete (uncommitted)** | `buildFilterEnvelope` in `research.controller.js`; `applySmallCohortSuppression` in `researchAnalytics.suppression.js`; one-argument summary behavior unchanged |
| 5. Backend tests | **Complete (uncommitted)** | `analyticsVisualization.gate1.test.js` — 45 tests, 45 pass |
| 6. Frontend filter, stale-response protection, charts A/B/C, text alternatives, responsive styling | **Code complete (uncommitted)** | `ResearchCharts.jsx`, `ExposureLevelFilter.jsx`, `researchChartUi.js`, `ResearchAnalytics.jsx`, `index.css`. **Written is not verified — see the outstanding browser checks in section 7.2** |
| 7. Isolated backend tests, frontend lint/build, dependency audit, manual keyboard/screen-reader/responsive checks | **Partially complete** | Isolated suite (549 tests), lint, and build pass. **Dependency audit not re-run. Manual keyboard, screen-reader, and responsive checks NOT performed.** |
| 8. Record verified evidence, commits, and manuscript screenshots in the master task tracker | **Not complete** | **The referenced master task tracker does not exist anywhere in this repository.** No commit exists. No manuscript screenshot exists. This step cannot be completed as written until the tracker is identified or this reference is corrected. |

### 7.2 Outstanding before this feature can be called verified

1. **Browser verification.** Run the Research Analytics surface in a browser and confirm the three charts render from server values, the filter changes rendered content, and no chart-library dependency was introduced.
2. **Responsive verification.** Confirm chart and filter layout at desktop, tablet, and the small-screen breakpoint, including the `@media (max-width: 860px)` rule.
3. **Keyboard verification.** Confirm the native filter select is fully operable and that every chart's text equivalent is reachable and announced.
4. **Screen-reader verification.** Confirm each chart's accessible name, role, and text alternative, and that "Suppressed — below minimum reporting size" is distinguishable from the generic not-available message.
5. **Reduced-motion verification.** Confirm enhancement failure and reduced-motion behaviour is unchanged for this surface.
6. **Institutional privacy decision.** Sections 5.3 and 9 item 1 remain unresolved and block any real-data display.

## 8. Acceptance tests
- Unfiltered endpoint maintains all existing field names, values, permissions, CSV behavior, and test-pinned objects.
- Valid values `all,0,1,2,3` work; omitted equals all in aggregate values.
- Invalid/duplicate/unknown query parameters produce sanitized 400; unauthenticated/unauthorized requests do not disclose analytics.
- Filtered distribution counts sum to filtered eligible cohort count; missing training documents count as 0.
- Latest attempt tie-break and pairwise missingness unchanged; means and Pearson r correct for synthetic fixtures.
- With fixed exposure, the two exposure correlations are null, never 0/NaN/Infinity.
- Empty filtered cohort: counts 0, means/r null; `n` correctly represents valid observations.
- **For each filtered metric with valid n <5:** its sensitive statistics are null **in HTTP JSON**, regardless of overall cohort headcount; other metrics use their own valid `n`. The suppression flag is true when any value is suppressed. Existing one-argument summary tests remain unchanged.
- Filter updates KPIs and charts based on fresh server data; stale fetch cannot overwrite a newer selection.
- Three accessible charts, text alternatives, keyboard navigation, responsive layouts, no generic visual redesign.
- Existing export route, CSV contents and permissions unchanged.
- Current isolated backend suite, frontend lint/build and dependency audit pass; manual UI/a11y checks documented. No frontend automated runner is assumed.
- Screenshots and manuscript text distinguish synthetic demonstration from actual in-app aggregates and external survey findings.

## 9. Decisions still requiring approval
1. **Institutional privacy:** threshold=5 is proposed; approval of real-data display, baseline/complementary inference controls, CSV implications, and research consent is required before real-data use. Synthetic-only demonstration is the interim rule.
2. **Response envelope:** resolved — present only when query parameter is explicitly supplied.
3. **Chart choice:** instructor confirmation if required by final-defense rubric.
4. **Implementation:** resolved for synthetic-data demonstration — the implementation in section 7 exists and its automated backend verification passes. It remains **uncommitted**, and browser/responsive/keyboard/screen-reader verification is outstanding (section 7.2). This document authorizes **no further or new code modifications**; any scope beyond sections 1–8 needs a new approved task.

## 10. Revision reconciliation
- R1: Preserve `cohort` six-field object; filter metadata separate.
- R2: Preserve `trainingExposureDistribution[].trainingExposure`; no extra entry field necessary.
- R3: Exposure always defined; missing completion docs count as 0.
- R4: No new/versioned endpoint.
- R5: Use `exposureLevel` parameter.
- R6: Document display labels separately from canonical percentage values.
- R7: Avoid changing test-pinned `{n,r}`; UI explains nulls contextually.
- R8: Use exact canonical relationship and score field names.
- R9: Define proposed threshold 5, apply per-metric `n` suppression as opt-in post-summary policy, and document complementary-inference/CSV limitations; institutional approval still pending.
- R10: No assumed frontend test runner.
- R11: Display Pearson r at native 3 decimals.
- R12: Explicit Express 5 duplicate, blank, bracket, unknown-key cases.

**Status: implemented for synthetic-data demonstration; uncommitted; browser and assistive-technology verification outstanding; institutional privacy approval not obtained.** The twelve revisions above are unchanged, as are all technical requirements in sections 1–8. This document authorizes no new functionality.
