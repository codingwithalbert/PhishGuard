# Reporting V1 Specification

## 1. Purpose

Reporting V1 provides a school-focused phishing incident reporting and IT review workflow within PhishGuard.

The feature connects PhishGuard's existing cybersecurity education and URL analysis capabilities to a structured incident-response process for students and school IT personnel.

The intended workflow is:

1. A student or other authenticated user encounters a potentially suspicious URL.
2. The user analyzes the URL using PhishGuard's existing URL Analyzer.
3. PhishGuard provides a heuristic risk assessment, score, indicators, and explainable findings.
4. If the user remains concerned, they may create a report/ticket from that Analysis.
5. The report enters the school's IT review queue and receives a human-readable ticket number.
6. IT staff may prioritize and take responsibility for the report.
7. IT staff investigates the submitted URL and existing PhishGuard analysis.
8. The reporting user and IT staff may exchange report-specific messages when additional context is required.
9. IT staff records a human assessment and completes the report.
10. The reporting user can track the report and view the completed assessment.

This creates the following overall PhishGuard workflow:

`Learn → Identify → Analyze → Report → IT Investigates → Resolve → Learn`

### 1.1 Role of Automated Analysis

The URL Analyzer remains a heuristic risk-assessment tool.

Its automated:

- risk level;
- score;
- indicators; and
- findings

must not be treated as a definitive determination that a URL is phishing, malicious, or safe.

The automated analysis provides evidence that may assist both the reporting user and IT staff.

### 1.2 Role of Human IT Review

The IT review workflow is separate from automated URL analysis.

Authorized school IT staff or administrators may investigate submitted reports and record a human assessment.

The human assessment must remain visibly distinguishable from PhishGuard's automated risk classification.

A completed IT assessment represents the review performed using the information available at that time. It must not be presented as an absolute or permanent guarantee of URL safety.

### 1.3 Reporting as a Ticket Workflow

Each submitted Report functions as a phishing-related support/security ticket.

Reporting V1 is specialized for suspicious URLs and phishing incidents rather than being a general-purpose school help-desk system.

A Report may include:

- a human-readable ticket number;
- the original PhishGuard analysis evidence;
- the student's reason and context for reporting;
- workflow status;
- IT-controlled priority;
- staff assignment;
- report-specific communication between the reporter and IT staff;
- the final IT assessment; and
- review information.

### 1.4 Scope Boundary

Reporting V1 does not perform:

- external threat-intelligence lookups;
- automated website crawling;
- malware scanning;
- automatic blocking of URLs; or
- definitive automated URL verification.

Those capabilities are not required for the school reporting and review workflow.

Reporting V1 also does not accept file attachments. Supporting potentially untrusted uploaded files would introduce additional storage, validation, access-control, and security requirements that are outside this version.

---

## 2. Roles and Responsibilities

Reporting V1 uses the existing PhishGuard roles:

- `user`
- `staff`
- `admin`

Role authorization must be enforced by the backend. Frontend navigation and hidden controls are usability features only and must not be treated as security controls.

### 2.1 User / Student

An authenticated user may:

- create a Report from an Analysis that they own;
- view their own submitted Reports;
- view the ticket number of their Reports;
- view the current workflow status;
- view the current IT-controlled priority;
- view the assigned IT staff member when one is assigned;
- send messages within their own Report;
- view messages exchanged within their own Report;
- provide additional context requested by IT staff;
- view the final human assessment when the review is completed;
- view the final reviewer note when one is provided; and
- continue viewing a Report even if the original Analysis is later deleted.

A user must not be able to:

- report another user's Analysis;
- access another user's Reports;
- choose or change ticket numbers;
- choose or change report priority;
- assign Reports to staff members;
- change workflow status;
- set or change the human assessment;
- impersonate another message sender;
- create staff-only/internal notes;
- set reviewer identity;
- set review timestamps; or
- modify completed review information.

The reporting user remains the owner of the student-facing Report view.

### 2.2 Staff / School IT Staff

An authenticated user with the `staff` role may:

- access the IT Report Review queue;
- view Reports submitted by users;
- view the analysis evidence attached to a Report;
- view the minimal reporter information required for investigation;
- change the priority of an unfinished Report;
- take responsibility for an unassigned Report;
- view the staff member currently assigned to a Report;
- send messages to the reporting user within a Report;
- view the Report's communication history;
- mark a Report as Under Review;
- record a final human assessment;
- provide a final reviewer note; and
- complete a Report.

A staff member must not gain access to unrelated private user information merely because they can review Reports.

Reporting access must not expose:

- passwords or password hashes;
- authentication tokens;
- awareness assessment answers;
- phishing-identification assessment answers;
- training records;
- unrelated Analysis History; or
- other unnecessary account information.

### 2.3 Admin

An authenticated user with the `admin` role has all Reporting V1 review capabilities available to staff.

In addition, an admin may assign or reassign an unfinished Report to an authorized `staff` or `admin` account.

This provides administrative oversight when a Report needs to be directed to a particular IT reviewer.

Admin privileges within Reporting V1 do not grant unrestricted access to unrelated student learning or authentication data.

### 2.4 Assignment Responsibilities

A newly submitted Report is initially unassigned.

Staff may take an unassigned Report for themselves.

Admins may:

- take an unassigned Report for themselves;
- assign an unassigned Report to a staff/admin account; or
- reassign an unfinished Report when necessary.

A normal user must never control assignment.

Assignment identifies responsibility for handling the Report. It does not itself determine the Report's human assessment.

Reporting V1 does not implement automatic assignment or workload balancing.

### 2.5 Communication Responsibilities

Each Report may contain a communication thread between:

- the reporting user; and
- authorized IT staff/admin reviewers.

Messages exist only within the context of that Report.

The reporting user may send messages only in their own Report.

Staff/admin may send messages only through authorized IT review access.

Each message's sender identity, sender role, and creation time must be generated from authenticated server-side information.

Clients must never be allowed to choose another message sender or sender role.

Report messages must not change:

- automated analysis evidence;
- workflow status;
- priority;
- assignment;
- human assessment; or
- reviewer metadata.

Those fields remain controlled through their dedicated review operations.

### 2.6 Internal Staff Notes

Reporting V1 does not include a separate staff-only discussion thread.

The existing `reviewerNote` remains the final review note that may be shown to the reporting user.

If staff-only investigation notes are needed later, they must be implemented separately with explicit authorization and visibility rules.

This avoids accidentally exposing internal IT notes through the student-facing communication thread.

### 2.7 Completed Reports

When a Report reaches `completed`:

- its final assessment becomes read-only;
- its final reviewer note becomes read-only;
- its assignment becomes read-only;
- its priority becomes read-only; and
- its workflow status cannot be reopened in V1.

The completed Report and its existing communication history remain viewable by authorized participants.

Reporting V1 does not allow new messages after completion.

### 2.8 Separation of Responsibilities

PhishGuard's automated URL Analyzer and the IT reporting workflow serve different purposes.

The URL Analyzer provides an automated heuristic assessment.

The reporting user provides incident context.

IT staff/admin performs the human investigation and records the human assessment.

These responsibilities must remain distinct in both backend data and frontend presentation.

---

## 3. Report Data Model

Reporting V1 introduces a separate `Report` model and a separate `ReportMessage` model.

A `Report` represents a suspicious-URL incident ticket submitted for school IT review.

A `ReportMessage` represents one message exchanged within that Report.

### 3.1 Report Fields

A Report contains:

- `ticketNumber`
  - Required.
  - Unique.
  - Immutable after creation.
  - Human-readable identifier generated by the server.
  - Must never be accepted from the client.
  - Format:
    - `PG-YYYY-NNNNNN`
  - Example:
    - `PG-2026-000123`
  - The MongoDB `_id` remains the internal database identifier.
  - The ticket number exists for human-facing identification and communication.

- `user`
  - MongoDB ObjectId referencing `User`.
  - Required.
  - Identifies the user who submitted the Report.
  - Must always be derived from the authenticated user.
  - Must never be accepted from the client.

- `analysis`
  - MongoDB ObjectId referencing `Analysis`.
  - Required when the Report is created.
  - Identifies the original Analysis that caused the Report to be submitted.
  - The referenced Analysis must belong to the authenticated reporting user.
  - The reference may later become unresolved if the user deletes the original Analysis.

- `analysisSnapshot`
  - Required.
  - Immutable after Report creation.
  - Generated by the server from the referenced Analysis.
  - Contains:
    - `url`
    - `risk`
    - `score`
    - `indicators`
  - The client must never provide or modify these values.
  - Explainable `findings` are not persisted in the snapshot.
  - Findings are reconstructed server-side using the existing Explainable URL Analysis findings logic.

- `reason`
  - Required.
  - User-selected controlled enum.
  - Allowed values:
    - `suspected_phishing`
    - `credential_request`
    - `impersonation`
    - `other`

- `details`
  - Optional.
  - User-provided initial incident context.
  - Trimmed.
  - Maximum length: 500 characters.
  - Becomes immutable after submission.
  - Additional context after submission must use the Report communication thread.

- `status`
  - Required.
  - Server-controlled workflow state.
  - Allowed values:
    - `submitted`
    - `under_review`
    - `completed`
  - Defaults to `submitted`.

- `priority`
  - Required.
  - IT-controlled operational priority.
  - Allowed values:
    - `low`
    - `normal`
    - `high`
  - Defaults to `normal`.
  - Must not be accepted from the reporting user during submission.
  - Must not be automatically derived from the URL Analyzer risk level.
  - Represents IT handling priority, not automated URL risk.

- `assignedTo`
  - MongoDB ObjectId referencing `User`.
  - Defaults to `null`.
  - Identifies the staff/admin account currently responsible for the Report.
  - A newly submitted Report is unassigned.
  - Assignment is controlled by authorized IT operations.
  - The assigned account must have the `staff` or `admin` role.

- `assessment`
  - Required.
  - Server-controlled human-review result.
  - Allowed values:
    - `pending`
    - `phishing`
    - `suspicious`
    - `no_threat_identified`
  - Defaults to `pending`.

- `reviewerNote`
  - Optional final reviewer-provided text.
  - Trimmed.
  - Maximum length: 1000 characters.
  - May only be created through an authorized review operation.
  - May be shown to the reporting user.
  - Must not be used as a private staff-only note.

- `reviewedBy`
  - MongoDB ObjectId referencing `User`.
  - Defaults to `null`.
  - Identifies the staff/admin account that completed the final human assessment.
  - Must be derived from the authenticated reviewer.
  - Must never be accepted from the client.

- `reviewedAt`
  - Date.
  - Defaults to `null`.
  - Set by the server when the Report reaches `completed`.

- `createdAt`
  - Automatically generated timestamp.

- `updatedAt`
  - Automatically generated timestamp.

### 3.2 Ticket Number Generation

Ticket numbers must be generated by the backend.

The format is:

`PG-YYYY-NNNNNN`

Where:

- `PG` identifies PhishGuard;
- `YYYY` is the year in which the Report was created; and
- `NNNNNN` is a zero-padded numeric sequence.

Example:

`PG-2026-000123`

Ticket numbers must be unique.

The implementation must generate ticket numbers in a concurrency-safe manner so simultaneous Report submissions cannot receive the same number.

The frontend must never generate or predict ticket numbers.

The numeric sequence does not need to reset each year in V1. The displayed year represents the Report creation year.

The ticket number is a human-readable identifier and must not replace server-side authorization or ownership checks.

### 3.3 Analysis Snapshot

The Report stores an immutable snapshot of the automated analysis result that existed when the Report was submitted.

The snapshot contains only:

- `url`
- `risk`
- `score`
- `indicators`

This preserves the evidence that prompted the Report without duplicating the entire Analysis document.

Structured Explainable URL Analysis findings must not be persisted separately in the Report.

When Report data is returned, findings may be reconstructed from the snapshot's indicators using the existing server-authoritative findings mapping.

### 3.4 Source Analysis Deletion

A user may later delete the original Analysis from their Analysis History.

Deleting the source Analysis must not:

- delete the Report;
- delete Report messages;
- modify the analysis snapshot;
- remove the ticket number;
- reset workflow information; or
- prevent IT staff from reviewing the Report.

The Report remains a valid incident record using its immutable `analysisSnapshot`.

The `analysis` reference may therefore point to an Analysis that no longer exists.

### 3.5 Priority

Report priority is operational metadata used by school IT staff.

Allowed values are:

- `low`
- `normal`
- `high`

All new Reports begin with:

`priority: normal`

Priority must remain independent from automated URL Analyzer risk.

For example:

- an Analysis may have `risk: high` while the Report has `priority: normal`; or
- an Analysis may have `risk: low` while IT assigns `priority: high` because of additional incident context.

The application must not automatically convert automated risk into ticket priority.

### 3.6 Assignment

A new Report contains:

`assignedTo: null`

Staff may claim an unassigned Report for themselves.

Admins may assign or reassign unfinished Reports to an authorized staff/admin account.

Assignment does not automatically complete the Report or determine its assessment.

The assigned user must exist and must have either the `staff` or `admin` role.

Assignment becomes read-only when the Report is completed.

### 3.7 ReportMessage Model

Report communication must be stored separately from the Report document rather than as an ever-growing embedded array.

Each `ReportMessage` contains:

- `report`
  - MongoDB ObjectId referencing `Report`.
  - Required.

- `sender`
  - MongoDB ObjectId referencing `User`.
  - Required.
  - Derived from the authenticated user.
  - Must never be accepted from the client.

- `senderRole`
  - Required.
  - Snapshot of the authenticated sender's role when the message is created.
  - Allowed values:
    - `user`
    - `staff`
    - `admin`
  - Derived server-side.
  - Must never be accepted from the client.

- `message`
  - Required.
  - Plain-text message content.
  - Trimmed.
  - Maximum length: 1000 characters.

- `createdAt`
  - Automatically generated timestamp.

- `updatedAt`
  - May exist because of schema timestamps, but Reporting V1 does not provide message editing.

Report messages must not contain:

- HTML supplied for rendering;
- file attachments;
- authentication information; or
- server-controlled Report fields.

### 3.8 Communication History

Messages must be associated with exactly one Report.

The reporting user may read and send messages only for their own Report.

Authorized staff/admin may read and send messages through IT review access.

Messages must be returned in deterministic chronological order:

`createdAt` ascending, then `_id` ascending.

Reporting V1 does not support:

- message editing;
- message deletion;
- attachments;
- reactions;
- read receipts; or
- private staff-only messages.

No new messages may be added after the Report reaches `completed`.

Existing messages remain readable after completion.

### 3.9 Separation from Analysis Status

The existing Analysis status values:

- `active`
- `reviewed`
- `archived`

remain independent from Reporting.

Creating, assigning, reviewing, prioritizing, messaging within, or completing a Report must not automatically modify the source Analysis status.

Changing an Analysis status must not modify:

- Report status;
- Report priority;
- assignment;
- human assessment; or
- Report messages.

The Analysis status system may be reconsidered separately during the final PhishGuard feature review.

### 3.10 Report Relationships

Conceptually, the Reporting data relationships are:

`User → Analysis → Report → ReportMessages`

A Report also optionally references:

`Report → assignedTo (Staff/Admin User)`

and after completion:

`Report → reviewedBy (Staff/Admin User)`

The Report snapshot preserves the original automated evidence even when the source Analysis is later unavailable.

---

## 4. Report Submission Rules

### 4.1 Creating a Report

An authenticated user may create a Report only from an Analysis that they own.

The client submits only:

- `analysisId`
- `reason`
- `details` (optional)

Example request:

```json
{
  "analysisId": "<analysis ObjectId>",
  "reason": "suspected_phishing",
  "details": "I received this link in a message claiming to be from the school."
}
```

The server must derive all other Report information from trusted server-side data.

### 4.2 Submission Process

When a Report is submitted, the server must:

1. Authenticate the requesting user.
2. Validate the request body.
3. Validate `analysisId`.
4. Find the referenced Analysis.
5. Verify that the Analysis belongs to `req.user.userId`.
6. Verify that the user has not already created a Report for that Analysis.
7. Generate a unique human-readable ticket number.
8. Generate the immutable `analysisSnapshot` from the stored Analysis.
9. Create the Report with:
   - `user` derived from `req.user.userId`;
   - the validated Analysis reference;
   - the generated ticket number;
   - the server-generated analysis snapshot;
   - the validated reason;
   - the validated optional details;
   - `status: submitted`;
   - `priority: normal`;
   - `assignedTo: null`;
   - `assessment: pending`;
   - `reviewerNote` unset or empty according to the model;
   - `reviewedBy: null`; and
   - `reviewedAt: null`.
10. Return the safe user-facing Report representation.

Creating a Report must not modify the source Analysis.

### 4.3 Client-Controlled Submission Fields

The reporting user may provide only:

- `analysisId`
- `reason`
- `details`

The client must not be allowed to provide or override:

- `ticketNumber`
- `user`
- `analysisSnapshot`
- `status`
- `priority`
- `assignedTo`
- `assessment`
- `reviewerNote`
- `reviewedBy`
- `reviewedAt`
- timestamps
- message sender information

Unknown or additional request-body fields must be rejected rather than silently accepted.

### 4.4 Report Reason

`reason` is required.

Allowed values are:

- `suspected_phishing`
- `credential_request`
- `impersonation`
- `other`

The frontend may display readable labels, but the API must use the defined enum values.

### 4.5 Initial Details

`details` is optional.

When supplied:

- it must be a string;
- it must be trimmed; and
- it must not exceed 500 characters.

The initial details field represents the reporting user's context at the time the ticket is created.

After submission, `details` becomes immutable.

If the student or IT staff needs to provide additional information later, they must use the Report communication thread.

### 4.6 Initial Ticket State

Every newly created Report must begin with:

```text
status: submitted
priority: normal
assignedTo: null
assessment: pending
reviewedBy: null
reviewedAt: null
```

The reporting user cannot choose a different initial workflow state.

Automated URL risk must not automatically determine Report priority.

Creating a Report does not automatically assign it to a staff member.

### 4.7 Duplicate Reports

A user may create only one Report for a particular Analysis.

The combination of:

`user + analysis`

must be unique.

The backend must enforce this with a database-level unique compound index.

An application-level duplicate check may also be used to provide a clearer response, but it must not replace the database constraint.

If the same user attempts to report the same Analysis again, the request must be rejected with an appropriate conflict response.

A completed Report does not make the original Analysis eligible for another Report.

### 4.8 Same URL in Different Analyses

Reporting V1 does not globally deduplicate Reports based on URL text.

A different Analysis of the same URL may result in a different Report.

Different users may also independently report URLs that happen to be identical.

This is intentional because:

- different students may encounter the same suspicious URL independently;
- their incident context may differ; and
- ownership and reporting history remain user-specific.

Reporting V1 does not automatically merge these Reports.

### 4.9 Automated Risk Does Not Restrict Reporting

A user may create a Report regardless of whether the source Analysis is classified as:

- `low`
- `medium`
- `high`

The backend must not require a minimum automated risk score for reporting.

This is intentional because the URL Analyzer is heuristic and may not identify every suspicious characteristic.

For example, a student may have contextual information that is not represented by URL structure alone.

### 4.10 Ticket Number Generation

The ticket number must be generated as part of the server-controlled Report creation process.

The implementation must not use an unsafe strategy such as:

`number of existing Reports + 1`

because simultaneous requests could generate duplicate ticket numbers.

Ticket sequence allocation must be concurrency-safe.

The database must also enforce ticket-number uniqueness.

Failure to allocate a valid unique ticket number must not result in a partially created Report.

### 4.11 Messages at Submission Time

Creating a Report does not automatically create a `ReportMessage`.

The initial `details` field contains the user's initial incident description.

Messages are created only when an authorized participant explicitly sends a message after the Report exists.

This keeps:

- original submission context; and
- subsequent conversation

as distinct concepts.

### 4.12 User Modification After Submission

After a Report has been created, the reporting user cannot modify:

- ticket number;
- source Analysis reference;
- analysis snapshot;
- reason;
- initial details;
- workflow status;
- priority;
- assignment;
- assessment;
- reviewer note;
- reviewer identity; or
- review timestamps.

The user may only participate through operations explicitly permitted elsewhere in this specification, such as:

- viewing their Report; and
- sending Report messages while the Report remains unfinished.

### 4.13 Report Cancellation and Deletion

Reporting V1 does not provide user-side cancellation or deletion of submitted Reports.

Staff/admin also do not receive a hard-delete Report endpoint in V1.

This preserves the Report as an incident record once it has been submitted to school IT.

Deleting the original Analysis remains separate and must not delete the Report.

### 4.14 Submission Result

After successful creation, the user-facing response must clearly provide the generated ticket number.

For example:

`PG-2026-000123`

The frontend should use this human-readable ticket number when presenting the Report to the user.

The MongoDB Report ID remains available internally for API routing and database relationships but should not be treated as the user-facing ticket identifier.

---

## 5. IT Staff Review and Ticket Management Rules

### 5.1 Review Authorization

Only authenticated users with the `staff` or `admin` role may access IT Report Review operations.

IT review endpoints must use:

- the existing `authenticate` middleware; and
- `authorizeRoles("staff", "admin")`.

Normal users must not be able to access IT review operations even if they know a Report ID or ticket number.

### 5.2 Ticket Workflow

A Report has one of the following workflow statuses:

- `submitted`
  - The Report has been received by school IT and is waiting for investigation.

- `under_review`
  - IT staff has begun investigating the Report.

- `completed`
  - IT investigation has concluded and a final human assessment has been recorded.

The normal workflow is:

`submitted → under_review → completed`

A Report may also move directly:

`submitted → completed`

when an authorized reviewer can complete the investigation immediately.

A completed Report is final in Reporting V1 and cannot be reopened.

### 5.3 Claiming an Unassigned Report

A Report is initially created with:

`assignedTo: null`

An authenticated staff member may claim an unfinished, unassigned Report for themselves.

When a staff member claims a Report:

- `assignedTo` is set to `req.user.userId`;
- the client must not provide another user ID;
- the Report must not already be completed; and
- the Report must currently be unassigned.

Claiming a Report does not automatically determine its assessment.

If the Report is still `submitted`, claiming it does not have to change its status automatically.

Starting the investigation is represented separately by changing the status to `under_review`.

### 5.4 Administrative Assignment

An admin may assign an unfinished Report to an authorized:

- `staff`; or
- `admin`

account.

An admin may also reassign an unfinished Report when necessary.

Before assignment, the backend must verify that the target account:

- exists;
- is active;
- has the `staff` or `admin` role.

Normal users cannot assign Reports.

Staff cannot assign Reports to other users in V1.

Assignment and reassignment are prohibited after completion.

### 5.5 Priority Management

Allowed Report priorities are:

- `low`
- `normal`
- `high`

All Reports begin with:

`priority: normal`

Only staff/admin may change priority.

Priority represents IT handling urgency and must remain separate from the automated URL Analyzer risk level.

Changing priority must not:

- modify automated risk;
- modify automated score;
- modify the human assessment;
- modify assignment; or
- automatically change workflow status.

Priority becomes read-only after completion.

### 5.6 Beginning Investigation

Authorized staff/admin may change an unfinished Report from:

`submitted → under_review`

This indicates that IT investigation has begun.

Changing the status to `under_review` must not create a final assessment.

While the Report is `under_review`:

`assessment` must remain `pending`.

The assigned reviewer and the staff member performing an action do not necessarily need to be the same account for read access or communication.

However, completion rules defined below determine who may finalize the Report.

### 5.7 Communication During Investigation

While a Report is `submitted` or `under_review`, authorized participants may exchange Report messages.

The reporting user may:

- read messages belonging to their own Report; and
- send messages in their own Report.

Authorized staff/admin may:

- read the Report's communication history; and
- send messages through IT review access.

Messages must not automatically change:

- status;
- priority;
- assignment;
- assessment; or
- reviewer metadata.

Communication is intended for incident-specific context such as:

- where the suspicious URL was encountered;
- what the message containing the URL claimed;
- whether the student interacted with the URL; or
- clarification requested by IT staff.

The system must not require users to provide passwords, authentication tokens, or other secrets through Report messages.

### 5.8 Message Immutability

Once a Report message has been created:

- the sender cannot be changed;
- the sender role cannot be changed;
- the message cannot be edited in V1; and
- the message cannot be deleted in V1.

This preserves the communication history associated with the incident.

### 5.9 Human Assessment

Human assessment remains separate from PhishGuard's automated URL risk classification.

Allowed values are:

- `pending`
- `phishing`
- `suspicious`
- `no_threat_identified`

`pending` means that no final human determination has been recorded.

`phishing` means the reviewer determined that the available evidence supports classifying the reported URL as a phishing attempt.

`suspicious` means the reviewer identified concerning characteristics but did not make a definitive phishing determination.

`no_threat_identified` means the reviewer did not identify a threat based on the information available during the investigation.

`no_threat_identified` must not be presented as a permanent guarantee that a URL is safe.

### 5.10 Status and Assessment Consistency

The backend must enforce the following combinations.

For `submitted`:

`assessment: pending`

For `under_review`:

`assessment: pending`

For `completed`:

`assessment` must be exactly one of:

- `phishing`
- `suspicious`
- `no_threat_identified`

The following states are invalid:

- `submitted` with a final assessment;
- `under_review` with a final assessment; or
- `completed` with `pending`.

The backend must enforce these rules regardless of frontend behavior.

### 5.11 Completing a Report

An unfinished Report may be completed only by authorized IT personnel.

Before completion, the Report must be assigned.

For a staff reviewer:

- the Report must be assigned to that staff member.

For an admin reviewer:

- the admin may complete a Report assigned to themselves; or
- the admin may complete an assigned Report as part of administrative oversight.

An unassigned Report must not be completed.

Completing a Report requires a final assessment of:

- `phishing`;
- `suspicious`; or
- `no_threat_identified`.

The reviewer may also provide an optional final `reviewerNote`.

When completion succeeds, the server must:

1. set `status` to `completed`;
2. store the selected final assessment;
3. store the validated reviewer note when provided;
4. set `reviewedBy` to `req.user.userId`; and
5. set `reviewedAt` using the server's current time.

The client must never provide `reviewedBy` or `reviewedAt`.

### 5.12 Final Reviewer Note

The final reviewer note:

- is optional;
- is plain text;
- must be trimmed;
- must not exceed 1000 characters;
- is recorded when the Report is completed; and
- may be shown to the reporting user.

The final reviewer note is different from the communication thread.

Messages represent the conversation during investigation.

The reviewer note represents the IT reviewer's final explanatory note associated with the completed assessment.

Reporting V1 does not provide a separate private staff-only final note.

### 5.13 Completed Report Immutability

After a Report reaches `completed`, the following become immutable:

- workflow status;
- priority;
- assignment;
- assessment;
- reviewer note;
- reviewedBy;
- reviewedAt;
- reason;
- initial details;
- analysis snapshot.

No new Report messages may be created after completion.

Existing Report messages remain readable.

Reporting V1 does not include:

- reopening;
- reassignment after completion;
- additional review rounds; or
- editing a completed assessment.

### 5.14 Relationship Between Assignment and Review

Assignment represents responsibility for handling the incident.

`reviewedBy` represents the authenticated IT user who actually completed the final review.

These fields may therefore differ in an administrative completion case.

For example, a Report may be assigned to a staff member but ultimately completed by an admin exercising administrative oversight.

The frontend should present these concepts separately when both are relevant.

### 5.15 Relationship to Automated Analysis

IT actions must never overwrite the original automated Analysis snapshot.

For example, a Report may contain:

`Automated Risk: High`

and later receive:

`IT Assessment: No Threat Identified`

Alternatively:

`Automated Risk: Low`

may later receive:

`IT Assessment: Phishing`

These are not invalid states.

They represent two different processes:

- automated heuristic URL analysis; and
- human IT investigation.

### 5.16 No Automatic Security Verdict

The system must not automatically select a human assessment based on:

- automated risk;
- automated score;
- indicators;
- findings;
- priority; or
- report reason.

The final human assessment must result from an explicit authorized IT review action.

---

## 6. API Endpoints and Response Data

All Reporting V1 endpoints require authentication.

The backend is the security boundary. Frontend route protection, hidden controls, or client-side role checks must not be relied upon for authorization.

Reporting V1 separates:

- student-facing Report operations;
- Report communication;
- IT review operations;
- assignment and priority management; and
- final completion.

### 6.1 Submit a Report

`POST /api/reports`

Available to:

- `user`
- `staff`
- `admin`

Request body:

```json
{
  "analysisId": "<analysis ObjectId>",
  "reason": "suspected_phishing",
  "details": "Optional initial incident context."
}
```

The server must perform the submission process defined in Section 4.

On success, the response must include the generated human-readable `ticketNumber`.

### 6.2 View Own Reports

`GET /api/reports`

Available to all authenticated roles.

Returns only Reports where:

`report.user === req.user.userId`

Reports must be returned newest first using deterministic ordering:

`createdAt` descending, then `_id` descending.

Staff/admin roles must not bypass ownership through this endpoint.

### 6.3 View One Own Report

`GET /api/reports/:reportId`

Available to all authenticated roles.

The requested Report must belong to:

`req.user.userId`

The response must include the safe student-facing Report DTO.

A staff/admin account attempting to view another user's Report through this endpoint must not receive privileged access.

Cross-user IT access must use the dedicated review endpoints.

### 6.4 View Messages for Own Report

`GET /api/reports/:reportId/messages`

Available to the owner of the Report.

Returns the communication history in deterministic chronological order:

`createdAt` ascending, then `_id` ascending.

The response must use safe message DTOs.

### 6.5 Send Message in Own Report

`POST /api/reports/:reportId/messages`

Available to the owner of the Report while the Report is unfinished.

Request body:

```json
{
  "message": "Additional context about the suspicious link."
}
```

The server must derive:

- `report`;
- `sender`; and
- `senderRole`

from authenticated server-side information.

The user must not be able to send a message after the Report reaches `completed`.

### 6.6 View IT Review Queue

`GET /api/reports/review`

Available only to:

- `staff`
- `admin`

Returns Reports available to the school IT review workflow.

The default ordering must prioritize:

1. unfinished Reports before completed Reports;
2. higher operational priority before lower priority; and
3. older submissions before newer submissions within equivalent workflow/priority groups.

For unfinished Reports, priority order is:

`high → normal → low`

Within the same priority and workflow state:

`createdAt` ascending, then `_id` ascending.

Completed Reports appear after unfinished Reports and use deterministic ordering.

Reporting V1 does not require user-controlled sorting, search, filtering, or pagination.

### 6.7 View One Report for IT Review

`GET /api/reports/review/:reportId`

Available only to:

- `staff`
- `admin`

Returns the information required to investigate the selected Report regardless of who submitted it.

The response must include:

- ticket information;
- immutable analysis evidence;
- reconstructed findings;
- submission context;
- workflow state;
- priority;
- assignment;
- human assessment;
- final reviewer information when available; and
- minimal reporter identity.

It must not expose unrelated private user data.

### 6.8 View Messages for IT Review

`GET /api/reports/review/:reportId/messages`

Available only to:

- `staff`
- `admin`

Returns the Report's communication history in chronological order.

Staff/admin access to messages must not grant access to unrelated information about the reporter.

### 6.9 Send IT Message

`POST /api/reports/review/:reportId/messages`

Available only to:

- `staff`
- `admin`

Request body:

```json
{
  "message": "Can you confirm where you received this link?"
}
```

The server derives sender identity and sender role from the authenticated account.

Messages may be created only while the Report is unfinished.

Sending a message must not automatically change:

- workflow status;
- priority;
- assignment;
- assessment; or
- review metadata.

### 6.10 Claim an Unassigned Report

`PATCH /api/reports/review/:reportId/claim`

Available to:

- `staff`
- `admin`

No target user ID is accepted.

The server assigns:

`assignedTo = req.user.userId`

The operation succeeds only when:

- the Report exists;
- the Report is unfinished;
- the Report is currently unassigned; and
- the authenticated account is authorized to review Reports.

Attempting to claim an already assigned Report must return an appropriate conflict response.

### 6.11 Assign or Reassign a Report

`PATCH /api/reports/review/:reportId/assignment`

Available only to:

- `admin`

Request body:

```json
{
  "assignedTo": "<staff-or-admin User ObjectId>"
}
```

The server must verify that the target account:

- exists;
- is active; and
- has the `staff` or `admin` role.

The operation is allowed only while the Report is unfinished.

Reporting V1 does not provide assignment to normal users.

### 6.12 Change Report Priority

`PATCH /api/reports/review/:reportId/priority`

Available to:

- `staff`
- `admin`

Request body:

```json
{
  "priority": "high"
}
```

Allowed values:

- `low`
- `normal`
- `high`

Priority may be changed only while the Report is unfinished.

Changing priority must not modify any other Report state.

### 6.13 Begin Review

`PATCH /api/reports/review/:reportId/start`

Available to:

- `staff`
- `admin`

This operation changes:

`submitted → under_review`

The operation must not set a final assessment.

`assessment` remains:

`pending`

Calling this operation for an already completed Report must be rejected.

Calling it for an already `under_review` Report must not create a second transition or alter review metadata.

### 6.14 Complete Review

`PATCH /api/reports/review/:reportId/complete`

Available only to authorized staff/admin according to the completion rules in Section 5.

Request body:

```json
{
  "assessment": "phishing",
  "reviewerNote": "Optional final explanation for the reporting user."
}
```

Allowed final assessments:

- `phishing`
- `suspicious`
- `no_threat_identified`

`reviewerNote` is optional.

The Report must already be assigned before completion.

For a staff account, the Report must be assigned to that staff account.

An admin may complete an assigned Report according to the administrative oversight rules defined in Section 5.

On successful completion, the server must:

- set `status: completed`;
- store the final assessment;
- store the validated reviewer note when supplied;
- set `reviewedBy` from `req.user.userId`; and
- set `reviewedAt` using server time.

The client must not provide `status`, `reviewedBy`, or `reviewedAt` directly.

### 6.15 User-Facing Report DTO

A safe user-facing Report representation may contain:

- `id`
- `ticketNumber`
- `analysisId`
- `analysisSnapshot`
  - `url`
  - `risk`
  - `score`
  - `indicators`
  - `findings`
- `reason`
- `details`
- `status`
- `priority`
- safe assigned-staff information when available
- `assessment`
- `reviewerNote`
- safe reviewer information when available
- `reviewedAt`
- `createdAt`
- `updatedAt`

If the source Analysis has been deleted, `analysisId` may remain as the historical reference while the snapshot continues to provide the evidence required by the Report.

### 6.16 User-Facing Assignment DTO

When assignment information is shown to the reporting user, it must expose only what is necessary.

A safe assigned-staff representation may contain:

- `name`
- `role`

The assigned staff member's:

- email;
- account status;
- account timestamps; and
- other private account fields

must not be exposed through the student-facing Report DTO.

### 6.17 User-Facing Reviewer DTO

When final reviewer information is shown to the reporting user, it may contain only:

- `name`
- `role`

Reviewer email and other account fields are not required.

### 6.18 IT Review DTO

The IT review representation may contain:

- `id`
- `ticketNumber`
- immutable analysis snapshot;
- reconstructed findings;
- reason;
- initial details;
- workflow status;
- priority;
- safe assignment information;
- human assessment;
- final reviewer note;
- safe reviewer information;
- submission and review timestamps; and
- minimal reporter identity.

Minimal reporter identity is limited to:

- `id`
- `name`
- `email`

The IT review DTO must not expose:

- password hashes;
- authentication tokens;
- `isActive` unless required internally for an assignment validation operation;
- account creation/update timestamps;
- awareness assessment answers;
- phishing-identification assessment answers;
- training records;
- unrelated Analysis History; or
- unrelated private account information.

### 6.19 Safe IT Assignment Information

Within IT review responses, assignment information may contain:

- assigned user's `id`;
- `name`;
- `email`;
- `role`.

This information is available only through staff/admin review access.

### 6.20 Report Message DTO

A safe Report message representation may contain:

- `id`
- `message`
- sender:
  - `name`
  - `role`
- `createdAt`

For IT review responses, sender `id` may also be included when operationally useful.

The response must not expose the complete User document.

The stored `senderRole` snapshot may be used to preserve the role associated with the message at creation time.

### 6.21 Assignment Candidate Data

To support the admin assignment and reassignment interface, Reporting V1 provides:

`GET /api/reports/review/assignees`

Available only to:

- `admin`

The response must include only active accounts with role:

- `staff`; or
- `admin`.

A safe assignment-candidate DTO may contain:

- `id`
- `name`
- `email`
- `role`

No additional User fields should be exposed.

### 6.22 Route Ordering

Because routes such as:

- `/api/reports/review`
- `/api/reports/review/assignees`
- `/api/reports/:reportId`

share the same route prefix, Express route definitions must be ordered or structured so static review routes are not accidentally interpreted as `:reportId`.

The implementation must not rely on malformed ObjectId handling to compensate for incorrect route ordering.

### 6.23 Cache Control

Authenticated Reporting responses containing Report, message, reviewer, assignment, or reporter information must use:

`Cache-Control: no-store`

This applies to:

- personal Report responses;
- personal message responses;
- IT review queue responses;
- IT Report detail responses;
- IT message responses; and
- assignment-candidate responses.

### 6.24 API Response Consistency

Reporting V1 should follow the existing PhishGuard API response and error conventions.

The implementation should use dedicated service/controller logic rather than placing business rules directly into route definitions.

Ticket generation, snapshot creation, safe DTO construction, workflow validation, assignment validation, and message authorization must remain server-authoritative.

---

## 7. Validation, Error Handling, and Security Requirements

### 7.1 General Validation

All Reporting V1 input must be validated on the server.

Frontend validation may improve usability but must not be treated as a security control.

Each endpoint must use an explicit allowlist of accepted request fields.

Unexpected fields must be rejected rather than silently accepted.

User-provided text must be treated as untrusted plain text.

### 7.2 ObjectId Validation

All request values used as MongoDB ObjectIds must be validated before database operations.

This includes:

- `analysisId`
- `reportId`
- `assignedTo`
- any other User or Report identifier accepted by an endpoint

Malformed ObjectIds must return an appropriate client error and must not cause an unhandled Mongoose error.

### 7.3 Report Submission Validation

For:

`POST /api/reports`

accepted fields are only:

- `analysisId`
- `reason`
- `details`

`analysisId`:

- is required;
- must be a valid ObjectId;
- must reference an existing Analysis; and
- must reference an Analysis owned by the authenticated user.

`reason`:

- is required;
- must be a string; and
- must be exactly one of:
  - `suspected_phishing`
  - `credential_request`
  - `impersonation`
  - `other`

`details`:

- is optional;
- must be a string when supplied;
- must be trimmed; and
- must not exceed 500 characters.

The server must reject attempts to provide server-controlled Report fields.

### 7.4 Message Validation

For both user and IT message-creation endpoints, the only accepted request field is:

- `message`

`message`:

- is required;
- must be a string;
- must be trimmed;
- must not be empty after trimming; and
- must not exceed 1000 characters.

Message content must be stored and returned as plain text.

The application must not intentionally render user-supplied message content as executable HTML.

The client must not provide:

- `sender`
- `senderRole`
- `report`
- message timestamps
- another user's identity

These values must be derived or generated by the server.

### 7.5 Message Authorization

A normal user may read or create messages only for a Report they own.

Knowing another Report's:

- MongoDB ID; or
- ticket number

must not grant access to its messages.

Staff/admin may access Report messages only through authenticated IT review endpoints.

No participant may create new messages after a Report reaches `completed`.

Existing messages remain readable by authorized participants after completion.

### 7.6 Claim Validation

For:

`PATCH /api/reports/review/:reportId/claim`

the server must verify that:

- the authenticated account has role `staff` or `admin`;
- the Report exists;
- the Report is not completed; and
- `assignedTo` is currently null.

The endpoint must not accept a target User ID.

The authenticated reviewer becomes the assigned account.

A conflicting attempt to claim an already assigned Report must not silently overwrite the existing assignment.

### 7.7 Assignment Validation

For:

`PATCH /api/reports/review/:reportId/assignment`

the only accepted request field is:

- `assignedTo`

The endpoint is available only to `admin`.

The target account must:

- have a valid ObjectId;
- exist;
- have `isActive: true`; and
- have role `staff` or `admin`.

The backend must reject assignment to:

- a normal user;
- an inactive account;
- a nonexistent account; or
- a malformed User ID.

Assignment and reassignment must be rejected after Report completion.

### 7.8 Priority Validation

For:

`PATCH /api/reports/review/:reportId/priority`

the only accepted request field is:

- `priority`

Allowed values are:

- `low`
- `normal`
- `high`

Only `staff` and `admin` may change priority.

Priority changes must be rejected after completion.

The backend must not automatically derive priority from:

- automated risk;
- automated score;
- report reason; or
- human assessment.

### 7.9 Start-Review Validation

For:

`PATCH /api/reports/review/:reportId/start`

the server must enforce:

`submitted → under_review`

Starting review must not set a final assessment.

The Report must continue to contain:

`assessment: pending`

Completed Reports must reject the operation.

An already `under_review` Report must not be reset or otherwise modified through this endpoint.

### 7.10 Completion Validation

For:

`PATCH /api/reports/review/:reportId/complete`

accepted request fields are only:

- `assessment`
- `reviewerNote`

`assessment` is required and must be one of:

- `phishing`
- `suspicious`
- `no_threat_identified`

`pending` is not accepted as a completion assessment.

`reviewerNote`:

- is optional;
- must be a string when supplied;
- must be trimmed; and
- must not exceed 1000 characters.

The Report must be unfinished and assigned before completion.

For staff:

`assignedTo` must equal `req.user.userId`.

For admin:

completion must follow the administrative oversight rules defined in Section 5.

The server must generate:

- `status: completed`
- `reviewedBy`
- `reviewedAt`

The client must not provide these values directly.

### 7.11 Completed Report Protection

Once `status` is `completed`, Reporting V1 must reject attempts to change:

- status;
- priority;
- assignment;
- assessment;
- reviewer note;
- reviewedBy;
- reviewedAt;
- reason;
- initial details;
- analysis snapshot.

New Report messages must also be rejected.

Completed Reports remain readable by authorized participants.

### 7.12 Authentication and RBAC

Every Reporting endpoint requires the existing `authenticate` middleware.

IT review operations require:

`authorizeRoles("staff", "admin")`

Admin-only assignment operations additionally require:

`authorizeRoles("admin")`

Authorization must never depend solely on:

- frontend route guards;
- hidden buttons;
- localStorage role values;
- client-supplied user IDs;
- client-supplied role values; or
- client-supplied assignment information.

### 7.13 Ownership Enforcement

Personal Report operations must derive ownership from:

`req.user.userId`

Database queries for student-facing Report operations must enforce ownership.

Staff/admin privileges must not bypass ownership through personal endpoints.

Cross-user access must occur only through dedicated IT review endpoints.

### 7.14 Unauthorized Resource Discovery

Personal Report and message endpoints should avoid revealing whether another user's resource exists.

If an authenticated user requests a Report they do not own, the response should behave as though no accessible Report was found.

The response must not reveal:

- the Report owner;
- ticket contents;
- workflow status;
- priority;
- assignment;
- assessment;
- messages; or
- whether the inaccessible Report belongs to another user.

### 7.15 Duplicate Submission Protection

The database must enforce a unique compound index on:

`user + analysis`

Application-level duplicate checks may provide clearer errors but must not replace the database constraint.

Duplicate submission attempts must not create additional Reports.

### 7.16 Ticket Number Integrity

`ticketNumber` must:

- be generated server-side;
- be unique;
- be immutable;
- follow the required human-readable format; and
- use concurrency-safe sequence allocation.

The database must enforce uniqueness.

Clients must not be allowed to choose, modify, or predict a ticket number as part of authorization.

Ticket numbers are identifiers, not authentication credentials.

### 7.17 Analysis Snapshot Integrity

`analysisSnapshot` must be created only from the server-side owned Analysis.

The snapshot contains only:

- `url`
- `risk`
- `score`
- `indicators`

The client must not construct or override the snapshot.

Reporting must reuse the existing server-authoritative findings reconstruction logic.

A separate client-side or Reporting-specific URL scoring algorithm must not be introduced.

### 7.18 Assignment Integrity

Assignment must never grant broader application permissions.

Being assigned to a Report does not change the assigned user's:

- account role;
- authentication permissions; or
- access to unrelated user information.

Only accounts already authorized as `staff` or `admin` may be assigned.

### 7.19 Message Sender Integrity

For every ReportMessage:

- `sender` comes from `req.user.userId`;
- `senderRole` comes from the authenticated role;
- `report` comes from the authorized route context; and
- `createdAt` is generated by the server/database.

The client must not be able to impersonate:

- another student;
- IT staff;
- an administrator; or
- another Report participant.

### 7.20 Text Content Safety

Report:

- `details`;
- messages; and
- `reviewerNote`

must be treated as untrusted plain text.

The frontend must render these values as text rather than intentionally injecting them as HTML.

Reporting V1 does not support user-provided HTML, scripts, Markdown rendering, or rich-text content.

### 7.21 Sensitive Information

PhishGuard should not request or encourage users to submit:

- passwords;
- authentication tokens;
- MFA codes;
- session cookies;
- private keys; or
- other authentication secrets

through Report details or messages.

The UI may remind users not to include passwords or other sensitive authentication information in Report conversations.

### 7.22 Safe DTO Enforcement

Reporting responses must use explicit safe DTOs.

The backend must not return complete Mongoose User documents when only identity information is needed.

Student-facing assignment/reviewer information is limited to the safe fields defined in Section 6.

IT-facing reporter information is limited to the fields required for investigation.

### 7.23 Cache Control

Authenticated Reporting responses containing Report, message, assignment, reporter, or reviewer data must use:

`Cache-Control: no-store`

### 7.24 Error Behavior

Reporting V1 must follow existing PhishGuard error-response conventions.

Expected categories include:

- `400 Bad Request`
  - malformed ObjectId;
  - missing required fields;
  - invalid enum;
  - invalid type;
  - excessive text length;
  - empty message;
  - unexpected fields;
  - invalid target assignee.

- `401 Unauthorized`
  - authentication credentials are missing.

- `403 Forbidden`
  - invalid/expired token under existing authentication behavior;
  - normal user accesses IT endpoints;
  - staff attempts an admin-only assignment;
  - staff attempts to complete a Report assigned to another reviewer.

- `404 Not Found`
  - an accessible Analysis or Report cannot be found;
  - an owned Report/message context cannot be accessed;
  - an assignment target does not exist where appropriate.

- `409 Conflict`
  - duplicate Report;
  - Report already assigned during a claim;
  - invalid workflow transition;
  - modification attempted after completion;
  - ticket-number uniqueness conflict that cannot be transparently retried.

Server errors must not expose:

- stack traces;
- database connection information;
- environment variables;
- JWT secrets;
- password hashes; or
- other sensitive internals.

### 7.25 Logging

Reporting logs must not contain:

- passwords;
- JWTs;
- JWT secrets;
- authentication cookies;
- complete authentication headers; or
- unnecessary full message bodies.

Security-relevant actions may be logged using minimal structured metadata such as:

- action type;
- Report ID;
- ticket number;
- authenticated actor ID;
- resulting status;
- resulting priority; or
- assignment target ID.

### 7.26 No Automated Definitive Verdict

Automated PhishGuard risk levels:

- `low`
- `medium`
- `high`

must not automatically become human assessments.

Likewise, operational priority:

- `low`
- `normal`
- `high`

must not be interpreted as a security verdict.

The system therefore keeps three concepts separate:

1. **Automated Risk** — produced by the URL Analyzer.
2. **Ticket Priority** — used by IT to organize work.
3. **Human Assessment** — recorded after IT investigation.

These concepts must remain separate in the database, API, and frontend.

---

## 8. Frontend Behavior and UI Requirements

Reporting V1 must provide two clearly separated frontend experiences:

1. a student/user-facing Reports experience; and
2. a staff/admin-facing IT Report Review experience.

The frontend is responsible for presentation and usability.

All ownership, authorization, assignment, workflow, and assessment rules remain enforced by the backend.

### 8.1 Creating a Report from Analysis History

The existing Analysis History interface must provide a Report action for an Analysis that has not already been reported by the authenticated user.

The action should clearly communicate that the user is submitting the suspicious URL and its PhishGuard analysis to school IT for human review.

The submission interface must display the relevant automated analysis information, including:

- URL;
- automated risk level;
- automated risk score; and
- existing explainable findings where appropriate.

The user then provides:

- report reason; and
- optional initial details.

Allowed reason labels are:

- Suspected Phishing
- Credential Request
- Impersonation
- Other

The frontend must submit the corresponding backend enum values.

### 8.2 Report Submission Disclaimer

The submission interface must explain that:

- PhishGuard's URL result is an automated heuristic assessment;
- submitting the Report sends the incident to school IT for human investigation; and
- submission itself does not confirm that the URL is phishing or malicious.

The frontend must not present automated risk as the final IT determination.

### 8.3 Sensitive Information Reminder

Near user-provided Report details and communication inputs, the frontend should remind users not to submit:

- passwords;
- MFA codes;
- authentication tokens; or
- other authentication secrets.

Reporting V1 must not ask users to provide such information.

### 8.4 Successful Report Submission

After successful submission:

- the user must receive clear confirmation;
- the generated ticket number must be shown;
- the corresponding Analysis must no longer offer another Report action;
- the new Report should become accessible through the Reports interface; and
- the user must not need to sign in again.

Example:

`Report PG-2026-000123 has been submitted to school IT.`

The frontend must safely handle a backend duplicate-report conflict.

### 8.5 Student Reports Interface

PhishGuard must provide a Reports interface for authenticated users.

The Reports interface shows only Reports belonging to the authenticated user.

Each Report summary should display:

- ticket number;
- URL;
- submission date;
- report reason;
- workflow status;
- IT priority;
- assigned IT staff when available; and
- human assessment when completed.

The ticket number should be the primary human-readable identifier.

### 8.6 Student Report Detail

Opening one of the user's Reports should provide a detailed incident view containing:

- ticket number;
- submitted URL;
- automated risk;
- automated score;
- automated findings;
- report reason;
- initial details;
- submission timestamp;
- workflow status;
- IT priority;
- assigned IT staff when available;
- communication history;
- final IT assessment when available;
- final reviewer note when available;
- final reviewer identity when available; and
- completion timestamp when available.

The interface must continue to work if the original Analysis has been deleted.

In that situation, the Report's analysis snapshot remains the displayed evidence.

### 8.7 Workflow Status Presentation

Student-facing workflow statuses should use readable labels:

- `submitted` → Submitted
- `under_review` → Under Review
- `completed` → Completed

When a Report is unfinished, the interface must make clear that the final IT assessment is still pending.

### 8.8 Priority Presentation

Priority must be clearly identified as an IT workflow priority.

Readable labels are:

- `low` → Low
- `normal` → Normal
- `high` → High

The interface must not present Report priority as though it were the automated URL risk level.

Where both appear, they should be labeled separately, for example:

`Automated Risk: High`

`IT Priority: Normal`

### 8.9 Human Assessment Presentation

Human assessment must be visually and textually separated from automated URL risk.

Readable assessment labels are:

- `pending` → Pending IT Review
- `phishing` → Phishing
- `suspicious` → Suspicious
- `no_threat_identified` → No Threat Identified

For example, the interface may legitimately show:

`Automated Risk: Low`

`IT Assessment: Suspicious`

The frontend must not treat this as contradictory or automatically overwrite either value.

### 8.10 No Threat Identified Wording

When the assessment is:

`no_threat_identified`

the UI must use wording such as:

`No Threat Identified`

It should not replace this with an absolute label such as:

`Safe`

The completed assessment represents the result of the IT investigation using the information available at that time.

### 8.11 Student Communication Thread

An unfinished Report must provide a communication interface for the reporting user.

The conversation must display messages in chronological order.

Each message should clearly identify:

- sender name;
- sender role;
- message content; and
- timestamp.

The interface must visually distinguish the reporting user's messages from IT staff/admin messages without implying unsupported authority beyond the displayed role.

### 8.12 Sending Student Messages

While the Report is:

- `submitted`; or
- `under_review`

the reporting user may send a new plain-text message.

The interface must:

- reject empty messages before submission for usability;
- respect the 1000-character backend limit;
- provide a clear send action;
- show sending/loading state where appropriate; and
- display backend validation errors safely.

The backend remains responsible for authorization and validation.

### 8.13 Completed Student Reports

When a Report reaches `completed`:

- the communication history remains visible;
- the final assessment becomes visible;
- the final reviewer note is displayed when present;
- the message composer is removed or disabled;
- the user cannot modify the Report; and
- the Report remains available as a historical incident record.

### 8.14 IT Review Navigation

Users with role:

- `staff`; or
- `admin`

must have access to an IT Report Review interface.

Normal users must not be shown IT review navigation.

Frontend role-based navigation is only a usability measure.

Backend RBAC remains authoritative.

### 8.15 IT Review Queue

The IT Review interface must display the Reports returned by:

`GET /api/reports/review`

Each queue entry should show enough information for operational use, including:

- ticket number;
- URL;
- automated risk;
- IT priority;
- report reason;
- workflow status;
- reporter identity;
- assigned reviewer when available; and
- submission date.

The frontend must preserve the server-defined queue ordering.

### 8.16 Queue Status and Assignment

The IT queue must make it clear whether a Report is:

- unassigned;
- assigned to the current reviewer;
- assigned to another reviewer; or
- completed.

An authorized staff/admin user should be able to open Reports regardless of assignment for investigation visibility.

Assignment restrictions still apply to claiming, reassignment, and completion actions.

### 8.17 Claiming a Ticket

For an unfinished, unassigned Report, staff/admin should be provided a clear action such as:

`Claim Report`

When successful:

- the current authenticated IT account becomes assigned;
- the interface updates the assignment state; and
- the ticket remains in its current workflow status unless a separate review-start action is performed.

If another reviewer claims the Report first, the frontend must handle the backend conflict and refresh or update the displayed assignment state.

### 8.18 Admin Assignment

Admins must have an interface for assigning or reassigning an unfinished Report.

The assignment control must use only eligible active staff/admin accounts returned by the backend.

Normal staff must not be shown controls for assigning a Report to another account.

The UI must not allow assignment after completion.

### 8.19 Priority Controls

For unfinished Reports, staff/admin must be able to set:

- Low
- Normal
- High

The frontend must label this control as IT priority or ticket priority.

It must not imply that changing priority changes PhishGuard's automated risk result.

### 8.20 IT Report Detail

The IT Report detail interface must clearly separate three information areas:

1. **Student Report**
   - reporter identity;
   - reason;
   - initial details;
   - ticket number;
   - submission time.

2. **PhishGuard Automated Analysis**
   - URL;
   - automated risk;
   - score;
   - indicators;
   - explainable findings;
   - heuristic disclaimer.

3. **IT Investigation**
   - workflow status;
   - priority;
   - assignment;
   - communication thread;
   - final assessment controls;
   - reviewer note;
   - review metadata.

These concepts must not be visually merged into one security verdict.

### 8.21 Starting Investigation

For a Report with status:

`submitted`

staff/admin must be able to perform the explicit Start Review action.

After success:

`status` becomes `under_review`.

The interface must not automatically choose a final assessment.

### 8.22 IT Communication

While a Report is unfinished, authorized staff/admin may send messages through the Report communication thread.

The interface should support requests for additional incident context, such as where the URL was encountered.

IT messages must be clearly identified by sender and role.

The communication interface must not provide a way to impersonate another staff member or change sender metadata.

### 8.23 Completing Investigation

The completion interface must require the reviewer to select exactly one final assessment:

- Phishing
- Suspicious
- No Threat Identified

The reviewer may provide an optional final reviewer note.

The frontend must not allow `Pending` to be selected as a completed assessment.

The completion action should clearly indicate that completing the Report makes the V1 review final.

### 8.24 Assignment Requirement for Completion

The frontend should reflect the backend completion rules.

A staff member must not be offered a normal completion action for a Report assigned to another reviewer.

An unassigned Report should prompt the authorized reviewer to claim or assign it before completion.

Admin behavior must follow the administrative oversight rules defined by the backend.

The backend remains authoritative even if frontend controls are hidden or disabled.

### 8.25 Completed IT Report

After completion:

- status is displayed as Completed;
- final assessment is displayed;
- final reviewer information is displayed;
- reviewer note is displayed when present;
- assignment becomes read-only;
- priority becomes read-only;
- conversation becomes read-only;
- review controls are removed or disabled; and
- the Report remains viewable in the IT interface.

### 8.26 Empty States

The student Reports interface must provide an understandable empty state when the user has not submitted any Reports.

The IT Review interface must provide an understandable empty state when no Reports are available.

An empty queue must not be presented as an application error.

### 8.27 Loading and Action States

Reporting interfaces must provide appropriate feedback while:

- loading Reports;
- loading a Report;
- loading messages;
- submitting a Report;
- sending a message;
- claiming a Report;
- changing priority;
- assigning a Report;
- starting review; and
- completing review.

Actions that are currently being submitted should be protected against accidental repeated submission where appropriate.

### 8.28 Error States

The frontend must safely handle:

- validation errors;
- duplicate Report conflicts;
- unauthorized access;
- forbidden role actions;
- missing Reports;
- claim conflicts;
- invalid assignment attempts;
- invalid workflow transitions;
- attempts to modify completed Reports;
- message validation failures;
- expired authentication; and
- unexpected server errors.

Raw server stack traces or internal implementation details must never be displayed.

### 8.29 Current Styling Scope

Reporting V1 should integrate with the existing PhishGuard frontend and remain usable on supported screen sizes.

Implementation should prioritize:

- clear information hierarchy;
- readable ticket information;
- obvious distinction between student and IT functions;
- clear distinction between automated analysis and human assessment; and
- accessible form/action states.

Reporting V1 does not require the final PhishGuard visual redesign.

The later dedicated UI/UX phase may substantially redesign these interfaces while preserving the Reporting V1 API, authorization, workflow, and security contracts.

### 8.30 Navigation Direction

The eventual PhishGuard navigation should treat Reporting as a major product area rather than a minor URL Analyzer action.

At minimum:

- normal users should have access to `Reports`;
- staff/admin should have access to `Reports`; and
- staff/admin should additionally have access to `IT Review`.

The exact final sidebar/navigation presentation belongs to the later UI/UX phase.

---

## 9. Testing and Verification Requirements

Reporting V1 must include automated backend tests and frontend verification covering the complete ticket lifecycle.

Tests must verify server-authoritative behavior and must not rely on frontend restrictions for security.

### 9.1 Report Creation Tests

Verify that an authenticated user can successfully create a Report from an Analysis they own.

Confirm that the created Report contains:

- a unique server-generated ticket number;
- the authenticated user as the reporter;
- the correct Analysis reference;
- the server-generated analysis snapshot;
- the submitted reason;
- the submitted optional details;
- `status: submitted`;
- `priority: normal`;
- `assignedTo: null`;
- `assessment: pending`;
- `reviewedBy: null`; and
- `reviewedAt: null`.

### 9.2 Server-Controlled Submission Fields

Verify that Report creation rejects attempts to provide unexpected or server-controlled fields such as:

- `ticketNumber`;
- `user`;
- `analysisSnapshot`;
- `status`;
- `priority`;
- `assignedTo`;
- `assessment`;
- `reviewerNote`;
- `reviewedBy`; or
- `reviewedAt`.

The client must not be able to create a Report with forged workflow or reviewer information.

### 9.3 Analysis Ownership Tests

Verify that:

- a user can report their own Analysis;
- a user cannot report another user's Analysis;
- a malformed Analysis ID is rejected; and
- a nonexistent Analysis cannot be reported.

The response for inaccessible cross-user resources must not expose another user's Analysis information.

### 9.4 Report Input Validation Tests

Verify rejection of:

- missing `analysisId`;
- missing `reason`;
- malformed `analysisId`;
- unsupported reason values;
- non-string details;
- details exceeding 500 characters; and
- unexpected request fields.

Verify that valid text fields are trimmed appropriately.

### 9.5 Duplicate Report Tests

Verify that the same user cannot create multiple Reports for the same Analysis.

Confirm that the database-level unique constraint on:

`user + analysis`

prevents duplicate records even when application-level duplicate checking is bypassed or requests occur closely together.

A duplicate attempt must return an appropriate conflict response.

### 9.6 Same-URL Independence Tests

Verify that:

- two different Analyses containing the same URL may each have separate Reports when otherwise allowed; and
- different users may independently report the same URL.

Reporting must not globally deduplicate tickets based only on URL text.

### 9.7 Low-Risk Reporting Test

Verify that an Analysis with automated:

`risk: low`

may still be reported.

No minimum automated score or risk level may be required for Report creation.

### 9.8 Ticket Number Tests

Verify that every successfully created Report receives a ticket number matching:

`PG-YYYY-NNNNNN`

Verify that:

- ticket numbers are generated by the server;
- ticket numbers are unique;
- ticket numbers are immutable;
- clients cannot choose ticket numbers; and
- the database enforces uniqueness.

### 9.9 Concurrent Ticket Allocation Test

Test multiple Report creations occurring concurrently or near-concurrently.

Verify that:

- each successful Report receives a different ticket number;
- sequence allocation does not use an unsafe `count + 1` strategy;
- duplicate ticket numbers are not created; and
- a failed allocation does not leave a partially created Report.

### 9.10 Analysis Snapshot Tests

Verify that the Report snapshot contains the source Analysis values for:

- URL;
- risk;
- score; and
- indicators

at submission time.

Verify that the client cannot forge or modify snapshot values.

### 9.11 Source Analysis Deletion Test

Create a Report and then delete its source Analysis.

Verify that:

- the Report still exists;
- the ticket number remains available;
- the analysis snapshot remains available;
- reconstructed findings remain available;
- messages remain associated with the Report; and
- authorized IT staff can continue reviewing it.

### 9.12 Findings Reconstruction Tests

Verify that Report responses reconstruct structured findings from snapshot indicators using the existing Explainable URL Analysis mapping.

Verify that:

- recognized indicators generate the expected findings;
- unknown legacy indicators do not generate invented findings;
- malformed dynamic indicators do not generate guessed findings; and
- Reporting does not introduce a separate scoring or findings algorithm.

### 9.13 Own Report Retrieval Tests

Verify that:

`GET /api/reports`

returns only the authenticated user's Reports.

Verify deterministic ordering:

`createdAt` descending, then `_id` descending.

Verify that:

`GET /api/reports/:reportId`

returns an owned Report but does not expose another user's Report.

### 9.14 Student DTO Safety Tests

Verify that student-facing Report responses do not expose unnecessary User fields.

When assignment or reviewer information exists, verify that only permitted fields such as:

- name; and
- role

are returned.

Ensure fields such as password hashes and unrelated account data are never returned.

### 9.15 Message Creation Tests

Verify that an authorized Report owner can create a message while the Report is unfinished.

Confirm that:

- `sender` comes from the authenticated user;
- `senderRole` comes from authenticated server-side role information;
- `report` comes from route context;
- timestamps are server-generated; and
- the client cannot impersonate another sender.

### 9.16 Message Validation Tests

Verify rejection of:

- missing message;
- empty message;
- whitespace-only message;
- non-string message;
- message exceeding 1000 characters;
- forged sender;
- forged sender role;
- forged Report reference; and
- unexpected fields.

### 9.17 Message Ownership Tests

Verify that a user:

- can read messages for their own Report;
- can send messages in their own unfinished Report;
- cannot read another user's Report messages; and
- cannot send messages to another user's Report.

Knowledge of another Report ID or ticket number must not bypass ownership.

### 9.18 Message Ordering Test

Verify that Report messages are returned in deterministic chronological order:

`createdAt` ascending, then `_id` ascending.

### 9.19 Message Immutability Test

Verify that Reporting V1 exposes no operation allowing a participant to:

- edit an existing message;
- change its sender;
- change its sender role; or
- delete it.

### 9.20 IT Review RBAC Tests

Verify that:

- `staff` may access permitted IT review endpoints;
- `admin` may access permitted IT review endpoints;
- normal `user` accounts receive `403` for IT review endpoints;
- unauthenticated requests receive the existing authentication error behavior; and
- staff cannot access admin-only assignment operations.

### 9.21 IT Review Queue Tests

Verify that the IT review queue returns Reports across users without exposing unrelated private user information.

Verify the required ordering:

1. unfinished before completed;
2. high priority before normal priority;
3. normal priority before low priority; and
4. older Reports before newer Reports within equivalent workflow/priority groups.

Ordering must remain deterministic.

### 9.22 IT Review DTO Safety Tests

Verify that IT review responses expose only the reporter information required by the specification:

- id;
- name;
- email.

Verify that they do not expose:

- password;
- password hash;
- authentication information;
- unrelated learning records;
- unrelated Analysis History; or
- unnecessary account metadata.

### 9.23 Claim Tests

Verify that staff/admin may claim an unfinished, unassigned Report.

Confirm that:

`assignedTo === req.user.userId`

after a successful claim.

Verify that the client cannot choose another account through the claim endpoint.

### 9.24 Claim Conflict Tests

Verify that:

- an already assigned Report cannot be silently claimed by another reviewer;
- an appropriate conflict response is returned;
- the existing assignment remains unchanged; and
- simultaneous claim attempts cannot silently overwrite each other.

### 9.25 Admin Assignment Tests

Verify that an admin may assign an unfinished Report to:

- active staff; and
- active admin accounts.

Verify rejection of assignment to:

- normal users;
- inactive staff/admin;
- nonexistent users;
- malformed User IDs.

### 9.26 Reassignment Tests

Verify that an admin may reassign an unfinished Report.

Verify that:

- staff cannot assign or reassign a Report to another account;
- normal users cannot assign Reports; and
- reassignment is rejected after completion.

### 9.27 Assignment Candidate Tests

For:

`GET /api/reports/review/assignees`

verify that:

- only admins may access it;
- only active staff/admin accounts are returned;
- normal users are excluded;
- inactive accounts are excluded; and
- safe DTOs are used.

### 9.28 Priority Tests

Verify that staff/admin may change an unfinished Report's priority to:

- `low`;
- `normal`;
- `high`.

Verify rejection of:

- unsupported priority values;
- priority changes by normal users;
- priority changes after completion; and
- unexpected fields.

Verify that changing priority does not modify automated risk or assessment.

### 9.29 Start Review Tests

Verify the valid transition:

`submitted → under_review`

Confirm that:

`assessment` remains `pending`.

Verify that starting review does not:

- alter the analysis snapshot;
- select a final assessment;
- overwrite priority; or
- overwrite assignment.

### 9.30 Invalid Workflow Transition Tests

Verify rejection of invalid workflow operations, including:

- starting an already completed Report;
- completing an unassigned Report;
- completing with `assessment: pending`;
- completing with an unsupported assessment;
- modifying completed priority;
- modifying completed assignment; and
- creating a message after completion.

### 9.31 Human Assessment Tests

Verify that final completion accepts exactly:

- `phishing`;
- `suspicious`;
- `no_threat_identified`.

Verify that automated risk does not restrict or automatically determine the selected human assessment.

For example, verify that the backend permits valid independent states such as:

`risk: low` with `assessment: phishing`

and:

`risk: high` with `assessment: no_threat_identified`.

### 9.32 Staff Completion Assignment Tests

Verify that a staff member may complete a Report assigned to themselves.

Verify that a staff member cannot complete:

- an unassigned Report; or
- a Report assigned to another staff/admin account.

### 9.33 Admin Completion Tests

Verify that admin completion follows the administrative oversight rules defined in Section 5.

Confirm that the final:

`reviewedBy`

contains the authenticated admin when the admin performs completion.

### 9.34 Completion Metadata Tests

After successful completion, verify:

- `status === "completed"`;
- final assessment is stored;
- reviewer note is stored when supplied;
- `reviewedBy` is derived from the authenticated reviewer; and
- `reviewedAt` is generated by the server.

Verify that the client cannot forge `reviewedBy` or `reviewedAt`.

### 9.35 Reviewer Note Validation Tests

Verify that:

- reviewer note is optional;
- valid reviewer note is trimmed;
- non-string reviewer note is rejected;
- reviewer note exceeding 1000 characters is rejected; and
- normal users cannot create or modify the final reviewer note.

### 9.36 Completed Report Immutability Tests

After completion, verify that attempts to change the following are rejected:

- status;
- priority;
- assignment;
- assessment;
- reviewer note;
- reviewedBy;
- reviewedAt;
- reason;
- details;
- analysis snapshot.

Verify that no new messages may be created.

### 9.37 Completed Report Read Tests

Verify that completed Reports remain readable by:

- the reporting user through their own Report endpoint; and
- authorized staff/admin through IT review endpoints.

Verify that existing communication history remains readable.

### 9.38 Analysis Status Independence Tests

Verify that creating or modifying a Report does not automatically change the source Analysis status.

Test operations including:

- Report submission;
- claiming;
- assignment;
- priority changes;
- starting review;
- messaging; and
- completion.

Likewise, changing Analysis status must not modify Report workflow information.

### 9.39 Cache-Control Tests

Verify that authenticated Reporting responses use:

`Cache-Control: no-store`

where required.

This includes:

- own Report lists;
- own Report details;
- own Report messages;
- IT review queue;
- IT Report details;
- IT Report messages; and
- assignment-candidate responses.

### 9.40 Error Response Tests

Verify appropriate handling of:

- malformed IDs;
- invalid input;
- missing authentication;
- invalid/expired authentication;
- forbidden role actions;
- inaccessible resources;
- duplicate Reports;
- claim conflicts;
- invalid assignments;
- invalid workflow transitions; and
- completed-Report modification attempts.

Responses must not expose stack traces, database internals, secrets, or sensitive account information.

### 9.41 Existing Feature Regression Tests

After Reporting V1 is implemented, existing backend tests must continue to pass for:

- authentication;
- authorization;
- URL Analysis CRUD;
- Explainable URL Analysis;
- Awareness Assessment;
- Phishing Identification Assessment;
- Training Exposure;
- Dashboard; and
- Progress.

Reporting must not alter existing URL Analyzer scoring behavior.

### 9.42 Frontend Verification

Frontend verification must cover at minimum:

- Report action from Analysis History;
- Report submission form;
- successful ticket-number display;
- duplicate-report handling;
- Reports list;
- Report detail;
- automated-analysis presentation;
- IT priority presentation;
- human-assessment presentation;
- student message thread;
- message sending;
- completed read-only state;
- staff/admin IT Review navigation;
- IT queue;
- ticket claiming;
- admin assignment/reassignment;
- priority changes;
- Start Review action;
- IT messaging;
- final assessment;
- reviewer note;
- completion behavior;
- loading states;
- empty states;
- error states; and
- role-appropriate controls.

### 9.43 Frontend Security Verification

Manually verify that hiding a frontend control is not the only protection.

Where practical, attempt the corresponding unauthorized API operation directly and confirm that the backend rejects it.

Examples include:

- normal user accessing IT review;
- normal user changing priority;
- staff assigning a ticket to another user;
- user reading another user's messages;
- user forging message sender information; and
- staff completing another reviewer's assigned ticket.

### 9.44 Build and Quality Verification

Before Reporting V1 is considered complete:

- backend automated tests must pass;
- frontend lint must pass;
- frontend production build must pass;
- existing PhishGuard verification checks must pass;
- `git diff --check` should report no whitespace errors; and
- no secrets or environment files may be introduced into Git.

### 9.45 Production Verification

After deployment, perform a controlled end-to-end verification using test accounts.

At minimum verify:

1. a user analyzes a URL;
2. the user submits it to school IT;
3. a ticket number is generated;
4. the user sees the Report;
5. staff/admin sees it in IT Review;
6. IT claims or assigns it;
7. priority can be managed;
8. IT starts review;
9. user and IT can exchange a test message;
10. an authorized reviewer completes the Report;
11. the user sees the final human assessment;
12. communication becomes read-only; and
13. the original automated result remains unchanged.

Production verification must not use real passwords, authentication tokens, or sensitive information as Report message content.

---

## 10. Scope Boundaries and Non-Goals

Reporting V1 is a specialized phishing incident reporting and school IT review workflow.

It is intentionally more capable than a simple "send URL to IT" feature, but it is not intended to become a general-purpose help-desk, ticketing, or security operations platform.

### 10.1 Included in Reporting V1

Reporting V1 includes:

- creation of a Report from an owned URL Analysis;
- server-generated human-readable ticket numbers;
- immutable automated-analysis evidence snapshots;
- user-selected incident reason and initial context;
- student access to their own Reports;
- school IT review queue;
- IT-controlled ticket priority;
- staff claiming;
- admin assignment and reassignment;
- report-specific student/IT communication;
- explicit investigation workflow;
- human phishing assessment;
- final reviewer note;
- completed incident history;
- role-based access control;
- ownership enforcement;
- safe DTOs;
- audit-conscious server behavior; and
- continued Report availability after source Analysis deletion.

These capabilities define the Reporting V1 feature contract.

### 10.2 Specialized Phishing Scope

Reports in V1 are specifically associated with suspicious URLs analyzed through PhishGuard.

Reporting V1 is not a general school support-ticket system.

V1 does not support unrelated ticket categories such as:

- broken school devices;
- Wi-Fi problems;
- account provisioning;
- classroom technology support;
- printer issues; or
- general IT requests.

A Report must originate from an existing PhishGuard URL Analysis owned by the reporting user.

### 10.3 No File Attachments

Reporting V1 does not support:

- screenshots;
- uploaded email files;
- documents;
- images;
- compressed archives; or
- other file attachments.

Secure file handling would require additional controls for:

- file-type validation;
- file-size limits;
- malware handling;
- storage security;
- access control;
- retention;
- deletion; and
- potentially dangerous content.

Attachments may be considered as a separate future feature.

### 10.4 No Email or External Notifications

Reporting V1 does not require automatic notifications through:

- email;
- SMS;
- push notifications; or
- third-party messaging platforms.

Users view ticket updates through PhishGuard.

Notification support may be considered later after the application's email infrastructure is introduced for secure password reset.

### 10.5 No Service-Level Agreements

Reporting V1 does not implement formal:

- response-time guarantees;
- resolution-time guarantees;
- SLA timers;
- SLA violations;
- escalation deadlines; or
- overdue-ticket calculations.

Priority exists only to help school IT organize incident handling.

Priority must not imply a guaranteed response time.

### 10.6 No Automatic Escalation

Reporting V1 does not automatically:

- escalate high-priority Reports;
- reassign unattended Reports;
- notify administrators about delays;
- change priority based on elapsed time; or
- change workflow state based on elapsed time.

All V1 assignment, priority, and investigation decisions are explicit human actions.

### 10.7 No Automatic Assignment

Reporting V1 does not include:

- round-robin assignment;
- workload balancing;
- automatic reviewer selection;
- assignment based on priority;
- assignment based on automated risk; or
- assignment based on reporter identity.

Reports begin unassigned.

Assignment occurs only through the authorized operations defined in this specification.

### 10.8 No Private Staff Discussion Thread

Reporting V1 provides one Report communication thread shared between:

- the reporting user; and
- authorized school IT staff/admin.

V1 does not provide:

- private staff-only messages;
- internal comments hidden from the reporter; or
- multiple conversation channels.

The final `reviewerNote` remains reporter-visible.

If private staff notes are introduced later, they must have explicitly defined authorization and visibility rules.

### 10.9 No Message Editing or Deletion

Reporting V1 does not support:

- editing messages;
- deleting messages;
- message reactions;
- read receipts; or
- message delivery indicators.

Messages are immutable incident-history entries after creation.

### 10.10 No Reopening in V1

A completed Report is final.

Reporting V1 does not support:

- reopening a completed Report;
- returning a completed Report to `under_review`;
- replacing the final assessment;
- additional review rounds; or
- post-completion communication.

If another suspicious incident occurs, it must be handled through an appropriate new Analysis and Report rather than modifying the completed incident record.

### 10.11 No Report Deletion

Reporting V1 does not provide hard deletion of submitted Reports through the application.

This applies to:

- reporting users;
- staff; and
- admins.

Once submitted, the Report remains an incident record.

Any future retention or deletion policy must be designed separately rather than adding unrestricted deletion to V1.

### 10.12 No Definitive Automated Phishing Verification

Reporting V1 does not change the capabilities of the URL Analyzer.

PhishGuard's automated URL Analysis remains heuristic.

Reporting V1 does not add:

- live website crawling;
- remote page execution;
- malware scanning;
- domain reputation services;
- external threat-intelligence feeds;
- browser sandboxing;
- certificate reputation analysis;
- email-header analysis;
- automatic blacklist checking; or
- definitive automated phishing verification.

The existing URL Analyzer remains responsible only for its documented heuristic characteristics.

### 10.13 No Automatic Human Assessment

The system must not automatically select:

- `phishing`;
- `suspicious`; or
- `no_threat_identified`

based on automated Analysis data.

A human assessment requires an explicit authorized IT review action.

Automated risk and human assessment remain separate.

### 10.14 No Automatic Blocking or Remediation

Reporting V1 does not automatically:

- block URLs;
- modify school firewalls;
- modify DNS;
- disable accounts;
- reset passwords;
- quarantine email;
- remove messages;
- contact external providers; or
- perform endpoint remediation.

PhishGuard records and supports investigation; it does not automatically perform infrastructure security actions.

### 10.15 No Advanced Queue Management

Reporting V1 does not require:

- custom queue filters;
- full-text ticket search;
- saved searches;
- custom sorting;
- pagination controls;
- bulk assignment;
- bulk priority changes;
- bulk completion;
- queue dashboards; or
- workload analytics.

The V1 server-defined queue ordering is sufficient.

These capabilities may be considered if real usage later demonstrates a need.

### 10.16 No Reporting Analytics Dashboard

Reporting V1 does not introduce new research metrics or analytics such as:

- number of phishing incidents by student;
- staff performance statistics;
- average resolution time;
- incident trends;
- priority distributions;
- assessment distributions;
- school-wide phishing rates; or
- predictive incident models.

The existing research variables remain separate:

1. Awareness Score
2. Phishing Identification Score
3. Training Exposure

Any future use of incident-reporting data for research or analytics requires separate specification and justification.

### 10.17 No Gamification or Ranking

Reporting V1 does not introduce:

- points;
- badges;
- streaks;
- leaderboards;
- student rankings;
- staff rankings; or
- rewards for submitting Reports.

Incident reporting should be presented as a security and educational workflow rather than a competition.

### 10.18 No Generic Administrative User Management

Reporting V1 does not create a general admin user-management system.

The assignment workflow may retrieve safe information about active staff/admin accounts when necessary.

It does not provide interfaces for:

- creating users;
- deleting users;
- changing account roles;
- disabling accounts;
- resetting other users' passwords; or
- editing unrelated account information.

### 10.19 No Changes to Existing Assessment Features

Reporting V1 must not alter the behavior or scoring of:

- Awareness Assessment;
- Phishing Identification Assessment; or
- Training Exposure.

Reporting is a separate product capability.

### 10.20 No Changes to Existing URL Scoring

Reporting V1 must not modify:

- URL Analyzer heuristic rules;
- score contributions;
- risk thresholds;
- existing indicator strings; or
- Explainable URL Analysis findings definitions.

Reporting consumes the existing Analysis result as evidence.

It does not redefine it.

### 10.21 Existing Analysis Status Remains Separate

Reporting V1 does not redesign the existing Analysis History status system:

- `active`
- `reviewed`
- `archived`

Those values remain separate from the Report workflow:

- `submitted`
- `under_review`
- `completed`

The usefulness and naming of Analysis History statuses may be reconsidered during the final feature review after the major PhishGuard features are complete.

### 10.22 No Final UI Redesign in This Feature

Reporting V1 requires functional, understandable interfaces.

It does not require the final PhishGuard visual redesign.

The dedicated UI/UX phase will later establish the final:

- navigation;
- sidebar;
- page hierarchy;
- typography;
- spacing;
- cards;
- responsive behavior;
- visual states; and
- overall school cybersecurity identity.

The Reporting V1 implementation should therefore avoid unnecessary one-off visual systems that would make the later redesign harder.

### 10.23 Future-Compatible Architecture

Although the following capabilities are outside Reporting V1, the implementation should avoid unnecessary architectural decisions that would make reasonable future additions difficult:

- email notifications;
- attachments;
- private IT notes;
- queue filtering and search;
- incident analytics;
- reopening with explicit audit history;
- escalation rules; or
- additional phishing evidence types.

This requirement does not authorize implementing those features in V1.

Future capabilities require their own specifications before implementation.

### 10.24 Reporting V1 Completion Boundary

Reporting V1 is considered functionally complete when PhishGuard supports the following end-to-end lifecycle:

`Analyze → Report → Receive Ticket → IT Prioritizes/Assigns → Investigate → Communicate → Human Assessment → Complete → User Reviews Result`

At that point, additional help-desk functionality is not required for Reporting V1.

The feature should move to verification and deployment rather than expanding scope without a separate approved specification.

---