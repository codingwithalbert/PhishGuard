# PhishGuard — Phishing Identification Assessment Specification

## 1. Purpose

The Phishing Identification Assessment measures a user's ability to identify common phishing indicators in controlled educational scenarios.

This feature produces the project's second quantitative variable:

- Phishing Identification Score

It complements the existing Awareness Assessment, which measures cybersecurity awareness.

The Phishing Identification Assessment is an educational assessment. It must not be presented as a definitive measurement of a user's cybersecurity competence or as proof that a real message, website, or account is malicious.

---

## 2. Relationship to Existing Features

PhishGuard currently includes:

- Authentication and role-based access control
- Phishing URL Analyzer
- Analysis history and CRUD operations
- Awareness Assessment

The Phishing Identification Assessment is separate from the URL Analyzer.

The URL Analyzer evaluates a user-submitted URL using predefined heuristic indicators.

The Phishing Identification Assessment presents fixed, controlled scenarios and measures whether the authenticated user can correctly identify phishing indicators.

This feature must preserve all existing functionality.

---

## 3. V1 Scope

An authenticated user can:

1. Open the Phishing Identification Assessment.
2. View a fixed set of controlled educational scenarios.
3. Select one answer for each scenario.
4. Submit all answers.
5. Receive a backend-calculated Phishing Identification Score.
6. View their latest completed Phishing Identification Assessment result.
7. Complete the assessment again in a future attempt.

Each completed attempt is stored as a separate database document.

---

## 4. Assessment Structure

V1 contains exactly 10 fixed scenarios.

Each scenario must:

- have a unique numeric scenario ID;
- contain a short educational phishing-related scenario;
- contain one question;
- contain exactly four answer choices labeled A, B, C, and D;
- have exactly one correct answer;
- test recognition of a common phishing indicator or appropriate identification decision.

The scenarios should cover a reasonable variety of common indicators, such as:

- suspicious or misleading sender identity;
- urgent or threatening language;
- suspicious links or mismatched destinations;
- requests for passwords or verification codes;
- unexpected attachments;
- impersonation of trusted organizations or personnel;
- unusual requests for account verification;
- suspicious domain or URL characteristics;
- requests involving sensitive account information;
- combinations of multiple phishing warning signs.

Scenarios must remain controlled and educational.

Do not use real credentials, real private communications, or sensitive personal information.

Do not include instructions that teach users how to conduct phishing attacks.

---

## 5. Public Scenario Data

The frontend may receive only the information required to display the assessment.

Each public scenario may contain:

- `scenarioId`
- `scenario`
- `question`
- `choices`

Each choice may contain:

- `value`
- `text`

The API must never send the following before submission:

- correct answer;
- answer key;
- correctness flag;
- scoring weight;
- hidden scoring metadata.

The authoritative answer key must remain on the backend.

---

## 6. Scoring

Each scenario has equal weight.

Scoring rules:

- Correct answer = 1 point
- Incorrect answer = 0 points
- Maximum raw score = 10

The percentage score is:

`(correct answers / 10) * 100`

Examples:

- 0 correct = 0
- 5 correct = 50
- 8 correct = 80
- 10 correct = 100

The backend is the authoritative source for all scoring.

The frontend must not:

- contain the answer key;
- calculate the authoritative score;
- determine whether an answer is correct;
- send a score to the backend;
- send a raw score to the backend.

V1 must not assign interpretation categories such as:

- Poor
- Average
- Good
- Expert
- High Risk
- Low Risk

The feature reports the numeric Phishing Identification Score only.

---

## 7. Database Design

Use a separate MongoDB collection for completed Phishing Identification Assessment attempts.

Suggested collection:

`phishingIdentificationAssessments`

Each document should contain:

- `user`
  - MongoDB ObjectId
  - references `User`
  - required
- `answers`
  - required array
  - exactly 10 answers
- `answers[].scenarioId`
  - Number
  - required
- `answers[].selectedAnswer`
  - String
  - required
- `rawScore`
  - Number
  - backend calculated
  - minimum 0
  - maximum 10
- `score`
  - Number
  - backend calculated
  - minimum 0
  - maximum 100
- `totalScenarios`
  - Number
  - backend controlled
  - value 10
- `completedAt`
  - Date
  - backend controlled
- Mongoose timestamps

Multiple completed attempts are allowed.

The authenticated user must never be allowed to provide or override the document owner.

---

## 8. API Design

All Phishing Identification Assessment endpoints require authentication.

### GET `/api/phishing-identification/scenarios`

Purpose:

Return the fixed public assessment scenarios.

Response must include only sanitized scenario data.

It must not expose:

- answer key;
- correct answers;
- correctness flags;
- scoring metadata.

---

### POST `/api/phishing-identification/submit`

Purpose:

Submit one complete assessment attempt.

Expected request body:

```json
{
  "answers": [
    {
      "scenarioId": 1,
      "selectedAnswer": "A"
    }
  ]
}

---

## Appendix A — Authoritative V1 Scenario Set

This appendix defines the fixed scenario content and authoritative backend answer key for Phishing Identification Assessment V1.

Implementation requirements:

- Use these 10 scenarios exactly for V1.
- Preserve the scenario IDs.
- Preserve four choices per scenario labeled A–D.
- Do not add, remove, reorder, or reinterpret correct answers without updating this specification.
- The correct-answer information in this appendix is implementation guidance for the backend only.
- The frontend and public API must never receive the answer key or correctness metadata.
- Scenarios are fictional and educational. They must not contain real credentials or sensitive personal information.

### Scenario 1 — Suspicious Sender Domain

**Scenario ID:** 1

**Scenario:**

You receive an email that appears to be from your school's IT department. The display name says "Campus IT Support," but the sender address is `support@campus-security-help.example`.

**Question:**

Which detail is the strongest phishing indicator?

**Choices:**

- A. The message claims to be from the IT department.
- B. The sender's domain does not match the organization's expected domain.
- C. The email contains a support-related subject.
- D. The message was delivered to your inbox.

**Correct answer:** B

---

### Scenario 2 — Urgent Account Threat

**Scenario ID:** 2

**Scenario:**

A message says, "Your student account will be permanently disabled in 30 minutes unless you verify it immediately using the link below."

**Question:**

Which characteristic should make you most suspicious?

**Choices:**

- A. The message discusses a student account.
- B. The message contains a link.
- C. The message uses an urgent threat to pressure you into acting quickly.
- D. The message was received during the school day.

**Correct answer:** C

---

### Scenario 3 — Mismatched Link Destination

**Scenario ID:** 3

**Scenario:**

An email contains a button labeled "Open Student Portal." Before clicking, you inspect the destination and see that it points to an unrelated domain rather than the school's official portal.

**Question:**

What is the clearest phishing indicator?

**Choices:**

- A. The visible button text and actual link destination do not match the expected service.
- B. The email contains a button instead of plain text.
- C. The message mentions the student portal.
- D. The link uses lowercase letters.

**Correct answer:** A

---

### Scenario 4 — Password Request

**Scenario ID:** 4

**Scenario:**

You receive a message claiming to be from technical support. It asks you to reply with your account password so the support team can "verify your identity and repair your account."

**Question:**

What is the strongest warning sign?

**Choices:**

- A. The message refers to technical support.
- B. The sender offers to repair the account.
- C. The message asks you to reply.
- D. The sender asks you to provide your password.

**Correct answer:** D

---

### Scenario 5 — Unexpected Attachment

**Scenario ID:** 5

**Scenario:**

You receive an unexpected email claiming to contain an important document. The sender is unfamiliar to you, and the message asks you to open the attached file immediately.

**Question:**

What is the safest identification of this situation?

**Choices:**

- A. The attachment is safe because the message calls it important.
- B. The unexpected attachment from an unfamiliar sender is a phishing warning sign.
- C. The attachment should be opened first so you can determine what it contains.
- D. The email is trustworthy because it reached your inbox.

**Correct answer:** B

---

### Scenario 6 — Verification Code Request

**Scenario ID:** 6

**Scenario:**

Shortly after receiving a login verification code, you receive a message from someone claiming to be account support. They ask you to send them the verification code to confirm your identity.

**Question:**

Which detail is the strongest phishing indicator?

**Choices:**

- A. The person asks you to share a login verification code.
- B. A verification code was generated.
- C. The message refers to account support.
- D. The message discusses identity verification.

**Correct answer:** A

---

### Scenario 7 — Impersonation of Authority

**Scenario ID:** 7

**Scenario:**

A message claims to be from a school administrator and tells you to complete an unusual account-verification request immediately. The request is unexpected, and the sender address does not use the school's normal domain.

**Question:**

Which combination provides the strongest reason to suspect phishing?

**Choices:**

- A. The message mentions an administrator and an account.
- B. The message arrived unexpectedly.
- C. The unexpected request, pressure to act immediately, and unusual sender domain.
- D. The message contains formal language.

**Correct answer:** C

---

### Scenario 8 — Suspicious Login Domain

**Scenario ID:** 8

**Scenario:**

A message directs you to a login page at `https://student-portal.example-login.test`, while your school's normal login service uses a different official domain.

**Question:**

What should you identify as the main warning sign?

**Choices:**

- A. The address begins with HTTPS.
- B. The login page uses a domain different from the expected official domain.
- C. The address contains the words "student" and "portal."
- D. The page contains a login form.

**Correct answer:** B

---

### Scenario 9 — Sensitive Information Request

**Scenario ID:** 9

**Scenario:**

An email claims that your account information is incomplete and asks you to submit your password and other sensitive account information through a form linked in the message.

**Question:**

Which detail most strongly indicates a phishing attempt?

**Choices:**

- A. The message says your information is incomplete.
- B. The message includes a form.
- C. The message discusses your account.
- D. The message requests sensitive account information through an unsolicited link.

**Correct answer:** D

---

### Scenario 10 — Multiple Warning Signs

**Scenario ID:** 10

**Scenario:**

You receive an unexpected account-security email from an unfamiliar domain. It says your account will be locked immediately and asks you to use a provided link to enter your login information.

**Question:**

What is the best assessment of the message?

**Choices:**

- A. It contains multiple phishing indicators, including an unusual sender, urgency, and a request to enter login information through a provided link.
- B. It is probably legitimate because it discusses account security.
- C. It should be trusted because urgent security messages require immediate action.
- D. It is safe as long as the message contains a link.

**Correct answer:** A

---

## Appendix B — Authoritative Backend Answer Key

The following answer key is authoritative for V1:

| Scenario ID | Correct Answer |
|---|---|
| 1 | B |
| 2 | C |
| 3 | A |
| 4 | D |
| 5 | B |
| 6 | A |
| 7 | C |
| 8 | B |
| 9 | D |
| 10 | A |

Expected scoring examples:

- 0 correct → raw score 0 → score 0
- 5 correct → raw score 5 → score 50
- 8 correct → raw score 8 → score 80
- 10 correct → raw score 10 → score 100

The answer key must exist only in backend implementation and backend tests.

It must not be:

- returned by `GET /api/phishing-identification/scenarios`;
- embedded in frontend JavaScript;
- stored as correctness metadata in completed assessment documents;
- accepted from a client submission;
- logged in normal application output.

---

## Appendix C — Confirmed V1 API and Persistence Conventions

To remove implementation ambiguity, V1 uses the following exact conventions.

### Collection

The exact MongoDB collection name is:

`phishingIdentificationAssessments`

### Latest Result Endpoint

The exact endpoint is:

`GET /api/phishing-identification/latest`

If the authenticated user has no completed Phishing Identification Assessment, return a controlled HTTP `404` response.

### Submission Success

A successfully created assessment attempt should follow the existing Awareness Assessment API convention for creation status and response structure.

The returned assessment result may contain:

- `rawScore`
- `score`
- `totalScenarios`
- `completedAt`

The response must not expose:

- answer key;
- correctness flags;
- correct answers;
- another user's identity;
- internal scoring metadata.

### Public Scenarios

`GET /api/phishing-identification/scenarios` returns the 10 sanitized scenarios defined in Appendix A.

Each public scenario contains only:

- `scenarioId`
- `scenario`
- `question`
- `choices`

Each choice contains only:

- `value`
- `text`

### Submission

`POST /api/phishing-identification/submit` accepts only:

- top-level `answers`;
- `scenarioId` and `selectedAnswer` inside each answer.

All ownership and scoring fields are server-controlled.