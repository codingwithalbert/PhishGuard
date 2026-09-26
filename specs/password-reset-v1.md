# PhishGuard Password Reset V1 Specification

## 1. Purpose

Password Reset V1 provides PhishGuard users with a secure way to recover access to their account when they forget their password.

The feature provides:

- a Forgot Password page;
- real password-reset email delivery;
- a secure password-reset link;
- a Reset Password page;
- expiring and single-use reset tokens;
- safe responses that do not reveal whether an account exists;
- rate limiting against reset-request abuse.

Password Reset V1 extends the existing authentication system without changing the existing role-based access-control model.

---

## 2. User Flow

The intended flow is:

1. User opens the PhishGuard Login page.
2. User selects **Forgot password?**
3. User enters their registered email address.
4. Frontend sends the email address to the PhishGuard API.
5. API validates the request.
6. API returns a generic response regardless of whether the account exists.
7. If an eligible account exists, the backend generates a secure reset token.
8. Only a cryptographic hash of the reset token is stored by PhishGuard.
9. The raw token is placed in a password-reset URL.
10. PhishGuard sends the reset email through the configured transactional email provider.
11. User receives the email in their email inbox, including Gmail when Gmail is used for the account.
12. User selects the reset-password link.
13. The link opens the PhishGuard Reset Password page.
14. User enters and confirms a new password.
15. Frontend submits the new password together with the reset token.
16. Backend verifies the token and its expiration.
17. Backend hashes the new password using the existing password-hashing policy.
18. Backend invalidates the reset token.
19. User is informed that the password was reset successfully.
20. User can log in using the new password.

---

## 3. Scope

### 3.1 Included in V1

Password Reset V1 includes:

- Forgot Password frontend page.
- Reset Password frontend page.
- Link from Login to Forgot Password.
- Password-reset request API.
- Password-reset completion API.
- Secure reset-token generation.
- Reset-token hashing.
- Reset-token expiration.
- Single-use reset tokens.
- Real transactional email delivery.
- Branded PhishGuard reset email.
- Rate limiting.
- Generic forgot-password responses.
- Safe error handling.
- Relevant backend tests.
- Relevant frontend validation and states.

### 3.2 Not Included in V1

Password Reset V1 does not include:

- security questions;
- SMS password recovery;
- OTP-based password recovery;
- administrator-initiated password resets;
- passwordless login;
- magic-link login;
- account recovery through staff;
- changing a password while already logged in;
- general profile/account management;
- multiple simultaneously valid reset tokens;
- displaying raw reset tokens in the UI;
- emailing existing passwords;
- automatic login after password reset.

---

## 4. Email Delivery

### 4.1 Transactional Mail

PhishGuard will use a configured transactional email provider for real password-reset email delivery.

The initial V1 provider is Brevo.

Email delivery must occur from the backend. The frontend must never receive or use the provider API key.

### 4.2 Configuration

Provider credentials and mail configuration must be supplied through environment variables.

Secrets must never be:

- committed to Git;
- placed in frontend code;
- placed in Vite environment variables;
- included in API responses;
- printed in logs;
- included in tests or documentation.

`.env.example` may contain variable names with blank or example-safe values only.

### 4.3 Email Content

The reset email should clearly identify PhishGuard.

Suggested subject:

`Reset your PhishGuard password`

The email should explain that:

- a password reset was requested for the account;
- the recipient may use the provided reset link to choose a new password;
- the link expires;
- the email may be ignored if the recipient did not request the reset.

The email must not contain:

- the user's existing password;
- password hashes;
- authentication tokens other than the purpose-specific reset token contained in the reset URL;
- internal database IDs;
- provider credentials;
- unnecessary personal information.

### 4.4 Reset URL

The email reset URL must point to the configured PhishGuard frontend.

Conceptual format:

`<CLIENT_URL>/reset-password/<raw-reset-token>`

The backend must use configured application URLs rather than hard-coding localhost or the production domain into business logic.

---

## 5. Reset Token Security

### 5.1 Token Generation

Reset tokens must be generated server-side using Node.js cryptographically secure randomness.

The token must not be generated using:

- `Math.random()`;
- timestamps;
- predictable counters;
- MongoDB ObjectIds;
- user IDs;
- JWT contents;
- passwords.

### 5.2 Token Storage

The raw reset token must never be stored in MongoDB.

The backend must:

1. generate the raw token;
2. create a cryptographic hash of the token;
3. store only the token hash;
4. send the raw token only through the reset URL delivered by email.

A secure one-way hash such as SHA-256 is appropriate because the reset token itself is high-entropy random data.

### 5.3 Expiration

Reset tokens must have a short expiration period.

Password Reset V1 uses:

**15 minutes**

The server is authoritative for expiration.

The frontend must not decide whether a token is valid based only on client-side time.

### 5.4 Single Use

A reset token becomes unusable after a successful password reset.

The backend must invalidate the stored reset-token state after successfully changing the password.

Reusing the same link must fail safely.

### 5.5 New Reset Requests

If a user requests another password reset before the previous reset token expires, the new request replaces the previous outstanding reset-token state.

Therefore:

- only the newest reset token is valid;
- previous reset links become invalid.

---

## 6. Data Model

Password-reset state may be stored on the existing User model.

Server-controlled fields:

- `passwordResetTokenHash`
- `passwordResetExpiresAt`

Recommended behavior:

- default/null when no active reset exists;
- token hash contains only the hash, never the raw token;
- expiration contains the server-generated expiration timestamp.

These fields must never be exposed in normal User DTOs or API responses.

They must never be returned to the frontend.

---

## 7. Forgot Password Endpoint

### 7.1 Endpoint

`POST /api/auth/forgot-password`

Authentication is not required.

### 7.2 Allowed Request Body

Only:

`{ "email": "user@example.com" }`

Unknown or additional fields must be rejected.

### 7.3 Validation

The backend must:

- require an email;
- normalize it consistently with existing authentication behavior;
- validate the request format;
- reject unexpected fields.

### 7.4 Enumeration Resistance

For a syntactically valid request, the endpoint must not reveal whether the email belongs to a PhishGuard account.

Existing and nonexistent accounts must receive the same public success response.

Example:

`If an account exists for that email, a password reset link has been sent.`

The response must not expose:

- whether the account exists;
- user ID;
- role;
- account status;
- reset token;
- reset-token hash;
- expiration timestamp.

### 7.5 Existing Account

If an eligible account exists:

1. generate a new secure token;
2. hash the token;
3. store the hash and expiration;
4. construct the reset URL;
5. attempt to send the reset email.

### 7.6 Nonexistent Account

If no matching account exists:

- do not create reset state;
- do not reveal that no account exists;
- return the same generic public response.

---

## 8. Email Delivery Failure

Email provider failures must fail safely.

Provider API keys, provider response internals, reset tokens, and stack traces must never be returned to the client.

The backend may record a sanitized operational error without logging secrets or the raw reset URL/token.

If delivery fails after reset state is stored, the backend must clear that reset state before completing the request. The cleanup must be conditional on the token hash generated by that request so that a concurrent newer reset request cannot accidentally be invalidated.

If reset state was created but the email cannot be delivered, the implementation must avoid leaving a usable reset token that the user never received.

The public behavior must avoid exposing account existence through materially different account-specific responses.

---

## 9. Reset Password Endpoint

### 9.1 Endpoint

`POST /api/auth/reset-password`

Authentication is not required.

### 9.2 Request Body

Only:

`{ "token": "<reset-token>", "password": "<new-password>" }`

Unknown or additional fields must be rejected.

The client may use a confirmation-password field locally, but confirmation does not need to be sent to the API.

### 9.3 Token Verification

The backend must:

1. require a token;
2. hash the received token using the same hashing method used during generation;
3. find the corresponding active reset state;
4. require the expiration time to still be in the future;
5. reject invalid, expired, superseded, or already-used tokens.

The raw token must not be stored during verification.

### 9.4 New Password

The new password must follow the existing PhishGuard password policy.

The password must be hashed using the existing bcrypt policy:

**bcrypt cost factor 12**

Plaintext passwords must never be stored.

### 9.5 Successful Reset

On successful reset, the backend must:

1. hash the new password;
2. update the user's password;
3. invalidate or clear the password-reset token hash;
4. invalidate or clear the password-reset expiration;
5. persist the change;
6. return a safe success response.

Example:

`Password reset successfully. You can now log in with your new password.`

The user is not automatically logged in.

---

## 10. Invalid Reset Links

Invalid reset attempts include:

- malformed token;
- unknown token;
- expired token;
- superseded token;
- already-used token.

These conditions must fail safely.

The response should not expose:

- token hashes;
- database information;
- user information;
- provider information;
- stack traces.

The frontend should show a user-friendly message explaining that the reset link is invalid or has expired and provide a path back to Forgot Password.

---

## 11. Rate Limiting

Password-reset requests must be rate-limited.

At minimum, rate limiting must protect:

`POST /api/auth/forgot-password`

The purpose is to reduce:

- email flooding;
- automated abuse;
- account enumeration attempts;
- unnecessary provider usage.

The limit should be reasonable for legitimate users and substantially lower than unrestricted API access.

Rate-limit responses must not expose whether an account exists.

The implementation may use the project's existing `express-rate-limit` dependency.

V1 does not require distributed rate-limit storage.

The existing limitation that in-memory rate limits reset when the server restarts is acceptable for V1 and should be documented.

---

## 12. Logging

Password Reset V1 must not log:

- plaintext passwords;
- reset tokens;
- reset URLs containing tokens;
- token hashes;
- provider API keys;
- Authorization headers;
- request bodies containing passwords or tokens.

Safe security events may be logged using structured event names without sensitive payloads.

Examples:

- `PASSWORD_RESET_REQUESTED`
- `PASSWORD_RESET_COMPLETED`
- `PASSWORD_RESET_EMAIL_FAILED`

Logs must avoid revealing sensitive reset material.

---

## 13. Frontend - Forgot Password

Route:

`/forgot-password`

The page should provide:

- email field;
- submit button;
- loading state;
- generic success state;
- safe error state;
- link back to Login.

The page must not tell the user whether an entered email is registered.

After a syntactically valid accepted request, display the generic message supplied or defined by the application.

---

## 14. Frontend - Reset Password

Route:

`/reset-password/:token`

The page should provide:

- new password field;
- confirm new password field;
- submit button;
- client-side confirmation check;
- loading state;
- success state;
- invalid or expired-link state;
- link to request another reset;
- link back to Login after successful reset.

The frontend must not:

- store the reset token in localStorage;
- store the reset token in sessionStorage;
- log the reset token;
- expose the token unnecessarily in page content.

The token is used only as required to submit the reset request.

---

## 15. Existing Authentication Behavior

Password Reset V1 must preserve existing authentication behavior unless explicitly required by this specification.

In particular:

- registration behavior remains unchanged;
- login behavior remains unchanged;
- existing JWT structure remains unchanged;
- existing RBAC behavior remains unchanged;
- existing role values remain unchanged;
- public registration still cannot choose a role;
- bcrypt cost factor remains 12.

Password Reset V1 must not weaken existing authentication or authorization controls.

---

## 16. Account Status

Password reset does not reactivate an inactive account.

If the existing authentication system prevents an inactive account from logging in, successfully changing its password must not bypass that restriction.

Password reset is credential recovery, not account reactivation.

---

## 17. API Responses and Cache Behavior

Password-reset endpoints must return safe JSON responses.

Responses containing password-reset workflow information must not expose secret reset state.

Authentication/reset responses should use:

`Cache-Control: no-store`

where appropriate to reduce caching of sensitive authentication workflow responses.

---

## 18. Error Handling

Expected client-facing categories include:

- `400` malformed or invalid request;
- `429` rate limit exceeded;
- safe failure for invalid or expired reset tokens;
- `500` only for unexpected server failures without internal details.

Existing project error-handling conventions should be followed where compatible with this specification.

No stack trace, database error, provider credential, or secret value may be returned to the client.

---

## 19. Environment Configuration

Password Reset V1 requires environment configuration for transactional email and reset-link construction.

Exact variable names should be defined during implementation and documented in `.env.example`.

They must cover at least:

- transactional email provider credentials;
- sender identity or address;
- frontend or client URL.

Production values belong only in the deployment environment.

Local secrets belong only in `.env`.

No real secret value may be committed.

---

## 20. Testing Requirements

Backend tests must cover at least:

1. forgot-password request validation;
2. rejection of unexpected fields;
3. generic response for an existing account;
4. generic response for a nonexistent account;
5. secure reset-token creation behavior;
6. only the token hash is stored;
7. reset-token expiration;
8. newest reset request invalidates the previous token;
9. invalid token rejection;
10. expired token rejection;
11. already-used token rejection;
12. successful password reset;
13. new password stored using bcrypt rather than plaintext;
14. bcrypt comparison succeeds with the new password;
15. reset state cleared after success;
16. reused token fails;
17. email provider failure is handled safely;
18. no raw reset token is exposed in API responses;
19. rate limiting protects reset requests;
20. existing authentication behavior remains functional.

Email tests must use an injected or mock mail service.

Automated tests must not send real emails.

Automated tests must not require real Brevo credentials.

Frontend verification must include:

- lint;
- production build;
- Forgot Password route;
- Reset Password route;
- password confirmation behavior;
- loading, error, and success states;
- safe handling of invalid or expired links.

---

## 21. Manual Runtime Verification

After automated tests pass, manually verify locally:

1. request reset for a real test account;
2. receive the actual PhishGuard reset email;
3. open the reset link;
4. set a new password;
5. confirm the reset succeeds;
6. confirm the same reset link cannot be reused;
7. confirm the old password no longer logs in;
8. confirm the new password logs in;
9. request another reset and verify an older outstanding link becomes invalid;
10. request reset for a nonexistent email and confirm the UI does not reveal account existence.

After deployment, verify the production reset URL points to the production PhishGuard frontend and that an actual email can be received.

Do not expose reset tokens, passwords, provider credentials, or other secrets while documenting test results.

---

## 22. Security Boundaries

The backend is authoritative for:

- account lookup;
- reset-token generation;
- reset-token hashing;
- reset-token expiration;
- reset-token validity;
- password hashing;
- token invalidation;
- email construction and delivery request.

The frontend is responsible only for:

- collecting the email;
- collecting and confirming the new password;
- carrying the reset token from the reset URL to the reset request;
- presenting safe workflow states.

Frontend validation is usability support and is not a security boundary.

---

## 23. V1 Completion Criteria

Password Reset V1 is complete when:

- Forgot Password is available from Login;
- real password-reset emails can reach a user's inbox;
- reset links return users to PhishGuard;
- reset tokens are cryptographically random;
- only reset-token hashes are stored;
- reset links expire after 15 minutes;
- reset links are single-use;
- newer reset requests supersede older reset links;
- account enumeration is mitigated through generic responses;
- reset requests are rate-limited;
- passwords continue to use bcrypt cost factor 12;
- email-provider secrets remain backend-only;
- automated tests pass;
- frontend lint and build pass;
- local real-email reset flow passes;
- deployed production reset flow is verified.