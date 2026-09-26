const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const {
  validateRegistration
} = require("../src/middleware/auth.validate.middleware");
const {
  PASSWORD_HASH_COST,
  PASSWORD_POLICY,
  PASSWORD_RESET_ERROR_CODES,
  PasswordResetServiceError,
  clearPasswordResetStateIfCurrent,
  completePasswordReset,
  normalizeResetEmail,
  preparePasswordReset
} = require("../src/services/passwordReset.service");
const {
  RESET_TOKEN_TTL_MS,
  hashResetToken
} = require("../src/services/passwordResetToken.service");

// Fields that Stage 1 marked with `select: false`. The fake user model hides
// them from reads unless a query explicitly selects them, so these tests fail
// if the service ever depends on reading protected reset state.
const PROTECTED_FIELDS = [
  "password",
  "passwordResetTokenHash",
  "passwordResetExpiresAt"
];

const OLD_PASSWORD = "old-Password-1";
const NEW_PASSWORD = "new-Password-2";

function valuesMatch(storedValue, expectedValue) {
  if (
    storedValue instanceof Date ||
    expectedValue instanceof Date
  ) {
    return (
      storedValue instanceof Date &&
      expectedValue instanceof Date &&
      storedValue.getTime() === expectedValue.getTime()
    );
  }

  if (storedValue === null || storedValue === undefined) {
    return storedValue === expectedValue;
  }

  if (
    typeof storedValue === "object" &&
    typeof storedValue.toHexString === "function"
  ) {
    return String(storedValue) === String(expectedValue);
  }

  return storedValue === expectedValue;
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (
      condition !== null &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date) &&
      "$gt" in condition
    ) {
      const storedValue = document[field];

      return (
        storedValue instanceof Date &&
        storedValue.getTime() > condition.$gt.getTime()
      );
    }

    return valuesMatch(document[field], condition);
  });
}

function projectDocument(document, selection) {
  const projected = { ...document };
  const selectedFields =
    typeof selection === "string" ? selection.split(/\s+/) : [];

  for (const field of PROTECTED_FIELDS) {
    if (!selectedFields.includes(`+${field}`)) {
      delete projected[field];
    }
  }

  return projected;
}

function createFakeUserModel(initialDocuments = []) {
  const documents = new Map();
  const updates = [];
  const finds = [];
  const selections = [];

  for (const document of initialDocuments) {
    documents.set(String(document._id), { ...document });
  }

  function findDocument(filter, record) {
    if (record) {
      record.push({ filter: { ...filter } });
    }

    const matched = [...documents.values()].find((document) =>
      matchesFilter(document, filter)
    );

    return matched || null;
  }

  return {
    updates,
    finds,
    selections,

    get size() {
      return documents.size;
    },

    getDocument(id) {
      return documents.get(String(id)) || null;
    },

    findOne(filter) {
      const query = {
        select(selection) {
          selections.push(selection);
          query.selection = selection;
          return query;
        },

        then(onFulfilled, onRejected) {
          return Promise.resolve()
            .then(() => {
              const matched = findDocument(filter, finds);

              return matched
                ? projectDocument(matched, query.selection)
                : null;
            })
            .then(onFulfilled, onRejected);
        }
      };

      return query;
    },

    async updateOne(filter, update) {
      const matched = findDocument(filter, null);
      const setValues = update?.$set || {};
      let modifiedCount = 0;

      if (matched) {
        modifiedCount = 1;

        for (const [field, value] of Object.entries(setValues)) {
          matched[field] = value;
        }
      }

      const result = {
        acknowledged: true,
        matchedCount: matched ? 1 : 0,
        modifiedCount
      };

      updates.push({ filter: { ...filter }, update, result });

      return result;
    }
  };
}

function createStoredUser({
  _id = new mongoose.Types.ObjectId(),
  email = "reset.stage2.user@example.invalid",
  password = bcrypt.hashSync(OLD_PASSWORD, 4),
  role = "user",
  isActive = true,
  passwordResetTokenHash = null,
  passwordResetExpiresAt = null
} = {}) {
  return {
    _id,
    name: "Reset Stage Two User",
    email,
    password,
    role,
    isActive,
    passwordResetTokenHash,
    passwordResetExpiresAt
  };
}

function runRegistrationValidation(body) {
  let nextCalled = false;
  let response;

  const req = { body };

  const res = {
    status(code) {
      return {
        json(data) {
          response = { status: code, data };
        }
      };
    }
  };

  validateRegistration(req, res, () => {
    nextCalled = true;
  });

  return { accepted: nextCalled, response };
}

function assertServiceError(error, code) {
  assert.ok(
    error instanceof PasswordResetServiceError,
    `Expected a PasswordResetServiceError, received ${error?.name}`
  );
  assert.equal(error.code, code);
  assert.equal(error.name, "PasswordResetServiceError");
  assert.equal(typeof error.status, "number");

  return error;
}

async function assertRejectedWith(operation, code) {
  let captured = null;

  try {
    await operation();
  } catch (error) {
    captured = error;
  }

  assert.ok(captured, "Expected the operation to be rejected");

  return assertServiceError(captured, code);
}

test("preparation for an existing account stores only the token hash and expiration", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);
  const now = new Date("2026-03-01T10:00:00.000Z");

  const prepared = await preparePasswordReset({
    email: "  RESET.Stage2.User@Example.Invalid  ",
    now,
    userModel
  });

  assert.ok(prepared);
  assert.deepEqual(Object.keys(prepared).sort(), [
    "email",
    "resetToken",
    "resetTokenHash",
    "userId"
  ]);
  assert.equal(String(prepared.userId), String(storedUser._id));
  assert.equal(prepared.email, storedUser.email);
  assert.equal(typeof prepared.resetToken, "string");
  assert.ok(prepared.resetToken.length > 0);

  assert.equal(userModel.finds.length, 1);
  assert.deepEqual(userModel.finds[0].filter, {
    email: "reset.stage2.user@example.invalid"
  });

  assert.equal(userModel.updates.length, 1);

  const [update] = userModel.updates;

  assert.equal(String(update.filter._id), String(storedUser._id));
  assert.deepEqual(Object.keys(update.update.$set), [
    "passwordResetTokenHash",
    "passwordResetExpiresAt"
  ]);

  const persisted = userModel.getDocument(storedUser._id);

  assert.equal(
    persisted.passwordResetTokenHash,
    prepared.resetTokenHash
  );
  assert.equal(
    persisted.passwordResetTokenHash,
    hashResetToken(prepared.resetToken)
  );
  assert.equal(
    persisted.passwordResetExpiresAt.getTime(),
    now.getTime() + RESET_TOKEN_TTL_MS
  );
  assert.equal(
    persisted.passwordResetExpiresAt.getTime() - now.getTime(),
    15 * 60 * 1000
  );
  assert.equal(persisted.password, storedUser.password);
  assert.equal(persisted.role, storedUser.role);
  assert.equal(persisted.isActive, storedUser.isActive);
});

test("the raw reset token is never persisted", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const persisted = userModel.getDocument(storedUser._id);

  assert.notEqual(
    persisted.passwordResetTokenHash,
    prepared.resetToken
  );
  assert.equal(
    Object.values(persisted).includes(prepared.resetToken),
    false
  );
  assert.equal(
    JSON.stringify(persisted).includes(prepared.resetToken),
    false
  );
  assert.equal(
    JSON.stringify(userModel.updates).includes(prepared.resetToken),
    false
  );
});

test("preparation creates no reset state for a nonexistent account", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: "nobody@example.invalid",
    userModel
  });

  assert.equal(prepared, null);
  assert.equal(userModel.size, 1);
  assert.equal(userModel.updates.length, 0);
  assert.equal(
    userModel.getDocument(storedUser._id).passwordResetTokenHash,
    null
  );
  assert.equal(
    userModel.getDocument(storedUser._id).passwordResetExpiresAt,
    null
  );
});

test("a newer reset request supersedes the previous outstanding token", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const first = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });
  const second = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const persisted = userModel.getDocument(storedUser._id);

  assert.notEqual(first.resetTokenHash, second.resetTokenHash);
  assert.equal(
    persisted.passwordResetTokenHash,
    second.resetTokenHash
  );

  await assertRejectedWith(
    () =>
      completePasswordReset({
        token: first.resetToken,
        newPassword: NEW_PASSWORD,
        userModel
      }),
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
  );

  assert.equal(
    userModel.getDocument(storedUser._id).password,
    storedUser.password
  );
});

test("conditional cleanup clears the matching request's reset state", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const cleared = await clearPasswordResetStateIfCurrent({
    userId: prepared.userId,
    resetTokenHash: prepared.resetTokenHash,
    userModel
  });

  assert.equal(cleared, true);

  const [cleanupUpdate] = userModel.updates.slice(1);

  assert.equal(
    String(cleanupUpdate.filter._id),
    String(storedUser._id)
  );
  assert.equal(
    cleanupUpdate.filter.passwordResetTokenHash,
    prepared.resetTokenHash
  );
  assert.deepEqual(cleanupUpdate.update.$set, {
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null
  });

  const persisted = userModel.getDocument(storedUser._id);

  assert.equal(persisted.passwordResetTokenHash, null);
  assert.equal(persisted.passwordResetExpiresAt, null);
});

test("conditional cleanup does not clear a newer request's reset state", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const older = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });
  const newer = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const cleared = await clearPasswordResetStateIfCurrent({
    userId: older.userId,
    resetTokenHash: older.resetTokenHash,
    userModel
  });

  assert.equal(cleared, false);

  const persisted = userModel.getDocument(storedUser._id);

  assert.equal(
    persisted.passwordResetTokenHash,
    newer.resetTokenHash
  );
  assert.equal(
    persisted.passwordResetTokenHash,
    hashResetToken(newer.resetToken)
  );
  assert.ok(persisted.passwordResetExpiresAt instanceof Date);
});

test("a valid token resets the password with the existing bcrypt policy", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);
  const originalPassword = storedUser.password;

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const completed = await completePasswordReset({
    token: prepared.resetToken,
    newPassword: NEW_PASSWORD,
    userModel
  });

  assert.deepEqual(Object.keys(completed), ["userId"]);
  assert.equal(String(completed.userId), String(storedUser._id));
  assert.equal(
    JSON.stringify(completed).includes(prepared.resetToken),
    false
  );

  const [completionUpdate] = userModel.updates.slice(1);

  assert.deepEqual(Object.keys(completionUpdate.update.$set), [
    "password",
    "passwordResetTokenHash",
    "passwordResetExpiresAt"
  ]);
  assert.equal(
    completionUpdate.filter.passwordResetTokenHash,
    prepared.resetTokenHash
  );
  assert.ok(
    completionUpdate.filter.passwordResetExpiresAt.$gt instanceof Date
  );

  const persisted = userModel.getDocument(storedUser._id);

  assert.notEqual(persisted.password, originalPassword);
  assert.notEqual(persisted.password, NEW_PASSWORD);
  assert.equal(
    await bcrypt.compare(NEW_PASSWORD, persisted.password),
    true
  );
  assert.equal(
    await bcrypt.compare(OLD_PASSWORD, persisted.password),
    false
  );
  assert.equal(
    bcrypt.getRounds(persisted.password),
    PASSWORD_HASH_COST
  );
  assert.equal(PASSWORD_HASH_COST, 12);
});

test("reset state is cleared on success and the token cannot be reused", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  await completePasswordReset({
    token: prepared.resetToken,
    newPassword: NEW_PASSWORD,
    userModel
  });

  const persisted = userModel.getDocument(storedUser._id);
  const passwordAfterReset = persisted.password;

  assert.equal(persisted.passwordResetTokenHash, null);
  assert.equal(persisted.passwordResetExpiresAt, null);

  await assertRejectedWith(
    () =>
      completePasswordReset({
        token: prepared.resetToken,
        newPassword: "another-Password-3",
        userModel
      }),
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
  );

  const afterReuse = userModel.getDocument(storedUser._id);

  assert.equal(afterReuse.password, passwordAfterReset);
  assert.equal(
    await bcrypt.compare("another-Password-3", afterReuse.password),
    false
  );
});

test("invalid and malformed tokens are rejected without touching stored state", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const updateCountBefore = userModel.updates.length;

  for (const token of [
    "",
    "   ",
    "not-a-real-token",
    "z".repeat(513),
    null,
    undefined,
    12345678,
    {}
  ]) {
    await assertRejectedWith(
      () =>
        completePasswordReset({
          token,
          newPassword: NEW_PASSWORD,
          userModel
        }),
      PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
    );
  }

  assert.equal(userModel.updates.length, updateCountBefore);
  assert.equal(
    userModel.getDocument(storedUser._id).password,
    storedUser.password
  );
  assert.equal(
    userModel.getDocument(storedUser._id).passwordResetTokenHash,
    prepared.resetTokenHash
  );
});

test("expired tokens are rejected safely", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);
  const issuedAt = new Date("2026-03-01T10:00:00.000Z");

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    now: issuedAt,
    userModel
  });

  const updateCountBefore = userModel.updates.length;

  for (const checkTime of [
    new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS),
    new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS + 60000)
  ]) {
    await assertRejectedWith(
      () =>
        completePasswordReset({
          token: prepared.resetToken,
          newPassword: NEW_PASSWORD,
          now: checkTime,
          userModel
        }),
      PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
    );
  }

  const persisted = userModel.getDocument(storedUser._id);

  assert.equal(userModel.updates.length, updateCountBefore);
  assert.equal(persisted.password, storedUser.password);
  assert.equal(
    persisted.passwordResetTokenHash,
    prepared.resetTokenHash
  );
  assert.equal(
    await bcrypt.compare(NEW_PASSWORD, persisted.password),
    false
  );
});

test("competing completion attempts cannot both consume the same token", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const firstPassword = "competing-Password-A";
  const secondPassword = "competing-Password-B";

  const outcomes = await Promise.allSettled([
    completePasswordReset({
      token: prepared.resetToken,
      newPassword: firstPassword,
      userModel
    }),
    completePasswordReset({
      token: prepared.resetToken,
      newPassword: secondPassword,
      userModel
    })
  ]);

  const fulfilled = outcomes.filter(
    (outcome) => outcome.status === "fulfilled"
  );
  const rejected = outcomes.filter(
    (outcome) => outcome.status === "rejected"
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  assertServiceError(
    rejected[0].reason,
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
  );

  const persisted = userModel.getDocument(storedUser._id);
  const winnerChecks = await Promise.all([
    bcrypt.compare(firstPassword, persisted.password),
    bcrypt.compare(secondPassword, persisted.password)
  ]);

  assert.equal(
    winnerChecks.filter(Boolean).length,
    1,
    "Exactly one competing attempt may set the new password"
  );
  assert.equal(persisted.passwordResetTokenHash, null);
  assert.equal(persisted.passwordResetExpiresAt, null);
});

test("role and isActive are never written during a password reset", async () => {
  const storedUser = createStoredUser({
    role: "staff",
    isActive: false
  });
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  await completePasswordReset({
    token: prepared.resetToken,
    newPassword: NEW_PASSWORD,
    userModel
  });

  const [completionUpdate] = userModel.updates.slice(1);
  const persisted = userModel.getDocument(storedUser._id);
  const setFields = completionUpdate.update.$set;

  assert.equal(
    Object.prototype.hasOwnProperty.call(setFields, "role"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(setFields, "isActive"),
    false
  );
  assert.equal(persisted.role, "staff");
  assert.equal(persisted.isActive, false);
  assert.equal(
    await bcrypt.compare(NEW_PASSWORD, persisted.password),
    true
  );
});

test("an inactive account is not reactivated by a password reset", async () => {
  const storedUser = createStoredUser({ isActive: false });
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  assert.notEqual(prepared, null);

  await completePasswordReset({
    token: prepared.resetToken,
    newPassword: NEW_PASSWORD,
    userModel
  });

  assert.equal(
    userModel.getDocument(storedUser._id).isActive,
    false
  );
});

test("service errors expose no account, token, or password details", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  const error = await assertRejectedWith(
    () =>
      completePasswordReset({
        token: `${prepared.resetToken}x`,
        newPassword: NEW_PASSWORD,
        userModel
      }),
    PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
  );

  const serializedError = JSON.stringify(error);

  for (const sensitiveValue of [
    storedUser.email,
    storedUser._id.toString(),
    prepared.resetToken,
    prepared.resetTokenHash,
    NEW_PASSWORD,
    storedUser.password
  ]) {
    assert.equal(
      serializedError.includes(sensitiveValue),
      false,
      "Service error output must not contain sensitive reset data"
    );
  }

  for (const leakedField of [
    "userId",
    "email",
    "resetToken",
    "resetTokenHash",
    "password"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(error, leakedField),
      false
    );
  }
});

test("reset-state matching relies on database filters, not hidden-field reads", async () => {
  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  const prepared = await preparePasswordReset({
    email: storedUser.email,
    userModel
  });

  await completePasswordReset({
    token: prepared.resetToken,
    newPassword: NEW_PASSWORD,
    userModel
  });

  const completionFind = userModel.finds[1];

  assert.deepEqual(Object.keys(completionFind.filter), [
    "passwordResetTokenHash",
    "passwordResetExpiresAt"
  ]);
  assert.equal(
    completionFind.filter.passwordResetTokenHash,
    prepared.resetTokenHash
  );
  assert.ok(
    completionFind.filter.passwordResetExpiresAt.$gt instanceof Date
  );
  assert.deepEqual(userModel.selections, []);
});

test("malformed email formats are rejected like the registration validator", async () => {
  const malformed = [
    "not-an-email",
    "missing-domain@example",
    "missing-local@",
    "@example.invalid",
    "double@@example.invalid",
    "trailing-dot@example.",
    "leading-dot@.invalid",
    "user name@example.invalid",
    "user@exam ple.invalid",
    "user@exam\tple.invalid",
    "  ",
    ""
  ];

  for (const email of malformed) {
    assert.throws(
      () => normalizeResetEmail(email),
      (error) => {
        assertServiceError(
          error,
          PASSWORD_RESET_ERROR_CODES.INVALID_EMAIL
        );
        return true;
      },
      `Expected ${JSON.stringify(email)} to be rejected`
    );

    const registration = runRegistrationValidation({
      name: "Email Format User",
      email,
      password: NEW_PASSWORD
    });

    assert.equal(
      registration.accepted,
      false,
      `Registration must also reject ${JSON.stringify(email)}`
    );
  }

  const valid = [
    "user@example.invalid",
    "user.name+tag@sub.example.invalid",
    "  Mixed.Case@Example.Invalid  "
  ];

  for (const email of valid) {
    assert.equal(
      normalizeResetEmail(email),
      email.trim().toLowerCase()
    );

    assert.equal(
      runRegistrationValidation({
        name: "Email Format User",
        email,
        password: NEW_PASSWORD
      }).accepted,
      true,
      `Registration must accept ${JSON.stringify(email)}`
    );
  }

  const storedUser = createStoredUser();
  const userModel = createFakeUserModel([storedUser]);

  await assertRejectedWith(
    () =>
      preparePasswordReset({
        email: "not-an-email",
        userModel
      }),
    PASSWORD_RESET_ERROR_CODES.INVALID_EMAIL
  );

  assert.equal(userModel.finds.length, 0);
  assert.equal(userModel.updates.length, 0);
});

test("email normalization matches existing authentication behavior", () => {
  assert.equal(
    normalizeResetEmail("  Reset.Stage2@Example.Invalid  "),
    "reset.stage2@example.invalid"
  );

  for (const invalidEmail of [
    "",
    "   ",
    null,
    undefined,
    42,
    `${"a".repeat(250)}@example.invalid`
  ]) {
    assert.throws(
      () => normalizeResetEmail(invalidEmail),
      (error) => {
        assertServiceError(
          error,
          PASSWORD_RESET_ERROR_CODES.INVALID_EMAIL
        );
        return true;
      }
    );
  }
});

test("the reset password policy matches the existing registration policy", async () => {
  assert.deepEqual(PASSWORD_POLICY, {
    minLength: 8,
    maxLength: 128
  });

  const accepted = ["aaaaaaaa", "a".repeat(128), "        "];
  const rejected = [
    "a".repeat(7),
    "a".repeat(129),
    "",
    "   ",
    null,
    undefined,
    12345678
  ];

  for (const password of accepted) {
    const storedUser = createStoredUser();
    const userModel = createFakeUserModel([storedUser]);
    const registration = runRegistrationValidation({
      name: "Policy User",
      email: "policy-accepted@example.invalid",
      password
    });

    assert.equal(registration.accepted, true);

    const prepared = await preparePasswordReset({
      email: storedUser.email,
      userModel
    });

    const completed = await completePasswordReset({
      token: prepared.resetToken,
      newPassword: password,
      userModel
    });

    assert.equal(String(completed.userId), String(storedUser._id));
    assert.equal(
      await bcrypt.compare(
        password,
        userModel.getDocument(storedUser._id).password
      ),
      true
    );
  }

  for (const password of rejected) {
    const registration = runRegistrationValidation({
      name: "Policy User",
      email: "policy-rejected@example.invalid",
      password
    });

    assert.equal(registration.accepted, false);

    const storedUser = createStoredUser();
    const userModel = createFakeUserModel([storedUser]);

    const prepared = await preparePasswordReset({
      email: storedUser.email,
      userModel
    });

    await assertRejectedWith(
      () =>
        completePasswordReset({
          token: prepared.resetToken,
          newPassword: password,
          userModel
        }),
      PASSWORD_RESET_ERROR_CODES.INVALID_PASSWORD
    );

    assert.equal(
      userModel.getDocument(storedUser._id).password,
      storedUser.password
    );
  }
});
