# Awareness Assessment Specification

## Feature
Cybersecurity Awareness Assessment

## Purpose
Allow authenticated PhishGuard users to complete an educational cybersecurity awareness assessment and receive an Awareness Score.

This feature will later support the project's quantitative analysis together with the Phishing Identification Score and Training Exposure.

## Current Scope
The first version will allow an authenticated user to:

1. Open the Awareness Assessment.
2. View a fixed set of cybersecurity awareness questions.
3. Select one answer for each question.
4. Submit the completed assessment.
5. Have the backend calculate the Awareness Score.
6. View the resulting score.
7. View their latest assessment result.

## Security Requirements
- Authentication is required to submit or retrieve assessment results.
- The backend must calculate the score.
- The frontend must not submit or control the final score.
- Users may access only their own assessment results.
- Assessment input must be validated before scoring or database operations.
- Existing authentication, RBAC, validation, error handling, and security controls must not be weakened.
- No secrets or sensitive credentials may be stored in assessment responses.

## Architecture
The feature must follow the existing MERN architecture:

React frontend
-> REST API
-> Express routes/middleware
-> controller/service
-> Mongoose
-> MongoDB

## Database Design

Collection: awarenessAssessments

Each completed assessment is stored as a separate document.

### AwarenessAssessment Schema

- user
  - Type: ObjectId
  - Reference: User
  - Required: true

- answers
  - Type: Array
  - Required: true
  - Contains:
    - questionId
      - Type: Number
      - Required: true
    - selectedAnswer
      - Type: String
      - Required: true

- rawScore
  - Type: Number
  - Range: 0-10
  - Required: true
  - Calculated by the backend

- score
  - Type: Number
  - Range: 0-100
  - Required: true
  - Calculated by the backend

- totalQuestions
  - Type: Number
  - Value for Version 1: 10
  - Required: true

- completedAt
  - Type: Date
  - Required: true
  - Set by the backend

- createdAt
  - Managed by Mongoose timestamps

- updatedAt
  - Managed by Mongoose timestamps

A User can have multiple AwarenessAssessment documents so that future versions can support assessment history and progress analysis.

Users must never be able to assign an assessment document to another user. The authenticated user ID from the verified JWT is used by the backend.

## REST API Design

All Awareness Assessment endpoints require authentication.

### GET /api/awareness/questions

Purpose:
Return the fixed Version 1 Awareness Assessment questions.

Response may contain:
- questionId
- question text
- answer choices

Response must NOT contain:
- correct answers
- answer key
- calculated score

The frontend must not receive the correct-answer key through this endpoint.

### POST /api/awareness/submit

Purpose:
Submit a completed Awareness Assessment.

The client submits only the user's selected answers.

Expected request structure:

{
  "answers": [
    {
      "questionId": 1,
      "selectedAnswer": "B"
    }
  ]
}

The complete submission must contain exactly one valid answer for each of the 10 Version 1 questions.

Backend responsibilities:

1. Require a valid authenticated user.
2. Validate the request body.
3. Require exactly 10 answers.
4. Reject missing question IDs.
5. Reject unknown question IDs.
6. Reject duplicate question IDs.
7. Accept only valid answer choices: A, B, C, or D.
8. Compare submitted answers with the server-side answer key.
9. Calculate rawScore from 0 to 10.
10. Calculate score from 0 to 100.
11. Use the authenticated user's ID as the owner.
12. Set totalQuestions to 10 on the backend.
13. Set completedAt on the backend.
14. Save the completed assessment to MongoDB.
15. Return the saved assessment result.

The API must ignore or reject attempts by the client to control fields such as:
- user
- rawScore
- score
- totalQuestions
- completedAt

### GET /api/awareness/latest

Purpose:
Return the authenticated user's most recently completed Awareness Assessment.

The backend must search using the authenticated user's ID.

Response may contain:
- rawScore
- score
- totalQuestions
- completedAt

The endpoint must never return another user's assessment result.

If the authenticated user has not completed an assessment yet, the API must return a clear controlled response rather than exposing an internal error.

## Version 1 API Scope

Version 1 intentionally contains only:

- GET /api/awareness/questions
- POST /api/awareness/submit
- GET /api/awareness/latest

Version 1 does not provide assessment Update or Delete endpoints.

Submitted assessment scores are treated as completed records and cannot be edited by the user through the Awareness Assessment API.

## Assessment Questions

The Awareness Assessment contains 10 fixed multiple-choice questions.

### Question 1 - Password Security
Which password practice provides better account security?

A. Using the same password for every account
B. Using a long, unique password for each important account
C. Sharing passwords with trusted friends
D. Using your birthday because it is easy to remember

Correct answer: B

### Question 2 - Multi-Factor Authentication
What is the main purpose of multi-factor authentication (MFA)?

A. To make passwords shorter
B. To automatically change your username
C. To require an additional form of verification when signing in
D. To prevent websites from storing any information

Correct answer: C

### Question 3 - Phishing Awareness
You receive an unexpected message asking you to log in immediately through a provided link. What is the safest response?

A. Open the link because the message says it is urgent
B. Reply with your password to confirm your identity
C. Forward it to friends to ask whether it is legitimate
D. Avoid the link and verify the request through the organization's official website or another trusted channel

Correct answer: D

### Question 4 - Credential Protection
Why should you avoid sharing passwords or verification codes with other people?

A. They may allow another person to access your account
B. They make your internet connection slower
C. They cause websites to stop working
D. They automatically delete your account

Correct answer: A

### Question 5 - Software Security
Why are software and security updates important?

A. They guarantee that a device can never be attacked
B. They can fix known security vulnerabilities and other software problems
C. They remove the need for passwords
D. They make every website trustworthy

Correct answer: B

### Question 6 - Network Security
What should you be careful about when using public Wi-Fi?

A. Sensitive activities may be riskier on networks you do not control
B. Public Wi-Fi automatically gives websites your password
C. Public Wi-Fi permanently disables antivirus software
D. Public Wi-Fi makes MFA unnecessary

Correct answer: A

### Question 7 - Social Engineering
Someone claiming to be from technical support unexpectedly asks for your password to fix your account. What should you do?

A. Give them the password if they know your name
B. Give them only part of the password
C. Refuse to provide the password and verify the request through an official channel
D. Change the password to something simple before giving it to them

Correct answer: C

### Question 8 - Attachments
What is the safest approach to an unexpected email attachment from an unfamiliar sender?

A. Open it immediately to see what it contains
B. Avoid opening it until the sender and attachment can be verified
C. Rename the file before opening it
D. Send it to another person and ask them to open it first

Correct answer: B

### Question 9 - Incident Response
If you think one of your accounts may have been compromised, what is an appropriate response?

A. Ignore it unless the account stops working
B. Post your password publicly so others can check it
C. Continue using the account normally for several weeks
D. Secure the account using official recovery/security options and report the incident when appropriate

Correct answer: D

### Question 10 - Security Reporting
Why should suspicious cybersecurity activity be reported to the appropriate school or organization personnel?

A. Reporting can help the organization investigate and respond to potential security incidents
B. Reporting guarantees that no future cyberattack can happen
C. Reporting automatically identifies every attacker
D. Reporting replaces the need for other security practices

Correct answer: A

## Scoring

Each question has equal weight.

- Correct answer = 1 point
- Incorrect answer = 0 points
- Total questions = 10
- Maximum raw score = 10
- Minimum raw score = 0

The Awareness Score is calculated as:

Awareness Score = (Correct Answers / Total Questions) * 100

Examples:

- 10 correct = 100
- 8 correct = 80
- 5 correct = 50
- 0 correct = 0

The first version does not assign interpretation categories such as Poor, Average, Good, or Expert.

The backend is authoritative for scoring. The frontend must submit question IDs and selected answers only. It must not submit a calculated score.

The correct-answer key must not be included in the normal assessment-question response sent to the frontend.

## Out of Scope for This Version
- Phishing Identification Assessment
- Training module
- Training Exposure calculation
- Correlation analysis
- Admin analytics
- Comparison with other users
- AI-generated assessment questions
- Definitive cybersecurity competency claims

## Definition of Done
The feature will be considered complete when:

- authenticated users can complete the assessment,
- the backend validates submitted answers,
- the backend calculates the approved Awareness Score,
- results are stored in MongoDB,
- users can retrieve their own latest result,
- unauthorized access is rejected,
- automated backend tests cover the new behavior,
- frontend lint and production build pass,
- the PhishGuard verification harness passes,
- no secrets are exposed.