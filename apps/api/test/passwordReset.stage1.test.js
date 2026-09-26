const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const User = require("../src/models/User");
const {
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MINUTES,
  RESET_TOKEN_TTL_MS,
  createResetTokenState,
  generateResetToken,
  getResetTokenExpiresAt,
  hashResetToken,
  isResetTokenExpired
} = require("../src/services/passwordResetToken.service");

const RESET_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const SERVICE_SOURCE_PATH = path.join(
  __dirname,
  "..",
  "src",
  "services",
  "passwordResetToken.service.js"
);

function createValidUserData(overrides = {}) {
  return {
    name: "Reset Stage User",
    email: "reset.stage.user@example.com",
    password: "hashed-password-placeholder",
    ...overrides
  };
}

test("generated reset tokens are nonempty and safe for URL transport", () => {
  const tokens = Array.from(
    { length: 50 },
    () => generateResetToken()
  );

  for (const token of tokens) {
    assert.equal(typeof token, "string");
    assert.ok(token.length > 0);
    assert.equal(RESET_TOKEN_PATTERN.test(token), true);
    assert.equal(
      Buffer.from(token, "hex").length,
      RESET_TOKEN_BYTES
    );
    assert.equal(encodeURIComponent(token), token);
    assert.equal(decodeURIComponent(token), token);
  }
});

test("separate generations produce different reset tokens", () => {
  const tokens = Array.from(
    { length: 200 },
    () => generateResetToken()
  );

  assert.equal(new Set(tokens).size, tokens.length);
  assert.equal(tokens.includes(tokens[0] + tokens[1]), false);
});

test("reset token hashing is deterministic for the same token", () => {
  const { rawToken } = createResetTokenState();

  const firstHash = hashResetToken(rawToken);
  const secondHash = hashResetToken(rawToken);

  assert.equal(firstHash, secondHash);
  assert.equal(
    firstHash,
    crypto
      .createHash("sha256")
      .update(rawToken, "utf8")
      .digest("hex")
  );
  assert.equal(
    hashResetToken("abc"),
    crypto
      .createHash("sha256")
      .update("abc", "utf8")
      .digest("hex")
  );
  assert.equal(RESET_TOKEN_PATTERN.test(firstHash), true);
});

test("different reset tokens produce different hashes", () => {
  const { rawToken: firstToken } = createResetTokenState();
  const { rawToken: secondToken } = createResetTokenState();

  assert.notEqual(firstToken, secondToken);
  assert.notEqual(
    hashResetToken(firstToken),
    hashResetToken(secondToken)
  );
});

test("the raw reset token differs from its stored hash representation", () => {
  const state = createResetTokenState();

  assert.equal(RESET_TOKEN_PATTERN.test(state.rawToken), true);
  assert.equal(RESET_TOKEN_PATTERN.test(state.tokenHash), true);
  assert.notEqual(state.tokenHash, state.rawToken);
  assert.equal(state.tokenHash.includes(state.rawToken), false);
  assert.equal(state.rawToken.includes(state.tokenHash), false);
  assert.equal(state.tokenHash.length, 64);
  assert.equal(state.rawToken.length, 64);
  assert.equal(
    state.tokenHash,
    hashResetToken(state.rawToken)
  );

  const persistedResetState = {
    passwordResetTokenHash: state.tokenHash,
    passwordResetExpiresAt: state.expiresAt
  };

  assert.equal(
    JSON.stringify(persistedResetState).includes(state.rawToken),
    false
  );
});

test("reset tokens expire after fifteen minutes", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");

  assert.equal(RESET_TOKEN_TTL_MINUTES, 15);
  assert.equal(RESET_TOKEN_TTL_MS, 15 * 60 * 1000);

  const { expiresAt } = createResetTokenState({ now: issuedAt });

  assert.ok(expiresAt instanceof Date);
  assert.equal(
    expiresAt.getTime() - issuedAt.getTime(),
    RESET_TOKEN_TTL_MS
  );
  assert.equal(
    expiresAt.toISOString(),
    "2026-01-01T00:15:00.000Z"
  );
  assert.equal(
    getResetTokenExpiresAt(issuedAt).getTime(),
    expiresAt.getTime()
  );

  assert.equal(
    isResetTokenExpired(
      expiresAt,
      new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS - 1000)
    ),
    false
  );
  assert.equal(
    isResetTokenExpired(expiresAt, expiresAt),
    true
  );
  assert.equal(
    isResetTokenExpired(
      expiresAt,
      new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS + 1)
    ),
    true
  );
  assert.equal(isResetTokenExpired(null, issuedAt), true);
});

test("reset token hashing rejects missing or malformed token input", () => {
  assert.throws(() => hashResetToken(""), TypeError);
  assert.throws(() => hashResetToken(null), TypeError);
  assert.throws(() => hashResetToken(undefined), TypeError);
  assert.throws(
    () => hashResetToken(1234567890),
    TypeError
  );
  assert.throws(
    () => getResetTokenExpiresAt("not-a-date"),
    TypeError
  );
});

test("the reset token service does not use insecure randomness", () => {
  const source = fs.readFileSync(
    SERVICE_SOURCE_PATH,
    "utf8"
  );

  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("randomBytes"), true);
  assert.equal(
    source.includes("jsonwebtoken"),
    false
  );
  assert.equal(source.includes("bcrypt"), false);
});

test("User password-reset fields default to null", async () => {
  const user = new User(createValidUserData());

  assert.equal(user.passwordResetTokenHash, null);
  assert.equal(user.passwordResetExpiresAt, null);
  await user.validate();
});

test("User password-reset fields are excluded from default queries", () => {
  assert.equal(User.collection.collectionName, "users");

  for (const field of [
    "passwordResetTokenHash",
    "passwordResetExpiresAt"
  ]) {
    assert.equal(
      User.schema.path(field).options.select,
      false,
      `${field} must not be returned by default queries`
    );
    assert.equal(User.schema.path(field).options.default, null);
  }
});

test("a User document stores only the reset hash, never the raw token", async () => {
  const { rawToken, tokenHash, expiresAt } =
    createResetTokenState();

  const user = new User(
    createValidUserData({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt
    })
  );

  await user.validate();

  const serialized = JSON.stringify(user.toObject());

  assert.equal(user.passwordResetTokenHash, tokenHash);
  assert.equal(user.passwordResetExpiresAt.getTime(), expiresAt.getTime());
  assert.equal(serialized.includes(rawToken), false);
  assert.equal(
    user.passwordResetTokenHash.includes(rawToken),
    false
  );
});

test("User reset state can be cleared back to null", async () => {
  const { tokenHash, expiresAt } = createResetTokenState();

  const user = new User(
    createValidUserData({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt
    })
  );

  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;

  await user.validate();

  assert.equal(user.passwordResetTokenHash, null);
  assert.equal(user.passwordResetExpiresAt, null);
});

test("Stage 1 does not change existing User auth fields or defaults", async () => {
  const user = new User(createValidUserData());

  assert.equal(user.role, "user");
  assert.equal(user.isActive, true);
  assert.equal(user.email, "reset.stage.user@example.com");
  assert.equal(user.name, "Reset Stage User");

  assert.equal(User.schema.path("role").options.default, "user");
  assert.deepEqual(User.schema.path("role").enumValues, [
    "admin",
    "staff",
    "user"
  ]);
  assert.equal(User.schema.path("isActive").options.default, true);
  assert.equal(User.schema.path("password").options.required, true);
  assert.equal(User.schema.path("password").options.select, false);
  assert.equal(User.schema.path("email").options.lowercase, true);
  assert.equal(User.schema.path("email").options.trim, true);
  assert.equal(User.schema.path("email").options.unique, true);
  assert.equal(User.schema.path("name").options.required, true);
  assert.equal(
    User.schema.path("name").options.minlength,
    2
  );
  assert.equal(
    User.schema.path("name").options.maxlength,
    50
  );
  assert.equal(User.schema.options.timestamps, true);

  const invalidRole = new User(
    createValidUserData({ role: "superadmin" })
  );

  await assert.rejects(
    () => invalidRole.validate(),
    (error) => {
      assert.ok(error.errors.role);
      return true;
    }
  );
});
