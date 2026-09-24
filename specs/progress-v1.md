# Progress V1 Specification

## Purpose

Progress V1 provides an authenticated user with a detailed, read-only view of their own PhishGuard learning progress.

It combines existing authoritative Awareness Assessment, Phishing Identification Assessment, and Training data without creating a new source of truth.

The Dashboard remains the quick overview. Progress provides the more detailed historical view.

## Route

Frontend route:

`/progress`

Backend endpoint:

`GET /api/progress`

Authentication:

Bearer JWT required.

The backend must use `req.user.userId` exclusively to identify the current user.

The endpoint must not accept or trust a client-supplied user ID.

All supported roles (`user`, `staff`, and `admin`) see only their own normal Progress data.

Progress V1 does not provide cross-user admin or staff functionality.

## Data Sources

Progress V1 reuses existing authoritative data from:

- Awareness Assessment attempts
- Phishing Identification Assessment attempts
- Training completions

Progress V1 must not create:

- a Progress model
- a Progress collection
- persisted aggregate progress records
- duplicated assessment scores
- duplicated Training Exposure values

## Assessment History

Return at most the 10 most recent Awareness Assessment attempts belonging to the authenticated user.

Return at most the 10 most recent Phishing Identification Assessment attempts belonging to the authenticated user.

Both histories must be ordered deterministically:

`{ completedAt: -1, _id: -1 }`

The server owns the history limit.

The client must not control the limit through query parameters.

A real score of `0` is a valid assessment result and must not be treated as missing data.

## Awareness Attempt DTO

Each Awareness history item contains only:

- `id`
- `rawScore`
- `score`
- `totalQuestions`
- `completedAt`

Do not expose:

- answers
- answer keys
- correctness data
- user ID
- MongoDB internal fields
- `__v`

## Phishing Identification Attempt DTO

Each Phishing Identification history item contains only:

- `id`
- `rawScore`
- `score`
- `totalScenarios`
- `completedAt`

Do not expose:

- answers
- answer keys
- correctness data
- user ID
- MongoDB internal fields
- `__v`

## Training Progress

Reuse the existing authoritative Training service.

Return:

- `completedModules`
- `totalModules`
- `trainingExposure`

Also return the authenticated user's fixed training modules with their completion state.

Training module completion must remain backend-authoritative.

The frontend must not calculate Training Exposure.

Opening Progress must not mark any training module complete.

## Success Response

The successful response has the following top-level structure:

```json
{
  "success": true,
  "awareness": {
    "latest": null,
    "history": []
  },
  "phishingIdentification": {
    "latest": null,
    "history": []
  },
  "training": {
    "completedModules": 0,
    "totalModules": 3,
    "trainingExposure": 0,
    "modules": []
  }
}

```

When assessment attempts exist, `latest` contains the newest safe assessment DTO.

When no assessment attempt exists, `latest` is `null` and `history` is an empty array.

`latest` must correspond to the first item of that assessment's history when history is non-empty.

Training modules must use the existing Training service's safe user-facing module representation.

## Caching

The Progress response contains user-specific data.

Set:

`Cache-Control: no-store`

## Error Behavior

- `200` for a successful response, including a user with no assessment attempts or training completions.
- `401` when authentication is missing.
- `403` for an invalid or expired JWT.
- `500` through the existing safe global error handling behavior for unexpected server errors.

## Frontend

Add a protected `/progress` page.

Add Progress to the authenticated navigation.

The Progress page should include:

- page heading and short description
- current/latest Awareness result
- current/latest Phishing Identification result
- Training Exposure summary
- training module completion status
- Awareness attempt history
- Phishing Identification attempt history
- links to the existing Awareness, Phishing Identification, and Training pages

Assessment histories should show:

- score
- raw score where useful
- completion date
- newest attempt first

A score of `0` must render as a real result.

Provide appropriate:

- loading state
- empty state
- populated state
- API error state
- expired/invalid session handling consistent with the existing application

## Interpretation Boundaries

Progress V1 is descriptive.

Do not add:

- rankings
- leaderboards
- badges
- streaks
- levels
- gamification
- comparison with other users
- cybersecurity ability labels
- risk labels based on assessment results
- claims that a score proves phishing resistance
- causal claims about Training Exposure improving assessment performance
- research conclusions or statistical interpretation

## Security and Ownership

Every database query must be scoped to the authenticated user's ID.

Never trust ownership information from request body, query parameters, or path parameters.

Do not expose another user's progress.

Do not expose assessment answers or backend answer keys.

Do not expose password information, JWTs, or unnecessary user fields.

## Compatibility

Do not change existing external API contracts for:

- Awareness Assessment
- Phishing Identification Assessment
- Training
- Dashboard
- URL Analysis
- Authentication

Progress V1 should reuse existing service logic where practical rather than duplicating authoritative calculations.

## Out of Scope

Progress V1 does not include:

- admin/staff analytics
- cross-user reporting
- research statistics
- correlations
- predictive analytics
- downloadable reports
- CSV/PDF export
- charts requiring new statistical calculations
- notifications
- recommendations generated from scores