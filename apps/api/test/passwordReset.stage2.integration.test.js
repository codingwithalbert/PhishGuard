const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const integrationEnabled =
  process.env.PASSWORD_RESET_INTEGRATION === "1";

if (!integrationEnabled) {
  test(
    "Password Reset Stage 2 MongoDB integration verification is opt-in",
    { skip: true },
    () => {}
  );
} else {
  require("dotenv").config({ quiet: true });

  const crypto = require("node:crypto");
  const mongoose = require("mongoose");
  const bcrypt = require("bcrypt");

  // Prevent model initialization from creating or changing indexes. This test
  // only uses the existing users collection and cleans up its own documents.
  mongoose.set("autoIndex", false);

  const User = require("../src/models/User");
  const {
    PASSWORD_HASH_COST,
    PASSWORD_RESET_ERROR_CODES,
    PasswordResetServiceError,
    clearPasswordResetStateIfCurrent,
    completePasswordReset,
    preparePasswordReset
  } = require("../src/services/passwordReset.service");
  const {
    RESET_TOKEN_TTL_MS,
    hashResetToken
  } = require("../src/services/passwordResetToken.service");

  const runMarker = crypto.randomUUID();
  const trackedUserIds = [];
  const OLD_PASSWORD = crypto.randomBytes(24).toString("hex");
  const NEW_PASSWORD = crypto.randomBytes(24).toString("hex");
  const PROTECTED_FIELDS = [
    "passwordResetTokenHash",
    "passwordResetExpiresAt"
  ];

  let connectionOpened = false;

  function testEmail(label) {
    return `password-reset-stage2-${runMarker}-${label}@example.invalid`;
  }

  async function createTrackedUser({
    name,
    email,
    role = "user",
    isActive = true
  }) {
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(OLD_PASSWORD, PASSWORD_HASH_COST),
      role,
      isActive
    });

    trackedUserIds.push(user._id);

    return user;
  }

  function readDefaultUser(userId) {
    return User.findById(userId).lean();
  }

  function readUserWithProtectedState(userId) {
    return User.findById(userId)
      .select(
        "+password +passwordResetTokenHash +passwordResetExpiresAt"
      )
      .lean();
  }

  async function assertRejectedWith(operation, code) {
    let captured = null;

    try {
      await operation();
    } catch (error) {
      captured = error;
    }

    assert.ok(captured, "Expected the operation to be rejected");
    assert.ok(captured instanceof PasswordResetServiceError);
    assert.equal(captured.code, code);

    return captured;
  }

  before(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not configured");
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        autoIndex: false
      });
    } catch {
      throw new Error("MongoDB integration connection failed");
    }

    connectionOpened = true;
  });

  after(async () => {
    const cleanupErrors = [];

    if (trackedUserIds.length > 0) {
      try {
        await User.deleteMany({ _id: { $in: trackedUserIds } });
      } catch (error) {
        cleanupErrors.push(`User cleanup: ${error.message}`);
      }
    }

    if (connectionOpened && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `Tracked Stage 2 integration-test cleanup failed: ${cleanupErrors.join(
          "; "
        )}`
      );
    }
  });

  test(
    "Password Reset Stage 2 works against real MongoDB and Mongoose behavior",
    async (t) => {
      await t.test(
        "existing-account preparation persists only the hash and expiration",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Integration User",
            email: testEmail("prepare")
          });

          const now = new Date();
          const prepared = await preparePasswordReset({
            email: `  ${user.email.toUpperCase()}  `
          });

          assert.ok(prepared);
          assert.equal(String(prepared.userId), String(user._id));
          assert.equal(prepared.email, user.email);
          assert.equal(
            prepared.resetTokenHash,
            hashResetToken(prepared.resetToken)
          );

          const stored = await readUserWithProtectedState(user._id);

          assert.equal(
            stored.passwordResetTokenHash,
            prepared.resetTokenHash
          );
          assert.ok(stored.passwordResetExpiresAt instanceof Date);
          assert.ok(
            stored.passwordResetExpiresAt.getTime() -
              now.getTime() >
              RESET_TOKEN_TTL_MS - 60000
          );
          assert.ok(
            stored.passwordResetExpiresAt.getTime() -
              now.getTime() <=
              RESET_TOKEN_TTL_MS + 60000
          );
          assert.equal(
            JSON.stringify(stored).includes(prepared.resetToken),
            false
          );
          assert.equal(
            await bcrypt.compare(
              OLD_PASSWORD,
              stored.password
            ),
            true
          );
        }
      );

      await t.test(
        "default queries never expose protected reset state",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Projection User",
            email: testEmail("projection")
          });

          await preparePasswordReset({ email: user.email });

          const projected = await readDefaultUser(user._id);

          for (const field of PROTECTED_FIELDS) {
            assert.equal(
              Object.prototype.hasOwnProperty.call(projected, field),
              false
            );
          }

          assert.equal("password" in projected, false);
        }
      );

      await t.test(
        "a nonexistent account creates no reset state",
        async () => {
          const email = testEmail("missing");

          const prepared = await preparePasswordReset({ email });

          assert.equal(prepared, null);
          assert.equal(
            await User.countDocuments({ email }),
            0
          );
        }
      );

      await t.test(
        "a newer reset request supersedes the previous token",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Supersede User",
            email: testEmail("supersede")
          });

          const older = await preparePasswordReset({
            email: user.email
          });
          const newer = await preparePasswordReset({
            email: user.email
          });

          const stored = await readUserWithProtectedState(user._id);

          assert.equal(
            stored.passwordResetTokenHash,
            newer.resetTokenHash
          );

          await assertRejectedWith(
            () =>
              completePasswordReset({
                token: older.resetToken,
                newPassword: NEW_PASSWORD
              }),
            PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
          );

          const completed = await completePasswordReset({
            token: newer.resetToken,
            newPassword: NEW_PASSWORD
          });

          assert.equal(
            String(completed.userId),
            String(user._id)
          );
        }
      );

      await t.test(
        "conditional cleanup clears only its own request's state",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Cleanup User",
            email: testEmail("cleanup")
          });

          const older = await preparePasswordReset({
            email: user.email
          });
          const newer = await preparePasswordReset({
            email: user.email
          });

          const clearedOlder =
            await clearPasswordResetStateIfCurrent({
              userId: older.userId,
              resetTokenHash: older.resetTokenHash
            });

          assert.equal(clearedOlder, false);

          const afterOlderCleanup =
            await readUserWithProtectedState(user._id);

          assert.equal(
            afterOlderCleanup.passwordResetTokenHash,
            newer.resetTokenHash
          );

          const clearedNewer =
            await clearPasswordResetStateIfCurrent({
              userId: newer.userId,
              resetTokenHash: newer.resetTokenHash
            });

          assert.equal(clearedNewer, true);

          const afterNewerCleanup =
            await readUserWithProtectedState(user._id);

          assert.equal(
            afterNewerCleanup.passwordResetTokenHash,
            null
          );
          assert.equal(
            afterNewerCleanup.passwordResetExpiresAt,
            null
          );
        }
      );

      await t.test(
        "a valid token resets the password, clears state, and cannot be reused",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Completion User",
            email: testEmail("completion"),
            role: "staff"
          });

          const prepared = await preparePasswordReset({
            email: user.email
          });

          const completed = await completePasswordReset({
            token: prepared.resetToken,
            newPassword: NEW_PASSWORD
          });

          assert.deepEqual(Object.keys(completed), ["userId"]);

          const stored = await readUserWithProtectedState(user._id);

          assert.equal(
            await bcrypt.compare(NEW_PASSWORD, stored.password),
            true
          );
          assert.equal(
            await bcrypt.compare(OLD_PASSWORD, stored.password),
            false
          );
          assert.equal(
            bcrypt.getRounds(stored.password),
            PASSWORD_HASH_COST
          );
          assert.equal(stored.passwordResetTokenHash, null);
          assert.equal(stored.passwordResetExpiresAt, null);
          assert.equal(stored.role, "staff");
          assert.equal(stored.isActive, true);

          await assertRejectedWith(
            () =>
              completePasswordReset({
                token: prepared.resetToken,
                newPassword: `${NEW_PASSWORD}-again`
              }),
            PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
          );

          const afterReuse =
            await readUserWithProtectedState(user._id);

          assert.equal(
            await bcrypt.compare(
              NEW_PASSWORD,
              afterReuse.password
            ),
            true
          );
          assert.equal(
            await bcrypt.compare(
              `${NEW_PASSWORD}-again`,
              afterReuse.password
            ),
            false
          );
        }
      );

      await t.test(
        "expired and unknown tokens are rejected safely",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Expired User",
            email: testEmail("expired")
          });

          const prepared = await preparePasswordReset({
            email: user.email
          });

          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                passwordResetExpiresAt: new Date(
                  Date.now() - 60000
                )
              }
            }
          );

          await assertRejectedWith(
            () =>
              completePasswordReset({
                token: prepared.resetToken,
                newPassword: NEW_PASSWORD
              }),
            PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
          );

          await assertRejectedWith(
            () =>
              completePasswordReset({
                token: crypto.randomBytes(32).toString("hex"),
                newPassword: NEW_PASSWORD
              }),
            PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
          );

          const stored = await readUserWithProtectedState(user._id);

          assert.equal(
            await bcrypt.compare(OLD_PASSWORD, stored.password),
            true
          );
          assert.equal(
            await bcrypt.compare(NEW_PASSWORD, stored.password),
            false
          );
        }
      );

      await t.test(
        "competing completion attempts cannot both consume the token",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Competing User",
            email: testEmail("competing")
          });

          const prepared = await preparePasswordReset({
            email: user.email
          });

          const firstPassword = `${NEW_PASSWORD}-first`;
          const secondPassword = `${NEW_PASSWORD}-second`;

          const outcomes = await Promise.allSettled([
            completePasswordReset({
              token: prepared.resetToken,
              newPassword: firstPassword
            }),
            completePasswordReset({
              token: prepared.resetToken,
              newPassword: secondPassword
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
          assert.ok(
            rejected[0].reason instanceof PasswordResetServiceError
          );
          assert.equal(
            rejected[0].reason.code,
            PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN
          );

          const stored = await readUserWithProtectedState(user._id);
          const matches = await Promise.all([
            bcrypt.compare(firstPassword, stored.password),
            bcrypt.compare(secondPassword, stored.password)
          ]);

          assert.equal(
            matches.filter(Boolean).length,
            1
          );
          assert.equal(stored.passwordResetTokenHash, null);
          assert.equal(stored.passwordResetExpiresAt, null);
        }
      );

      await t.test(
        "an inactive account is not reactivated by a reset",
        async () => {
          const user = await createTrackedUser({
            name: "Stage Two Inactive User",
            email: testEmail("inactive"),
            role: "staff",
            isActive: false
          });

          const prepared = await preparePasswordReset({
            email: user.email
          });

          assert.ok(prepared);

          await completePasswordReset({
            token: prepared.resetToken,
            newPassword: NEW_PASSWORD
          });

          const stored = await readUserWithProtectedState(user._id);

          assert.equal(stored.isActive, false);
          assert.equal(stored.role, "staff");
          assert.equal(
            await bcrypt.compare(NEW_PASSWORD, stored.password),
            true
          );
        }
      );
    }
  );
}
