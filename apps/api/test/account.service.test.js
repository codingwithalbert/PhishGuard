const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const {
  ACCOUNT_ERROR_CODES,
  AccountServiceError,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH,
  changeOwnPassword,
  updateOwnProfileName
} = require("../src/services/account.service");
const {
  PASSWORD_HASH_COST,
  PASSWORD_POLICY
} = require("../src/services/passwordReset.service");

const CURRENT_PASSWORD = "current-Password-1";
const NEW_PASSWORD = "new-Password-2";
const RESET_TOKEN_HASH = "stored-reset-token-hash";

// Minimal in-memory stand-in for the User model. It records every write so the
// tests can prove what was and was not persisted, and it evaluates every
// condition in an update filter so a conditional write behaves like MongoDB.
function valuesMatch(storedValue, expectedValue) {
  if (storedValue === null || storedValue === undefined) {
    return storedValue === expectedValue;
  }

  if (
    typeof storedValue === "object" &&
    typeof expectedValue === "object"
  ) {
    return String(storedValue) === String(expectedValue);
  }

  return storedValue === expectedValue;
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([field, condition]) =>
    valuesMatch(document[field], condition)
  );
}

function createFakeUserModel(documents = []) {
  const stored = new Map();
  const updates = [];

  for (const document of documents) {
    stored.set(String(document._id), { ...document });
  }

  const model = {
    updates,

    getDocument(id) {
      return stored.get(String(id)) || null;
    },

    findById(id) {
      const document = stored.get(String(id)) || null;

      return {
        select() {
          return this;
        },

        then(onFulfilled, onRejected) {
          return Promise.resolve(document).then(onFulfilled, onRejected);
        }
      };
    },

    async updateOne(filter, update) {
      // Every filter condition is evaluated, so an account that stopped being
      // active before this call is not written to.
      const document =
        [...stored.values()].find((candidate) =>
          matchesFilter(candidate, filter)
        ) || null;

      updates.push({
        filter: { ...filter },
        update,
        matchedCount: document ? 1 : 0
      });

      if (document) {
        for (const [field, value] of Object.entries(update.$set)) {
          document[field] = value;
        }
      }

      return {
        acknowledged: true,
        matchedCount: document ? 1 : 0,
        modifiedCount: document ? 1 : 0
      };
    }
  };

  return model;
}

async function createHarness({
  role = "user",
  isActive = true,
  includeHash = true,
  password = CURRENT_PASSWORD,
  resetTokenHash = RESET_TOKEN_HASH,
  resetExpiresAt = new Date("2026-04-01T00:00:00.000Z")
} = {}) {
  const userId = new mongoose.Types.ObjectId();
  const passwordHash = includeHash
    ? await bcrypt.hash(password, PASSWORD_HASH_COST)
    : undefined;

  const storedUser = {
    _id: userId,
    name: "Original Name",
    email: "account.owner@example.invalid",
    password: passwordHash,
    role,
    isActive,
    passwordResetTokenHash: resetTokenHash,
    passwordResetExpiresAt: resetExpiresAt,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };

  const userModel = createFakeUserModel([storedUser]);

  return { userId, userModel, storedUser };
}

async function assertRejectsWithCode(operation, code) {
  let captured = null;

  try {
    await operation();
  } catch (error) {
    captured = error;
  }

  assert.ok(
    captured instanceof AccountServiceError,
    `Expected an AccountServiceError, received ${captured?.name}`
  );
  assert.equal(captured.code, code);
  assert.equal(typeof captured.status, "number");
  assert.equal(
    captured.constructor,
    AccountServiceError,
    "Errors must use the service error convention"
  );

  return captured;
}

test("the service reuses the existing password policy constants", () => {
  assert.equal(PASSWORD_POLICY.minLength, 8);
  assert.equal(PASSWORD_POLICY.maxLength, 128);
  assert.equal(PASSWORD_HASH_COST, 12);
  assert.equal(PROFILE_NAME_MIN_LENGTH, 2);
  assert.equal(PROFILE_NAME_MAX_LENGTH, 50);
});

test("profile validation accepts exactly { name } and trims it", async () => {
  const { userId, userModel } = await createHarness();

  const profile = await updateOwnProfileName({
    userId,
    name: "  Renamed Account  ",
    userModel
  });

  assert.deepEqual(profile, {
    id: userId,
    name: "Renamed Account",
    email: "account.owner@example.invalid",
    role: "user"
  });
  assert.equal(
    userModel.getDocument(userId).name,
    "Renamed Account"
  );
});

test("a successful profile update writes only the name", async () => {
  const { userId, userModel, storedUser } = await createHarness();

  await updateOwnProfileName({
    userId,
    name: "Only Name Changes",
    userModel
  });

  assert.equal(userModel.updates.length, 1);
  assert.deepEqual(userModel.updates[0].filter, {
    _id: userId,
    isActive: true
  });
  assert.deepEqual(userModel.updates[0].update, {
    $set: { name: "Only Name Changes" }
  });
  assert.deepEqual(
    Object.keys(userModel.updates[0].update.$set),
    ["name"]
  );

  const persisted = userModel.getDocument(userId);

  assert.equal(persisted.email, storedUser.email);
  assert.equal(persisted.role, storedUser.role);
  assert.equal(persisted.isActive, storedUser.isActive);
  assert.equal(persisted.password, storedUser.password);
  assert.equal(
    persisted.passwordResetTokenHash,
    storedUser.passwordResetTokenHash
  );
  assert.equal(
    persisted.passwordResetExpiresAt,
    storedUser.passwordResetExpiresAt
  );
});

test("the safe profile result contains only id, name, email, and role", async () => {
  const { userId, userModel } = await createHarness();

  const profile = await updateOwnProfileName({
    userId,
    name: "Safe Shape",
    userModel
  });

  assert.deepEqual(Object.keys(profile).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);

  const serialized = JSON.stringify(profile);

  for (const forbidden of [
    "password",
    "passwordReset",
    "isActive",
    "createdAt",
    "updatedAt",
    "currentPassword",
    "newPassword"
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Safe profile must not expose ${forbidden}`
    );
  }
});

test("name boundaries are enforced at 2 and 50 characters", async () => {
  for (const name of [
    "ab",
    "a".repeat(PROFILE_NAME_MAX_LENGTH)
  ]) {
    const { userId, userModel } = await createHarness();

    const profile = await updateOwnProfileName({
      userId,
      name,
      userModel
    });

    assert.equal(profile.name, name);
  }
});

test("names below or above the boundaries are rejected", async () => {
  for (const name of [
    "a",
    "",
    "   ",
    "a".repeat(PROFILE_NAME_MAX_LENGTH + 1)
  ]) {
    const { userId, userModel } = await createHarness();

    const error = await assertRejectsWithCode(
      () =>
        updateOwnProfileName({
          userId,
          name,
          userModel
        }),
      ACCOUNT_ERROR_CODES.INVALID_NAME
    );

    assert.equal(error.status, 400);
    assert.equal(userModel.updates.length, 0);
    assert.equal(
      userModel.getDocument(userId).name,
      "Original Name"
    );
  }
});

test("a non-string name is rejected without a write", async () => {
  for (const name of [null, undefined, 42, {}, ["Name"], true]) {
    const { userId, userModel } = await createHarness();

    await assertRejectsWithCode(
      () =>
        updateOwnProfileName({
          userId,
          name,
          userModel
        }),
      ACCOUNT_ERROR_CODES.INVALID_NAME
    );

    assert.equal(userModel.updates.length, 0);
  }
});

test("a missing or inactive account is reported as not found", async () => {
  const missing = createFakeUserModel([]);

  await assertRejectsWithCode(
    () =>
      updateOwnProfileName({
        userId: new mongoose.Types.ObjectId(),
        name: "Valid Name",
        userModel: missing
      }),
    ACCOUNT_ERROR_CODES.NOT_FOUND
  );
  assert.equal(missing.updates.length, 0);

  const { userId, userModel } = await createHarness({
    isActive: false
  });

  const error = await assertRejectsWithCode(
    () =>
      updateOwnProfileName({
        userId,
        name: "Valid Name",
        userModel
      }),
    ACCOUNT_ERROR_CODES.NOT_FOUND
  );

  assert.equal(error.status, 404);
  assert.equal(error.message, "Account not found");
  assert.equal(userModel.updates.length, 0);
});

test("a missing authenticated user id is refused", async () => {
  const { userModel } = await createHarness();

  for (const userId of [undefined, null, ""]) {
    await assertRejectsWithCode(
      () =>
        updateOwnProfileName({
          userId,
          name: "Valid Name",
          userModel
        }),
      ACCOUNT_ERROR_CODES.NOT_FOUND
    );

    await assertRejectsWithCode(
      () =>
        changeOwnPassword({
          userId,
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
          userModel
        }),
      ACCOUNT_ERROR_CODES.NOT_FOUND
    );
  }

  assert.equal(userModel.updates.length, 0);
});

test("every authenticated role may update only its own account", async () => {
  for (const role of ["user", "staff", "admin"]) {
    const owner = await createHarness({ role });
    const other = await createHarness({ role });

    // Both accounts share one store so a cross-account write is observable.
    const sharedModel = createFakeUserModel([
      owner.storedUser,
      other.storedUser
    ]);

    const profile = await updateOwnProfileName({
      userId: owner.userId,
      name: "Owner Renamed",
      userModel: sharedModel
    });

    assert.equal(profile.role, role);
    assert.equal(
      sharedModel.getDocument(owner.userId).name,
      "Owner Renamed"
    );
    assert.equal(
      sharedModel.getDocument(other.userId).name,
      "Original Name"
    );

    // The service accepts only a user id, so a body or argument cannot
    // redirect the update at another account.
    for (const attempt of [
      { userId: owner.userId, name: "Owner Renamed", otherUserId: other.userId },
      { userId: owner.userId, name: "Owner Renamed", id: other.userId }
    ]) {
      await updateOwnProfileName({
        ...attempt,
        userModel: sharedModel
      });

      assert.equal(
        sharedModel.getDocument(other.userId).name,
        "Original Name"
      );
    }
  }
});

test("change-password validation rejects non-string or empty values", async () => {
  const { userId, userModel } = await createHarness();

  const cases = [
    {
      currentPassword: undefined,
      newPassword: NEW_PASSWORD,
      code: ACCOUNT_ERROR_CODES.INVALID_CURRENT_PASSWORD
    },
    {
      currentPassword: null,
      newPassword: NEW_PASSWORD,
      code: ACCOUNT_ERROR_CODES.INVALID_CURRENT_PASSWORD
    },
    {
      currentPassword: "",
      newPassword: NEW_PASSWORD,
      code: ACCOUNT_ERROR_CODES.INVALID_CURRENT_PASSWORD
    },
    {
      currentPassword: 12345678,
      newPassword: NEW_PASSWORD,
      code: ACCOUNT_ERROR_CODES.INVALID_CURRENT_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: undefined,
      code: ACCOUNT_ERROR_CODES.INVALID_NEW_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: "",
      code: ACCOUNT_ERROR_CODES.INVALID_NEW_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: 12345678,
      code: ACCOUNT_ERROR_CODES.INVALID_NEW_PASSWORD
    }
  ];

  for (const testCase of cases) {
    await assertRejectsWithCode(
      () =>
        changeOwnPassword({
          userId,
          ...testCase,
          userModel
        }),
      testCase.code
    );
  }

  assert.equal(userModel.updates.length, 0);
});

test("the 8 and 128 character password boundaries are accepted", async () => {
  for (const newPassword of [
    "a".repeat(PASSWORD_POLICY.minLength),
    "a".repeat(PASSWORD_POLICY.maxLength)
  ]) {
    const { userId, userModel } = await createHarness();

    const result = await changeOwnPassword({
      userId,
      currentPassword: CURRENT_PASSWORD,
      newPassword,
      userModel
    });

    assert.equal(result.userId, String(userId));
    assert.equal(
      await bcrypt.compare(
        newPassword,
        userModel.getDocument(userId).password
      ),
      true
    );
  }
});

test("passwords outside the policy are rejected without a write", async () => {
  for (const newPassword of [
    "a".repeat(PASSWORD_POLICY.minLength - 1),
    "a".repeat(PASSWORD_POLICY.maxLength + 1)
  ]) {
    const { userId, userModel } = await createHarness();

    const error = await assertRejectsWithCode(
      () =>
        changeOwnPassword({
          userId,
          currentPassword: CURRENT_PASSWORD,
          newPassword,
          userModel
        }),
      ACCOUNT_ERROR_CODES.INVALID_NEW_PASSWORD
    );

    assert.equal(error.status, 400);
    assert.equal(error.message, "Password must be between 8 and 128 characters");
    assert.equal(userModel.updates.length, 0);
  }
});

test("an incorrect current password is rejected safely", async () => {
  const { userId, userModel, storedUser } = await createHarness();

  const error = await assertRejectsWithCode(
    () =>
      changeOwnPassword({
        userId,
        currentPassword: "wrong-Password-9",
        newPassword: NEW_PASSWORD,
        userModel
      }),
    ACCOUNT_ERROR_CODES.INCORRECT_CURRENT_PASSWORD
  );

  assert.equal(error.status, 401);
  assert.equal(error.message, "Current password is incorrect");
  assert.equal(userModel.updates.length, 0);
  assert.equal(
    userModel.getDocument(userId).password,
    storedUser.password
  );
  assert.equal(
    userModel.getDocument(userId).passwordResetTokenHash,
    RESET_TOKEN_HASH
  );

  const serialized = JSON.stringify({
    ...error,
    message: error.message
  });

  for (const forbidden of [
    storedUser.password,
    "wrong-Password-9",
    NEW_PASSWORD,
    "$2",
    "cost"
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      "Password errors must not expose password or hash detail"
    );
  }
});

test("a new password identical to the current password is rejected", async () => {
  const { userId, userModel } = await createHarness();

  const error = await assertRejectsWithCode(
    () =>
      changeOwnPassword({
        userId,
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD,
        userModel
      }),
    ACCOUNT_ERROR_CODES.UNCHANGED_PASSWORD
  );

  assert.equal(error.status, 400);
  assert.equal(
    error.message,
    "New password must be different from the current password"
  );
  assert.equal(userModel.updates.length, 0);
});

test("a successful password change replaces the hash at the shared cost", async () => {
  const { userId, userModel, storedUser } = await createHarness();

  const result = await changeOwnPassword({
    userId,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    userModel
  });

  assert.deepEqual(Object.keys(result), ["userId"]);
  assert.equal(result.userId, String(userId));

  const persisted = userModel.getDocument(userId);

  assert.notEqual(persisted.password, storedUser.password);
  assert.equal(
    await bcrypt.compare(NEW_PASSWORD, persisted.password),
    true
  );
  assert.equal(
    await bcrypt.compare(CURRENT_PASSWORD, persisted.password),
    false
  );
  assert.equal(
    bcrypt.getRounds(persisted.password),
    PASSWORD_HASH_COST
  );
});

test("a successful password change clears outstanding reset state", async () => {
  const { userId, userModel } = await createHarness();

  await changeOwnPassword({
    userId,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    userModel
  });

  assert.equal(userModel.updates.length, 1);
  assert.deepEqual(userModel.updates[0].filter, {
    _id: userId,
    isActive: true
  });
  assert.deepEqual(userModel.updates[0].update, {
    $set: {
      password: userModel.getDocument(userId).password,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null
    }
  });

  const persisted = userModel.getDocument(userId);

  assert.equal(persisted.passwordResetTokenHash, null);
  assert.equal(persisted.passwordResetExpiresAt, null);
  assert.equal(persisted.email, "account.owner@example.invalid");
  assert.equal(persisted.role, "user");
  assert.equal(persisted.isActive, true);
});

test("a failed password change leaves reset state untouched", async () => {
  for (const attempt of [
    {
      currentPassword: "wrong-Password-9",
      newPassword: NEW_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: CURRENT_PASSWORD
    },
    {
      currentPassword: CURRENT_PASSWORD,
      newPassword: "short"
    }
  ]) {
    const { userId, userModel } = await createHarness();

    await assert.rejects(() =>
      changeOwnPassword({
        userId,
        ...attempt,
        userModel
      })
    );

    const persisted = userModel.getDocument(userId);

    assert.equal(userModel.updates.length, 0);
    assert.equal(persisted.passwordResetTokenHash, RESET_TOKEN_HASH);
    assert.ok(persisted.passwordResetExpiresAt instanceof Date);
  }
});

test("change-password results never contain password, hash, or reset state", async () => {
  const { userId, userModel, storedUser } = await createHarness();

  const result = await changeOwnPassword({
    userId,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    userModel
  });

  const serialized = JSON.stringify(result);

  for (const forbidden of [
    "password",
    "passwordReset",
    storedUser.password,
    userModel.getDocument(userId).password,
    NEW_PASSWORD,
    CURRENT_PASSWORD,
    "$2b$"
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Change-password result must not expose ${forbidden.slice(0, 12)}`
    );
  }
});

test("a profile update is not written when the account stops being active", async () => {
  const { userId, userModel } = await createHarness();
  const storedUser = userModel.getDocument(userId);

  // The account is active when it is read, and becomes inactive in the window
  // before the write filter is evaluated.
  const originalUpdateOne = userModel.updateOne.bind(userModel);

  userModel.updateOne = async (filter, update) => {
    storedUser.isActive = false;

    return originalUpdateOne(filter, update);
  };

  const error = await assertRejectsWithCode(
    () =>
      updateOwnProfileName({
        userId,
        name: "Should Not Persist",
        userModel
      }),
    ACCOUNT_ERROR_CODES.NOT_FOUND
  );

  assert.equal(error.status, 404);
  assert.equal(error.message, "Account not found");
  assert.equal(storedUser.name, "Original Name");
  assert.equal(userModel.updates.length, 1);
  assert.equal(userModel.updates[0].matchedCount, 0);
});

test("a password change is not written when the account stops being active", async () => {
  const { userId, userModel } = await createHarness();
  const storedUser = userModel.getDocument(userId);
  const originalPasswordHash = storedUser.password;
  const originalResetExpiresAt = storedUser.passwordResetExpiresAt;

  // The account is active while the current password is verified, and becomes
  // inactive in the window before the write filter is evaluated.
  const originalUpdateOne = userModel.updateOne.bind(userModel);

  userModel.updateOne = async (filter, update) => {
    storedUser.isActive = false;

    return originalUpdateOne(filter, update);
  };

  const error = await assertRejectsWithCode(
    () =>
      changeOwnPassword({
        userId,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        userModel
      }),
    ACCOUNT_ERROR_CODES.NOT_FOUND
  );

  assert.equal(error.status, 404);
  assert.equal(error.message, "Account not found");
  assert.equal(storedUser.password, originalPasswordHash);
  assert.equal(
    await bcrypt.compare(NEW_PASSWORD, storedUser.password),
    false
  );
  assert.equal(
    await bcrypt.compare(CURRENT_PASSWORD, storedUser.password),
    true
  );
  assert.equal(storedUser.passwordResetTokenHash, RESET_TOKEN_HASH);
  assert.equal(
    storedUser.passwordResetExpiresAt,
    originalResetExpiresAt
  );
  assert.equal(userModel.updates.length, 1);
  assert.equal(userModel.updates[0].matchedCount, 0);
  assertNoSensitiveData(
    JSON.stringify({ ...error, message: error.message })
  );

  function assertNoSensitiveData(text) {
    for (const forbidden of [
      originalPasswordHash,
      NEW_PASSWORD,
      "$2b$",
      "passwordReset"
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        "Race failure must not expose password or hash detail"
      );
    }
  }
});

test("a missing password hash is handled without leaking detail", async () => {
  const { userId, userModel } = await createHarness({
    includeHash: false
  });

  const error = await assertRejectsWithCode(
    () =>
      changeOwnPassword({
        userId,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        userModel
      }),
    ACCOUNT_ERROR_CODES.INVALID_STORED_PASSWORD
  );

  assert.equal(error.status, 500);
  assert.equal(
    error.message,
    "Account password state is unavailable"
  );
  assert.equal(
    error.message.includes(CURRENT_PASSWORD),
    false
  );
  assert.equal(userModel.updates.length, 0);
});

test("an inactive account cannot change its password", async () => {
  const { userId, userModel } = await createHarness({
    isActive: false
  });

  const error = await assertRejectsWithCode(
    () =>
      changeOwnPassword({
        userId,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        userModel
      }),
    ACCOUNT_ERROR_CODES.NOT_FOUND
  );

  assert.equal(error.status, 404);
  assert.equal(userModel.updates.length, 0);
});

test("change-password selects the password field explicitly", async () => {
  const selections = [];

  const userId = new mongoose.Types.ObjectId();
  const storedUser = {
    _id: userId,
    name: "Selection Check",
    email: "selection@example.invalid",
    password: await bcrypt.hash(CURRENT_PASSWORD, PASSWORD_HASH_COST),
    role: "user",
    isActive: true,
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null
  };

  const userModel = {
    findById(id) {
      const document = String(id) === String(userId) ? storedUser : null;

      return {
        select(fields) {
          selections.push(fields);
          return this;
        },

        then(onFulfilled, onRejected) {
          return Promise.resolve(document).then(onFulfilled, onRejected);
        }
      };
    },

    async updateOne() {
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }
  };

  await changeOwnPassword({
    userId,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    userModel
  });

  assert.deepEqual(selections, ["+password"]);
});
