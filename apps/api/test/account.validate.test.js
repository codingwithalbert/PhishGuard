const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateChangePasswordRequest,
  validateProfileUpdateRequest
} = require("../src/middleware/account.validate.middleware");
const {
  PASSWORD_POLICY
} = require("../src/services/passwordReset.service");
const {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH
} = require("../src/services/account.service");

// Mirrors the middleware harness used by validate.middleware.test.js.
function runMiddleware(middleware, body) {
  let response = null;
  let nextCalled = false;
  const headers = {};

  const req = { body };

  const res = {
    set(name, value) {
      headers[name] = value;
      return this;
    },

    status(code) {
      return {
        json(data) {
          response = { status: code, data };
        }
      };
    }
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { req, res, headers, response, nextCalled };
}

function assertRejected(result, message) {
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.response.data, {
    success: false,
    error: message
  });
  assert.equal(result.headers["Cache-Control"], "no-store");
}

const INVALID_NAME_MESSAGE = `Name must be between ${PROFILE_NAME_MIN_LENGTH} and ${PROFILE_NAME_MAX_LENGTH} characters`;
const INVALID_NEW_PASSWORD_MESSAGE = `Password must be between ${PASSWORD_POLICY.minLength} and ${PASSWORD_POLICY.maxLength} characters`;

test("profile validation accepts exactly { name }", () => {
  const result = runMiddleware(validateProfileUpdateRequest, {
    name: "Valid Name"
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, null);
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("profile validation trims the submitted name", () => {
  const result = runMiddleware(validateProfileUpdateRequest, {
    name: "   Padded Name   "
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.name, "Padded Name");
});

test("profile validation enforces the name boundaries", () => {
  for (const name of [
    "a".repeat(PROFILE_NAME_MIN_LENGTH),
    "a".repeat(PROFILE_NAME_MAX_LENGTH)
  ]) {
    const result = runMiddleware(validateProfileUpdateRequest, {
      name
    });

    assert.equal(result.nextCalled, true, `${name.length} chars`);
  }

  for (const name of [
    "",
    "   ",
    "a",
    "a".repeat(PROFILE_NAME_MAX_LENGTH + 1)
  ]) {
    assertRejected(
      runMiddleware(validateProfileUpdateRequest, { name }),
      INVALID_NAME_MESSAGE
    );
  }
});

test("profile validation rejects a non-string name", () => {
  for (const name of [null, undefined, 42, true, { value: "Name" }, ["Name"]]) {
    assertRejected(
      runMiddleware(validateProfileUpdateRequest, { name }),
      INVALID_NAME_MESSAGE
    );
  }
});

test("profile validation rejects every server-owned or unexpected field", () => {
  const rejectedBodies = [
    {},
    { name: "Valid Name", email: "attacker@example.invalid" },
    { name: "Valid Name", role: "admin" },
    { name: "Valid Name", isActive: false },
    { name: "Valid Name", password: "hijack" },
    { name: "Valid Name", currentPassword: "x" },
    { name: "Valid Name", confirmPassword: "x" },
    { name: "Valid Name", passwordResetTokenHash: "hash" },
    { name: "Valid Name", passwordResetExpiresAt: null },
    { name: "Valid Name", createdAt: "2026-01-01" },
    { name: "Valid Name", updatedAt: "2026-01-01" },
    { name: "Valid Name", userId: "someone-else" },
    { name: "Valid Name", id: "someone-else" },
    { email: "attacker@example.invalid" },
    { role: "admin" },
    { id: "someone-else" }
  ];

  for (const body of rejectedBodies) {
    assertRejected(
      runMiddleware(validateProfileUpdateRequest, body),
      "Only name may be submitted"
    );
  }
});

test("profile validation rejects non-object bodies", () => {
  for (const body of [null, undefined, [], "name", 42, true]) {
    assertRejected(
      runMiddleware(validateProfileUpdateRequest, body),
      "Only name may be submitted"
    );
  }
});

test("change-password validation accepts exactly { currentPassword, newPassword }", () => {
  const result = runMiddleware(validateChangePasswordRequest, {
    currentPassword: "current-Password-1",
    newPassword: "new-Password-2"
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, null);
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("change-password validation requires a non-empty current password", () => {
  for (const currentPassword of [
    "",
    null,
    undefined,
    42,
    true,
    {},
    ["password"]
  ]) {
    assertRejected(
      runMiddleware(validateChangePasswordRequest, {
        currentPassword,
        newPassword: "new-Password-2"
      }),
      "Current password is required"
    );
  }
});

test("change-password validation enforces the shared password policy", () => {
  for (const newPassword of [
    "a".repeat(PASSWORD_POLICY.minLength),
    "a".repeat(PASSWORD_POLICY.maxLength)
  ]) {
    const result = runMiddleware(validateChangePasswordRequest, {
      currentPassword: "current-Password-1",
      newPassword
    });

    assert.equal(result.nextCalled, true, `${newPassword.length} chars`);
  }

  for (const newPassword of [
    "a".repeat(PASSWORD_POLICY.minLength - 1),
    "a".repeat(PASSWORD_POLICY.maxLength + 1),
    "",
    null,
    undefined,
    12345678,
    {}
  ]) {
    assertRejected(
      runMiddleware(validateChangePasswordRequest, {
        currentPassword: "current-Password-1",
        newPassword
      }),
      INVALID_NEW_PASSWORD_MESSAGE
    );
  }
});

test("change-password validation rejects unexpected and server-owned fields", () => {
  const rejectedBodies = [
    {},
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      confirmPassword: "new-Password-2"
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      email: "attacker@example.invalid"
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      role: "admin"
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      isActive: true
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      password: "hijack"
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      name: "Renamed"
    },
    {
      currentPassword: "current-Password-1",
      newPassword: "new-Password-2",
      userId: "someone-else"
    },
    { newPassword: "new-Password-2" },
    { currentPassword: "current-Password-1" },
    { currentPassword: "current-Password-1" }
  ];

  for (const body of rejectedBodies) {
    assertRejected(
      runMiddleware(validateChangePasswordRequest, body),
      "Only currentPassword and newPassword may be submitted"
    );
  }
});

test("change-password validation rejects non-object bodies", () => {
  for (const body of [null, undefined, [], "passwords", 42]) {
    assertRejected(
      runMiddleware(validateChangePasswordRequest, body),
      "Only currentPassword and newPassword may be submitted"
    );
  }
});

test("password validation never echoes submitted password values", () => {
  const secrets = [
    "superSecretCurrent1",
    "superSecretNewValue2"
  ];

  for (const body of [
    { currentPassword: secrets[0], newPassword: "short" },
    { currentPassword: "", newPassword: secrets[1] },
    {
      currentPassword: secrets[0],
      newPassword: secrets[1],
      extra: secrets[1]
    }
  ]) {
    const result = runMiddleware(validateChangePasswordRequest, body);
    const serialized = JSON.stringify(result.response);

    for (const secret of secrets) {
      assert.equal(
        serialized.includes(secret),
        false,
        "Validation errors must not echo password values"
      );
    }
  }
});
