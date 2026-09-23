# Training Exposure V1 Specification

## 1. Purpose

Training Exposure is the third quantitative variable in PhishGuard.

The three planned research variables are:

1. Awareness Score
2. Phishing Identification Score
3. Training Exposure

Awareness Score and Phishing Identification Score are already implemented separately.

Training Exposure must measure a user's completion of fixed educational cybersecurity training modules provided by PhishGuard.

It must not be inferred from login frequency, page visits, time spent on a page, URL Analyzer usage, Awareness Assessment attempts, or Phishing Identification Assessment attempts.

V1 uses explicit training-module completion as the measure of exposure.

Training Exposure represents participation/completion within PhishGuard. It must not be described as proof of cybersecurity competence, learning effectiveness, or causation.

## 2. V1 Scope

An authenticated user can:

- open the Training section;
- view a fixed set of cybersecurity training modules;
- read the educational content of each module;
- mark an incomplete module as completed;
- view which modules they have completed;
- view their completed-module count;
- view their Training Exposure percentage.

The backend is authoritative for:

- the fixed training-module catalog;
- module IDs;
- completion state;
- ownership;
- total module count;
- completed module count;
- Training Exposure percentage.

The frontend must not calculate the authoritative Training Exposure value.

## 3. Fixed Training Modules

V1 contains exactly 3 fixed modules.

The fixed V1 module IDs are exactly:

1 = Recognizing Phishing Indicators
2 = Password and MFA Security
3 = Safe Handling and Reporting

Only integer module IDs 1, 2, and 3 are valid. The authoritative educational content for these modules is defined in Appendix A.

### Module 1 — Recognizing Phishing Indicators

Learning objective:
Help users recognize common warning signs associated with phishing messages.

Educational content should cover:

- unexpected or unfamiliar sender domains;
- mismatched or suspicious links;
- urgency and pressure tactics;
- unexpected requests for credentials or sensitive information;
- unexpected attachments;
- impersonation of trusted organizations or authority figures;
- checking multiple warning signs together rather than relying on one characteristic.

The content must remain defensive and educational.

### Module 2 — Password and MFA Security

Learning objective:
Help users understand basic account-protection practices.

Educational content should cover:

- using strong and unique passwords;
- avoiding password reuse;
- never sharing passwords;
- multi-factor authentication;
- never sharing verification or MFA codes;
- recognizing unexpected requests for credentials or verification codes.

Do not collect or ask users to enter real passwords, MFA codes, recovery codes, or other credentials.

### Module 3 — Safe Handling and Reporting

Learning objective:
Help users respond safely when they encounter suspicious cybersecurity activity.

Educational content should cover:

- avoiding interaction with suspicious links and attachments;
- independently verifying suspicious requests;
- using official channels to reach an organization;
- reporting suspicious messages or activity through appropriate institutional channels;
- keeping software and devices updated;
- exercising caution on untrusted or public networks.

Do not include offensive-security instructions or instructions for attacking, exploiting, or evading systems.

## 4. Training Exposure Measurement

There are exactly 3 modules in V1.

Each module contributes equally to Training Exposure.

The backend calculates:

completedModules = number of distinct fixed modules completed by the authenticated user

totalModules = 3

trainingExposure =
Math.round((completedModules / 3) * 10000) / 100

`trainingExposure` is returned as a JSON number. The only valid V1 values are:

- 0 completed -> 0
- 1 completed -> 33.33
- 2 completed -> 66.67
- 3 completed -> 100

The frontend displays the backend-returned value and does not independently calculate the authoritative value. No interpretation categories, rankings, or comparisons are included.

Do not create labels such as:

- low exposure;
- medium exposure;
- high exposure;
- good;
- bad;
- proficient;
- at risk.

Do not rank users or compare a user's Training Exposure with other users.

## 5. Completion Semantics

A module is completed only when the authenticated user explicitly performs the completion action for that module.

Opening or viewing a module does not automatically complete it.

Completion is idempotent.

If a user attempts to complete an already completed module:

- do not create a duplicate completion;
- do not increase completedModules;
- return the user's existing completion/progress state safely.

V1 does not allow users to undo a completed module.

V1 does not allow users to manually edit their Training Exposure percentage.

### Concurrent completion

The TrainingCompletion model must enforce a unique compound index on:

```text
{ user: 1, moduleId: 1 }
```

The service/controller implementation must safely handle duplicate-key races caused by concurrent completion requests. If another request has already created the same user/module completion, the implementation must retrieve and use the existing completion, return the normal idempotent completed state, avoid exposing a MongoDB duplicate-key/internal error, avoid creating a duplicate record, and avoid increasing progress twice.

## 6. Database Design

Use a separate collection for training completions.

The exact MongoDB collection name is:

trainingCompletions

Each completion document contains:

- user: ObjectId reference to User, required
- moduleId: Number, required
- completedAt: Date, backend-generated, required
- timestamps

Enforce one completion per user per module using an appropriate unique compound index on:

user + moduleId

Do not store:

- passwords;
- JWTs;
- MFA codes;
- answer keys;
- unnecessary sensitive information;
- client-provided Training Exposure percentages.

Training Exposure should be derived from the authenticated user's valid completion records and the fixed backend module count.

## 7. Ownership and Authentication

All Training endpoints require authentication.

The authenticated user identity must come from the verified JWT.

The client must never choose or submit a user ID for training ownership.

A normal user can read only their own completion/progress information.

Do not expose another user's training completion records through V1 user endpoints.

## 8. V1 REST API

All endpoints require authentication.

### GET /api/training/modules

Successful response shape:

```text
{
  modules: [
    {
      moduleId: Number,
      title: String,
      learningObjective: String,
      content: [
        {
          heading: String,
          points: [String]
        }
      ],
      completed: Boolean,
      completedAt: Date | null
    }
  ]
}
```

Exactly three modules are returned. `completed` is based only on the authenticated user's completion records. `completedAt` is the server-stored completion time for that user/module or `null` if incomplete. Do not expose other users or internal calculation/configuration fields. Appendix A defines the authoritative module content.

### GET /api/training/progress

Successful response:

```text
{
  progress: {
    completedModules: Number,
    totalModules: 3,
    trainingExposure: Number
  }
}
```

Do not include interpretation categories, rankings, comparisons, or internal scoring/configuration fields.

### POST /api/training/modules/:moduleId/complete

Purpose:
Mark one valid fixed training module as completed for the authenticated user.

The backend must:

- authenticate the user;
- validate moduleId;
- reject unknown/malformed module IDs;
- derive ownership from the JWT;
- prevent duplicate completion records;
- generate completedAt server-side;
- return the updated progress/completion state.

The request must not accept:

- user;
- userId;
- completedAt;
- completedModules;
- totalModules;
- trainingExposure;
- role;
- or other server-owned fields.

No request body is required. Both no body and an empty JSON object `{}` are valid. Any non-empty request body or unexpected field must be rejected with HTTP 400.

For a module completed for the first time, return HTTP 201:

```text
{
  completion: {
    moduleId: Number,
    completedAt: Date
  },
  progress: {
    completedModules: Number,
    totalModules: 3,
    trainingExposure: Number
  }
}
```

For an already-completed module, return HTTP 200 with the same response shape, the existing completion timestamp, and current progress. Do not create or update a duplicate completion record.

## 9. Backend Architecture

Follow the existing PhishGuard structure:

React frontend
→ REST API
→ Express route
→ authentication middleware
→ validation
→ controller
→ training service
→ Mongoose model
→ MongoDB

Keep the fixed training catalog in backend/service code.

The frontend must consume the catalog through the API rather than maintaining an authoritative duplicate.

## 10. Validation and Security

Training endpoints must preserve existing PhishGuard security practices.

Requirements include:

- JWT authentication on every Training endpoint;
- strict module ID validation;
- ownership derived from authenticated JWT;
- safe error responses;
- no credential or JWT logging;
- no sensitive information in responses;
- duplicate-completion protection;
- server-generated completion timestamps;
- server-calculated Training Exposure;
- no trust in client-provided progress values.

For the completion endpoint, reject unexpected request-body fields rather than silently accepting server-owned values.

## 11. Frontend Requirements

Add a protected Training page for authenticated users.

The exact protected V1 frontend route is:

/training

The Dashboard should provide a Training navigation entry.

The Training page should:

- match the existing PhishGuard interface;
- show the three modules returned by the API;
- clearly distinguish completed and incomplete modules;
- display educational content in a readable structure;
- provide an explicit completion action for incomplete modules;
- show completed-module count;
- show backend-calculated Training Exposure percentage;
- update progress after successful completion;
- prevent duplicate pending completion requests;
- handle loading, authentication, empty, success, and error states accessibly.

Do not require all three modules to be displayed as separate dashboard-style cards if a simpler structured reading layout fits the existing interface better.

Do not add gamification, rankings, badges, streaks, leaderboards, celebratory animations, or user comparisons.

The frontend must not:

- calculate authoritative Training Exposure;
- hardcode an alternative authoritative training catalog;
- choose the owner;
- send user IDs;
- send completion timestamps;
- send progress percentages;
- mark a module complete merely because it was opened.

## 12. Accessibility

Use semantic HTML where practical.

Requirements include:

- proper heading hierarchy;
- keyboard-accessible controls;
- visible focus behavior;
- status/error messages announced appropriately;
- completion controls with clear text;
- disabled state while a completion request is pending.

Do not rely only on color to indicate completion.

## 13. V1 Out of Scope

Do not implement the following as part of Training Exposure V1:

- quizzes inside training modules;
- Awareness Assessment changes;
- Phishing Identification Assessment changes;
- URL Analyzer changes;
- time-on-page tracking;
- automatic completion based on page views;
- training duration scoring;
- self-reported external training;
- file/video training uploads;
- administrator training management;
- custom user-created modules;
- module editing;
- deleting or undoing completions;
- badges;
- streaks;
- leaderboards;
- rankings;
- comparisons between users;
- correlation analysis;
- statistical modeling;
- causal claims;
- personalized AI-generated training;
- external paid APIs or services.

These may be considered separately in later project phases if approved.

## 14. Relationship to Future Quantitative Analysis

Training Exposure is stored/measured separately from:

- Awareness Score;
- Phishing Identification Score.

Future quantitative analysis may examine associations among these variables.

V1 Training must not perform correlation analysis itself.

Do not state that completing training causes higher Awareness Scores or Phishing Identification Scores.

Any later statistical analysis must distinguish association from causation.

## 15. Testing Requirements

Backend automated tests should cover at minimum:

- authentication required for all Training endpoints;
- invalid JWT rejection;
- module IDs exactly 1, 2, and 3;
- exactly three sanitized public modules;
- exact `GET /api/training/modules` response envelope;
- exact `GET /api/training/progress` response envelope;
- valid module completion;
- first completion returns HTTP 201;
- repeated completion returns HTTP 200;
- repeated completion preserves the original `completedAt`;
- no-body completion is accepted;
- `{}` completion body is accepted;
- any non-empty completion body is rejected with HTTP 400;
- backend-generated completion timestamp;
- completion ownership from authenticated user;
- malformed module ID rejection;
- unknown module ID rejection;
- server-owned field rejection;
- duplicate completion idempotency;
- unique user + module completion behavior;
- concurrent/duplicate completion cannot create multiple records or incorrectly increase progress;
- user ownership isolation;
- progress at 0 completed modules;
- progress at 1 completed module;
- progress at 2 completed modules;
- progress at 3 completed modules;
- exact numeric Training Exposure values 0, 33.33, 66.67, and 100;
- no interpretation categories;
- exact MongoDB collection name `trainingCompletions`.

Existing authentication, RBAC, Awareness Assessment, Phishing Identification Assessment, URL Analyzer, and CRUD tests must continue to pass.

## 16. Definition of Done

Training Exposure V1 is complete when:

- the specification has been approved;
- the fixed three-module catalog exists on the backend;
- authenticated users can retrieve the modules;
- authenticated users can explicitly complete modules;
- duplicate completion is safely idempotent;
- progress is derived server-side;
- Training Exposure is calculated server-side;
- users can access only their own completion/progress state;
- frontend Training page works without authoritative client-side scoring;
- automated backend tests pass;
- frontend lint passes;
- frontend production build passes;
- the full PhishGuard verification harness passes;
- manual local verification passes;
- production deployment and smoke testing pass.

Do not implement anything after creating this specification.

## Appendix A — Authoritative V1 Training Content

The backend owns the fixed catalog and must return exactly these three modules. The content below is the authoritative V1 educational content; implementation must not add alternative modules, quizzes, external links, or new claims.

### Module 1 — Recognizing Phishing Indicators

**Module ID:** 1

**Learning objective:** Help users recognize common warning signs associated with phishing messages.

**Content:**

- **Inspect the sender identity**
  - Compare the display name with the full sender domain.
  - Treat an unfamiliar or mismatched domain as a reason to verify the message through an official channel.
- **Check links and destinations**
  - Inspect where a link actually leads before interacting with it.
  - Be cautious when visible link text and the destination do not match.
- **Notice pressure and urgency**
  - Treat threats, countdowns, and demands for immediate action as warning signs.
  - Slow down and verify unexpected requests independently.
- **Protect sensitive information**
  - Be cautious when a message requests passwords, verification codes, or other sensitive information.
- **Handle attachments safely**
  - Avoid opening unexpected attachments until the sender and file can be verified.
- **Recognize impersonation**
  - Messages that imitate trusted organizations or authority figures still require independent verification.
- **Consider multiple signals**
  - A message may look ordinary while combining several warning signs; consider the overall pattern rather than one detail alone.

### Module 2 — Password and MFA Security

**Module ID:** 2

**Learning objective:** Help users understand basic account-protection practices.

**Content:**

- **Use strong, unique passwords**
  - Use a strong password for each important account and avoid reusing passwords across services.
- **Protect passwords**
  - Never share passwords with support personnel, colleagues, or anyone else.
- **Use multi-factor authentication**
  - Enable MFA when it is available and review account security settings through official services.
- **Protect verification codes**
  - Never share password, verification, recovery, or MFA codes.
- **Question unexpected requests**
  - Treat unexpected requests for credentials or verification codes as a reason to stop and verify through an official channel.
- **Keep access private**
  - Do not include real passwords, codes, or recovery information in training exercises or support messages.

### Module 3 — Safe Handling and Reporting

**Module ID:** 3

**Learning objective:** Help users respond safely when they encounter suspicious cybersecurity activity.

**Content:**

- **Pause before interacting**
  - Avoid clicking suspicious links or opening suspicious attachments until they can be verified.
- **Verify independently**
  - Use a known official website, application, or contact route rather than contact details supplied by a suspicious message.
- **Use official channels**
  - Reach an organization through its established website, application, or institutional contact process.
- **Report suspicious activity**
  - Report suspicious messages or activity through the appropriate school or organizational reporting channel.
- **Keep systems updated**
  - Install legitimate software and security updates to reduce known security problems.
- **Use untrusted networks cautiously**
  - Be careful with sensitive activity on public or otherwise untrusted networks, and verify the network before relying on it.

Completion of a module records participation in this fixed training catalog. It does not prove competence, guarantee safe behavior, or establish learning effectiveness.

## Appendix B — Authoritative V1 Contract

The following contract is exact for V1 implementation and testing.

### Catalog and persistence

- Module IDs are exactly `1`, `2`, and `3`.
- Module 1 is `Recognizing Phishing Indicators`.
- Module 2 is `Password and MFA Security`.
- Module 3 is `Safe Handling and Reporting`.
- The exact MongoDB collection is `trainingCompletions`.
- Each completion has a unique compound index on `{ user: 1, moduleId: 1 }`.
- Ownership always comes from the verified JWT.

### Public module response

`GET /api/training/modules` returns:

```text
{
  modules: [
    {
      moduleId: Number,
      title: String,
      learningObjective: String,
      content: [
        {
          heading: String,
          points: [String]
        }
      ],
      completed: Boolean,
      completedAt: Date | null
    }
  ]
}
```

Exactly three modules are returned. `completed` and `completedAt` describe only the authenticated user's completion state.

### Progress response

`GET /api/training/progress` returns:

```text
{
  progress: {
    completedModules: Number,
    totalModules: 3,
    trainingExposure: Number
  }
}
```

The only valid exposure values are `0`, `33.33`, `66.67`, and `100`.

### Completion request and response

`POST /api/training/modules/:moduleId/complete` accepts no request body or an empty JSON object `{}`. Any non-empty body is rejected with HTTP 400.

A first completion returns HTTP 201:

```text
{
  completion: {
    moduleId: Number,
    completedAt: Date
  },
  progress: {
    completedModules: Number,
    totalModules: 3,
    trainingExposure: Number
  }
}
```

A repeated completion returns HTTP 200 with the same shape, the original `completedAt`, and current progress. It must not create or update a duplicate completion record.

### Exposure calculation

```text
trainingExposure =
Math.round((completedModules / 3) * 10000) / 100
```

The backend returns this as a JSON number. The frontend only displays it.

### Concurrency and frontend route

- Concurrent duplicate requests must safely resolve to one completion record and the normal idempotent response.
- The exact protected frontend route is `/training`.
- The Dashboard links to `/training`.

