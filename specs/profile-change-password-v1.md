# Profile & Change Password V1 Specification

## 1. Purpose

Profile & Change Password V1 provides authenticated, self-service account
management for PhishGuard:

- view the current account profile,
- change the display name,
- change the account password.

The feature is intentionally narrow. It adds no email verification, no role
administration, no account deletion, no avatar handling, and no session
management infrastructure. Every account change is self-service: a user may read
and modify only their own account.

---

## 2. Scope

### 2.1 Included in V1

- Authenticated access for `user`, `staff`, and `admin` roles.
- Authoritative profile read through the existing `GET /api/auth/me`.
- Editable display name with the existing registration length rules.
- Password change with current-password verification.
- Clearing outstanding password-reset state after a successful password change.
- Safe audit events for successful account changes.
- A protected `/profile` frontend page with a name form and a password form.

### 2.2 Not Included in V1

- Changing an email address.
- Email verification.
- Changing a role.
- Admin editing another user's profile.
- Account deletion.
- Account deactivation or activation controls.
- Avatar or profile photo.
- MFA management.
- Password history.
- Forced password rotation or expiry.
- Session or token revocation.
- "Log out all devices" functionality.
- A username system.
- Notification preferences.
- Biography or other personal profile fields.

---

## 3. Access and Ownership

- The feature is available to authenticated accounts with role `user`,
  `staff`, or `admin`.
- A user may access and modify only their own account.
- The backend is the security boundary and must derive the target account from
  `req.user.userId` established by the existing `authenticate` middleware.
- The backend must never accept a target user id from the client, in the path,
  the query string, or the request body.
- Frontend route gating is a usability control only and must not be treated as
  the security boundary.

---

## 4. Profile

### 4.1 Authoritative Read

`GET /api/auth/me` remains the authoritative profile reader and must not be
redesigned. It continues to return the safe profile representation.

The profile displays:

- `name`
- `email`
- `role`

### 4.2 Editable Fields

- Only `name` is editable in V1.
- `email` is read-only.
- `role` is read-only.

### 4.3 Name Rules

- The submitted name is trimmed before validation and persistence.
- The trimmed name must be between 2 and 50 characters inclusive.
- These are the existing registration and `User` model rules; V1 must not
  introduce a conflicting rule.

### 4.4 Update Endpoint

```
PATCH /api/auth/profile
```

Authentication: required.

Request body must contain exactly:

```json
{
  "name": "..."
}
```

Rules:

- Additional or unknown fields are rejected.
- `name` must be a string.
- The client must never be able to modify `email`, `role`, `isActive`,
  `password`, password-reset state, timestamps, or any other server-owned
  field. Because the body must contain exactly `name`, an attempt to submit any
  of those fields is rejected as an unexpected field.
- No mass assignment: the update writes only the validated `name` for the
  account identified by `req.user.userId`.

Successful response:

- HTTP `200`
- `Cache-Control: no-store`
- Body contains only the safe profile representation:

```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "role": "..."
  }
}
```

The response must never include `password`, password-reset state, `isActive`,
timestamps, or any other non-profile field.

---

## 5. Change Password

### 5.1 Endpoint

```
POST /api/auth/change-password
```

Authentication: required.

Request body must contain exactly:

```json
{
  "currentPassword": "...",
  "newPassword": "..."
}
```

Rules:

- Additional or unknown fields are rejected.
- Both values must be strings.
- `currentPassword` must not be empty.
- `newPassword` must satisfy the existing PhishGuard password policy.
- A confirmation-password field is a frontend-only concern and must never be
  accepted by this endpoint.

### 5.2 Reused Policy and Hashing

V1 must reuse the existing authoritative policy rather than defining a
conflicting one:

- Minimum 8 characters, maximum 128 characters, from the exported
  `PASSWORD_POLICY` in `services/passwordReset.service.js`.
- Password hashing with bcrypt cost factor 12, from the exported
  `PASSWORD_HASH_COST` in `services/passwordReset.service.js`.

### 5.3 Password-Change Algorithm

The backend must perform these steps in order:

1. Load the authenticated account by `req.user.userId`.
2. Load the password explicitly, because `User.password` uses `select: false`.
   This is an internal server-side selection and must never appear in a
   response.
3. Verify the submitted `currentPassword` with `bcrypt.compare` against the
   stored hash.
4. If verification fails, return a safe authentication-style error and make no
   change.
5. Reject a `newPassword` that is identical to the current password.
6. Hash the new password with bcrypt cost factor 12.
7. Persist the new hash and clear password-reset state in the same update.
8. Return a safe success response.

Additional requirements:

- Never return, log, persist separately, or expose a plaintext password.
- Never return the password hash or password-reset state.
- Never echo either submitted password in an error message.
- `Cache-Control: no-store` on every response from this endpoint.

### 5.4 Safe Error Cases

| Case | Status | Public message requirement |
|---|---|---|
| Missing or invalid authentication | 401 | Existing `authenticate` response |
| Authenticated account missing or inactive | 404 | Generic "account not found" style response, consistent with `GET /api/auth/me` |
| Unexpected or missing body fields | 400 | Message naming only that the submitted fields are not allowed |
| `currentPassword` empty or not a string | 400 | Message naming the current password requirement only |
| `newPassword` shorter than 8 or longer than 128 characters | 400 | Message naming the 8 to 128 character policy only |
| `currentPassword` incorrect | 401 | Safe message that the current password is incorrect, with no password, hash, or storage detail |
| `newPassword` identical to `currentPassword` | 400 | Message stating the new password must be different |
| Unexpected server failure | 500 | Existing global safe error response |

No error may reveal whether a stored hash exists, its length, its cost factor
beyond the already-documented policy, or any account detail beyond the
authenticated account itself.

### 5.5 Success Response

- HTTP `200`
- `Cache-Control: no-store`
- Body:

```json
{
  "success": true,
  "message": "Password changed successfully."
}
```

The response must not include a token, user payload, hash, or reset state.

---

## 6. Password-Reset State Interaction

On a successful password change, the backend must clear:

- `passwordResetTokenHash`
- `passwordResetExpiresAt`

Rationale: the raw reset token was delivered to the old password holder's inbox
and must no longer be usable. Clearing the stored hash means any outstanding
reset link fails verification, because reset verification matches the stored
hash.

Requirements:

- Both fields are cleared in the same update that writes the new password hash.
- Reset state must NOT be cleared when the change fails, including when the
  current password is incorrect or the new password is rejected.
- Password Reset V1 endpoints and their behavior must remain unchanged.
- The change-password endpoint must never return reset state, and the
  forgot/reset endpoints must never return the password.

---

## 7. Session Behavior

- V1 adds no token revocation, server-side session storage, or token
  invalidation list.
- The JWT used for the password change remains valid after the change until its
  existing expiration.
- Other JWTs already issued for the same account also remain valid until their
  normal expiration.
- Password change must not automatically log the current user out.
- The frontend must keep the current session active after a successful change.

This is a documented V1 limitation, not an oversight. See Section 15.

---

## 8. Audit Logging

Audit events use the existing `auditLog(event, req, details)` convention with
structured event names and no sensitive payloads.

| Event | When | Permitted metadata |
|---|---|---|
| `PROFILE_UPDATED` | Successful name update | Authenticated user id, role |
| `PASSWORD_CHANGED` | Successful password change | Authenticated user id, role |
| `PASSWORD_CHANGE_FAILED` | Failed current-password verification | Authenticated user id, role, a fixed reason code such as `invalid_current_password` |

Audit metadata may include the authenticated user id, the role, and other
non-secret event metadata that is useful for operations.

Audit metadata must never include:

- `currentPassword`
- `newPassword`
- Any plaintext password
- Any password hash
- Any password-reset token or token hash
- Any request body containing secrets
- Any `Authorization` header value

---

## 9. Frontend

### 9.1 Route

- Add a protected route: `/profile`.
- Accessible to authenticated `user`, `staff`, and `admin` accounts.
- Use the existing frontend route protection component; do not introduce a new
  authentication state system.
- Read the stored role using the existing defensively parsed
  `localStorage.user` convention already used by frontend route and navigation
  helpers.

### 9.2 Navigation

- Add a Profile link to the existing authenticated navigation.
- Use the existing navigation conventions. Because all three roles can use the
  page, the link is not role-restricted.
- Do not perform a navigation or UI redesign in this feature.

### 9.3 Page Behavior

The Profile page must:

- Load authoritative account information from `GET /api/auth/me`.
- Show `name`, `email`, and `role`.
- Present `email` as read-only.
- Present `role` as read-only.
- Provide a separate Edit Profile form for `name`.
- Provide a separate Change Password form.
- Use password input types for current-password and new-password fields.
- Never prefill password fields.
- Never store password field values in `localStorage` or `sessionStorage`.
- Never log passwords.
- Clear both password inputs after a successful password change.
- Provide safe success, error, and loading states.
- Handle 401, 403, and session errors consistently with existing pages, using
  the same sign-in-again and retry patterns.

After a successful name update, the page must:

- Update the safe `localStorage.user` snapshot so the current session reflects
  the new name.
- Never add additional sensitive account data to browser storage.

After a successful password change, the page must:

- Keep the current session active.
- Clear both password inputs.
- Display a confirmation.
- Not store the submitted passwords.

### 9.4 Password Confirmation

For usability, the frontend includes a confirm-new-password field that is
client-only:

- It is never sent to the backend.
- The frontend verifies that the new password and its confirmation match before
  submitting.
- The backend API remains exactly `currentPassword` and `newPassword`.

### 9.5 Styling

- Use the existing PhishGuard visual system and existing reusable page classes.
- This feature is not a UI redesign.
- Do not add packages, chart libraries, or new design systems.

---

## 10. Security and Privacy Boundaries

- Self-service only. There is no administrative account-management surface.
- No account enumeration behavior. Responses must not reveal whether any other
  account exists.
- No email changes.
- No role changes.
- No `isActive` changes.
- No arbitrary property updates.
- No mass assignment.
- No password, hash, or password-reset-state leakage in any response.
- No password values in audit logs.
- No password values in browser storage.
- No new MongoDB collection is required. Everything derives from the existing
  `users` collection.

---

## 11. Testing Requirements

### 11.1 Backend

Backend tests should cover at minimum:

- Authentication required for both endpoints.
- `user`, `staff`, and `admin` may manage only their own account.
- Exact-field validation on both request bodies.
- Name trimming.
- Name minimum and maximum boundaries.
- Successful profile update.
- Safe profile response shape.
- Attempts to submit `email`, `role`, `isActive`, `password`, a user id, or
  other server-owned fields are rejected.
- Inactive or missing authenticated user handled safely.
- Current password required.
- New password required.
- Password 8 to 128 character policy.
- Incorrect current password rejected.
- Identical current and new password rejected.
- Successful bcrypt password replacement.
- bcrypt cost remains 12.
- Outstanding reset state cleared after a successful change.
- Reset state not cleared on a failed change.
- Old password no longer authenticates after a successful change.
- New password authenticates.
- Responses never expose password, hash, or reset fields.
- `Cache-Control: no-store` on both endpoints.
- Safe audit behavior where practical to test.

Tests must not require a live email provider, and must not send real email.

### 11.2 Frontend

Frontend verification should cover:

- `/profile` is protected.
- All authenticated roles can access it.
- Profile loads from `GET /api/auth/me`.
- Email and role are read-only.
- Name update works.
- The `localStorage.user` snapshot updates after a name change.
- Confirmation mismatch is blocked client-side.
- A successful password change clears the password inputs.
- The current session remains active.
- Safe error and session states are shown.
- No password storage or logging.

---

## 12. Compatibility

This feature must not change:

- Registration behavior.
- Login behavior.
- The existing JWT structure or its one-hour expiry.
- Existing role authorization behavior outside the new endpoints.
- `GET /api/auth/me` behavior.
- Password Reset V1 behavior, including forgot-password, reset-password,
  enumeration resistance, and rate limiting.
- The existing password policy or bcrypt cost factor.
- Any other feature's routes, responses, or page behavior.

The existing exported `PASSWORD_POLICY` and `PASSWORD_HASH_COST` must be reused
so that a second, conflicting password policy can never exist.

---

## 13. Data Model

No new MongoDB collection is introduced and no analytics or security state is
duplicated.

The feature uses the existing `users` collection only:

- `name` is updated in place.
- `password` is replaced in place.
- `passwordResetTokenHash` and `passwordResetExpiresAt` are cleared in place.

No migration is required.

---

## 14. API Summary

| Method | Path | Authentication | Authorization | Success |
|---|---|---|---|---|
| GET | `/api/auth/me` | Required | Any authenticated role | `200` safe profile |
| PATCH | `/api/auth/profile` | Required | Self only | `200` safe profile |
| POST | `/api/auth/change-password` | Required | Self only | `200` safe message |

Both new endpoints return `Cache-Control: no-store`.

---

## 15. Limitations

- Changing a password does not end other active sessions. Previously issued JWTs
  remain valid until their existing expiration, so a password change does not
  revoke access that was already granted. Users should be told to contact an
  administrator if they believe an account session is unauthorized.
- There is no session list, device list, or token revocation in V1.
- There is no password history, so a previously used password may be reused
  subject to the existing policy.
- There is no email change, so an account with an outdated email cannot be
  corrected by the account holder.
- A name change is recorded immediately and is not reversible from the
  interface.
- Re-authentication is limited to supplying the current password at the moment
  of the change.

These limitations should be documented rather than hidden.

---

## 16. V1 Completion Criteria

Profile & Change Password V1 is complete when:

- `GET /api/auth/me` remains the authoritative profile reader.
- A user can read their own name, email, and role.
- A user can change their own name and nothing else.
- Unexpected and server-owned fields are rejected on both new endpoints.
- A user can change their own password after verifying the current password.
- The new password is validated with the existing 8 to 128 character policy and
  hashed with bcrypt cost factor 12.
- An identical new password is rejected.
- Outstanding password-reset state is cleared only on a successful change.
- Neither endpoint ever returns or logs passwords, hashes, or reset state.
- Both new endpoints send `Cache-Control: no-store`.
- Safe audit events are emitted for successful changes.
- The `/profile` page is protected and reachable by all authenticated roles.
- Email and role are read-only in the interface.
- The current session survives a password change, and the limitation is
  documented.
- Existing registration, login, RBAC, and Password Reset V1 behavior is
  unchanged.
- Automated backend tests pass.
- Frontend lint and build pass.
- Manual verification confirms the full flow for at least one non-admin
  account.
