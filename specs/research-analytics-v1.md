# Research Analytics V1 Specification

## 1. Purpose

Research Analytics V1 provides authorized administrators with a privacy-conscious
view of the three quantitative research variables already collected by PhishGuard:

1. Awareness Score
2. Phishing Identification Score
3. Training Exposure

The feature provides aggregate descriptive statistics, simple pairwise association
analysis, and a de-identified CSV export.

Research Analytics V1 is descriptive and exploratory. It must not present
associations as evidence that one variable caused another.

---

## 2. Scope

Research Analytics V1 includes:

- Admin-only research analytics
- Participant-level research dataset construction
- Aggregate cohort statistics
- Completion/sample-size information
- Training Exposure distribution
- Pairwise Pearson correlation
- De-identified CSV export
- Research methodology/privacy information in the frontend

Research Analytics V1 does NOT include:

- Predictive modeling
- Machine learning
- Causal inference
- Student rankings
- Leaderboards
- "Best" or "worst" students
- Statistical significance testing
- Automated research conclusions
- Staff access
- Student access
- Names or email addresses in research exports
- URL analysis data
- Incident-report data
- Password/authentication data
- External analytics services

---

## 3. Research Population

Only PhishGuard accounts satisfying both conditions are included:

- `role === "user"`
- `isActive === true`

Accounts with roles `staff` or `admin` are excluded.

Inactive user accounts are excluded.

The research population is derived from existing User records. Research Analytics
V1 does not create a separate participant model.

---

## 4. Participant-Level Dataset

Each eligible participant contributes at most one participant-level research record.

The three research variables are:

### 4.1 Awareness Score

Source:

`awarenessAssessments`

Rule:

Use the participant's latest Awareness Assessment attempt.

"Latest" is determined using the same deterministic ordering used by the existing
assessment/progress functionality:

1. `completedAt` descending
2. `_id` descending as a deterministic tie-breaker

Value:

- Integer/number from 0 to 100
- `null` if the participant has never completed the assessment

Historical attempts remain stored but do not independently contribute additional
participant rows.

### 4.2 Phishing Identification Score

Source:

`phishingIdentificationAssessments`

Rule:

Use the participant's latest Phishing Identification Assessment attempt.

Ordering:

1. `completedAt` descending
2. `_id` descending as a deterministic tie-breaker

Value:

- Integer/number from 0 to 100
- `null` if the participant has never completed the assessment

### 4.3 Training Exposure

Source:

`trainingCompletions`

Training Exposure must use the existing authoritative Training V1 semantics.

There are three training modules.

Formula:

`Math.round((completedModules / 3) * 10000) / 100`

Expected values are:

- 0
- 33.33
- 66.67
- 100

Training Exposure must not be independently redefined by the frontend.

---

## 5. Missing Data

Research Analytics V1 must never invent or substitute missing research values.

Examples:

- No Awareness Assessment -> `awarenessScore = null`
- No Phishing Identification Assessment -> `phishingIdentificationScore = null`

Training Exposure can legitimately be `0` when an eligible participant has
completed zero training modules.

Aggregate statistics for a variable use only participants with a non-null value
for that variable.

Pairwise relationship calculations use only participants who have non-null values
for BOTH variables in that relationship.

Every aggregate/relationship result must expose its applicable sample size.

---

## 6. Cohort Overview

The analytics response must provide sufficient information to show:

- Total eligible participants
- Participants with Awareness results
- Participants with Phishing Identification results
- Participants with training exposure greater than 0
- Participants with 100% training exposure
- Participants with all three research variables available

Counts must be calculated by the backend.

---

## 7. Descriptive Statistics

For Awareness Score and Phishing Identification Score, calculate:

- Sample size (`n`)
- Mean
- Median
- Minimum
- Maximum

If no observations are available:

- `n = 0`
- Statistical values must be `null`

Do not fabricate zero-valued statistics for an empty sample.

Calculations are backend-authoritative.

---

## 8. Training Exposure Distribution

Return counts for the four expected Training Exposure levels:

- 0
- 33.33
- 66.67
- 100

The distribution must be calculated from eligible participants only.

The total distribution count should equal the total number of eligible participants.

---

## 9. Pairwise Relationships

Research Analytics V1 examines these three pairwise relationships:

1. Awareness Score <-> Phishing Identification Score
2. Training Exposure <-> Awareness Score
3. Training Exposure <-> Phishing Identification Score

For each relationship, return:

- `n`
- Pearson correlation coefficient (`r`), when mathematically defined

Use pairwise complete observations only.

### 9.1 Undefined Correlation

Pearson correlation must be returned as `null` when it cannot be meaningfully
calculated, including cases such as:

- Fewer than 2 paired observations
- Zero variance in either variable
- Non-finite calculation result

The API must not return `NaN`, `Infinity`, or `-Infinity`.

### 9.2 Interpretation

The backend must not automatically label correlation values as:

- strong
- moderate
- weak
- good
- bad
- significant
- insignificant

The application must not claim that correlation demonstrates causation.

The frontend should use neutral language such as:

"Observed association between the available participant measurements."

---

## 10. Precision

Statistical calculations should retain sufficient internal precision.

Values exposed by the API may be rounded consistently for presentation.

Recommended API precision:

- Mean: 2 decimal places
- Median: up to 2 decimal places
- Pearson `r`: 3 decimal places
- Training Exposure: existing authoritative precision

Rounding must be performed by the backend for API consistency.

---

## 11. Privacy

Research Analytics V1 follows data-minimization principles.

Aggregate analytics must not expose participant identity.

The research API and CSV export must NOT expose:

- Name
- Email
- Password
- Password hash
- Password-reset token/hash
- Password-reset expiry
- JWT
- MongoDB ObjectId
- URL analysis history
- Submitted URLs
- Incident reports
- Report conversations
- Authentication logs
- Other unrelated personal/security data

---

## 12. Pseudonymous Participant IDs

CSV records use generated pseudonymous participant identifiers.

Format:

`PG-R0001`
`PG-R0002`
`PG-R0003`

and so on.

These identifiers are generated for the research dataset/export and are NOT added
to the User model.

Generation must use a deterministic participant ordering so repeated exports from
the same unchanged eligible population produce consistent row ordering and IDs.

Recommended deterministic ordering:

1. User `createdAt` ascending
2. User `_id` ascending as tie-breaker

MongoDB ObjectIds must never appear in the CSV.

These identifiers are pseudonyms for dataset organization, not authentication
identifiers and not permanent account identifiers.

---

## 13. CSV Export

Provide an admin-only CSV export containing the participant-level research dataset.

Recommended columns:

- participantId
- awarenessScore
- awarenessCompletedAt
- phishingIdentificationScore
- phishingIdentificationCompletedAt
- completedTrainingModules
- trainingExposure

Missing assessment values must be represented consistently as empty CSV fields.

The export must not contain names, emails, roles, MongoDB IDs, passwords,
authentication data, URLs, or incident-report information.

CSV generation must safely escape fields according to CSV rules.

Response headers should identify the response as a downloadable CSV file.

Suggested filename:

`phishguard-research-data.csv`

---

## 14. Authorization

Research Analytics V1 is ADMIN ONLY.

Backend authorization is mandatory.

Frontend route restrictions are usability controls only and must not be treated
as the security boundary.

Authenticated `user` accounts must be rejected.

Authenticated `staff` accounts must be rejected.

Only authenticated `admin` accounts may access research analytics or exports.

Existing authentication and RBAC behavior must remain intact.

---

## 15. API

### GET /api/research/analytics

Authentication:

Required

Authorization:

Admin only

Purpose:

Returns aggregate Research Analytics V1 information.

Response should include:

- Cohort overview
- Awareness descriptive statistics
- Phishing Identification descriptive statistics
- Training Exposure distribution
- Three pairwise relationship results
- Methodology metadata sufficient for the frontend to explain the dataset rules

Response:

`Cache-Control: no-store`

No participant-level identifiable information is returned.

---

### GET /api/research/export.csv

Authentication:

Required

Authorization:

Admin only

Purpose:

Returns the de-identified participant-level research dataset as CSV.

Response:

- CSV content type
- Download disposition
- `Cache-Control: no-store`

No identifying or security-sensitive fields are permitted.

---

## 16. Frontend

Create an admin-only Research Analytics page.

The page should provide:

### Cohort Overview

Display:

- Eligible participants
- Awareness participants
- Phishing Identification participants
- Participants with training exposure
- Fully trained participants
- Participants with all three variables

### Awareness Score

Display:

- n
- Mean
- Median
- Minimum
- Maximum

### Phishing Identification Score

Display:

- n
- Mean
- Median
- Minimum
- Maximum

### Training Exposure

Display the participant distribution across:

- 0%
- 33.33%
- 66.67%
- 100%

### Relationships

Display the three pairwise relationships with:

- Variables being compared
- n
- Pearson r, or a safe "Not available" state

Include a visible explanation that:

- The values describe associations in available data
- Correlation does not establish causation
- Missing data affects sample sizes

### CSV Export

Provide an admin-only control to download the de-identified CSV dataset.

The frontend must not independently reconstruct research statistics from raw
participant data.

---

## 17. Frontend States

The Research Analytics page must support:

- Loading
- Success
- Empty cohort
- Partial/incomplete data
- Undefined correlation
- API error
- Unauthorized/forbidden access
- CSV export failure

No state should expose internal stack traces or sensitive server information.

---

## 18. Security Requirements

Research Analytics V1 must:

- Reuse existing authentication middleware
- Reuse existing backend RBAC patterns
- Enforce admin authorization on both endpoints
- Validate/limit exposed fields
- Set `Cache-Control: no-store`
- Avoid sensitive logging
- Never log generated CSV contents
- Never log participant research records
- Never expose MongoDB IDs through the research API/export
- Never expose names/emails through the research API/export
- Keep statistical calculations backend-authoritative

No new secrets are required.

---

## 19. Data Model

Research Analytics V1 should not introduce a new MongoDB collection unless
implementation evidence demonstrates that one is necessary.

The preferred design derives analytics from existing authoritative collections:

- users
- awarenessAssessments
- phishingIdentificationAssessments
- trainingCompletions

No duplicated analytics source of truth should be persisted.

---

## 20. Testing Requirements

Automated tests should cover at minimum:

### Dataset Construction

- Only active `user` accounts included
- Staff excluded
- Admin excluded
- Inactive users excluded
- Latest Awareness attempt selected
- Latest Phishing Identification attempt selected
- Deterministic tie-breaking
- Training Exposure calculated correctly
- Missing assessment values remain null
- Deterministic pseudonymous ordering

### Descriptive Statistics

- Correct n
- Correct mean
- Correct median for odd sample size
- Correct median for even sample size
- Correct minimum
- Correct maximum
- Empty sample returns null statistics

### Correlation

- Correct Pearson calculation
- Pairwise missing-data exclusion
- Fewer than 2 observations -> null
- Zero variance -> null
- No NaN/Infinity returned

### Authorization

- Missing authentication rejected
- Invalid authentication rejected according to existing auth behavior
- User role rejected
- Staff role rejected
- Admin allowed

### Privacy

Assert responses/exports do not contain:

- Names
- Emails
- MongoDB IDs
- Password fields
- Reset-token fields
- URLs
- Report data

### CSV

- Correct headers
- Correct participant rows
- Correct empty-field handling
- Correct deterministic participant IDs
- Correct CSV escaping
- Correct response headers
- `Cache-Control: no-store`

---

## 21. Compatibility

Research Analytics V1 must not change:

- Awareness scoring
- Phishing Identification scoring
- Training Exposure semantics
- Existing assessment history
- Progress V1 behavior
- Dashboard V1 behavior
- URL analysis behavior
- Reporting behavior
- Password Reset behavior
- Existing authentication behavior
- Existing RBAC rules outside the new research routes

---

## 22. Limitations

Research Analytics V1 is a project-scale descriptive analytics feature.

It does not establish causal relationships.

Results may be affected by:

- Small sample sizes
- Missing participant measurements
- Self-selected participation
- Repeated assessment attempts
- Use of latest assessment attempts
- Limited Training Exposure levels
- The specific PhishGuard assessment instruments

These limitations should be documented rather than hidden.

---

## 23. V1 Completion Criteria

Research Analytics V1 is complete when:

- Admin-only analytics API works
- Admin-only CSV export works
- Only eligible active user accounts contribute
- Latest assessment semantics are correct
- Training Exposure matches Training V1
- Missing data is handled correctly
- Descriptive statistics are verified
- Correlations are verified and safely nullable
- CSV contains no direct identifiers
- Frontend Research Analytics page works
- Authorization is verified
- Automated tests pass
- Frontend lint/build pass
- Local admin workflow is manually verified
- Production deployment is verified
- Production admin analytics works
- Production CSV export works
- No regression is introduced into existing PhishGuard functionality