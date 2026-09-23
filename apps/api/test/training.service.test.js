const test = require("node:test");
const assert = require("node:assert/strict");

const TrainingCompletion = require("../src/models/TrainingCompletion");
const {
  TRAINING_TOTAL_MODULES,
  calculateTrainingExposure,
  getTrainingCatalog,
  getTrainingModuleIds
} = require("../src/services/training.service");

test("uses the exact Training Exposure collection and unique index", () => {
  assert.equal(
    TrainingCompletion.collection.collectionName,
    "trainingCompletions"
  );

  const uniqueUserModuleIndex = TrainingCompletion.schema
    .indexes()
    .find(
      ([fields, options]) =>
        fields.user === 1 &&
        fields.moduleId === 1 &&
        options.unique === true
    );

  assert.ok(uniqueUserModuleIndex);
});

test("returns the exact three sanitized public modules", () => {
  const modules = getTrainingCatalog();

  assert.equal(TRAINING_TOTAL_MODULES, 3);
  assert.equal(modules.length, 3);
  assert.deepEqual(getTrainingModuleIds(), [1, 2, 3]);
  assert.deepEqual(
    modules.map(({ moduleId }) => moduleId),
    [1, 2, 3]
  );
  assert.deepEqual(
    modules.map(({ title }) => title),
    [
      "Recognizing Phishing Indicators",
      "Password and MFA Security",
      "Safe Handling and Reporting"
    ]
  );
  assert.deepEqual(
    modules.map(({ learningObjective }) => learningObjective),
    [
      "Help users recognize common warning signs associated with phishing messages.",
      "Help users understand basic account-protection practices.",
      "Help users respond safely when they encounter suspicious cybersecurity activity."
    ]
  );

  for (const module of modules) {
    assert.deepEqual(Object.keys(module).sort(), [
      "content",
      "learningObjective",
      "moduleId",
      "title"
    ]);
    assert.ok(Array.isArray(module.content));
    assert.ok(module.content.length > 0);

    for (const section of module.content) {
      assert.deepEqual(Object.keys(section).sort(), ["heading", "points"]);
      assert.equal(typeof section.heading, "string");
      assert.ok(Array.isArray(section.points));
      assert.ok(section.points.length > 0);
      assert.ok(
        section.points.every((point) => typeof point === "string")
      );
    }
  }

  const serializedModules = JSON.stringify(modules);

  assert.equal(serializedModules.includes("trainingExposure"), false);
  assert.equal(serializedModules.includes("completedModules"), false);
  assert.equal(serializedModules.includes("totalModules"), false);
  assert.equal(serializedModules.includes("completedAt"), false);
  assert.equal(serializedModules.includes('"user":'), false);
});

test("calculates the exact V1 exposure values", () => {
  assert.equal(calculateTrainingExposure(0), 0);
  assert.equal(calculateTrainingExposure(1), 33.33);
  assert.equal(calculateTrainingExposure(2), 66.67);
  assert.equal(calculateTrainingExposure(3), 100);
});

test("does not store progress or exposure fields on completions", () => {
  const schemaPaths = Object.keys(TrainingCompletion.schema.paths);

  assert.equal(schemaPaths.includes("trainingExposure"), false);
  assert.equal(schemaPaths.includes("completedModules"), false);
  assert.equal(schemaPaths.includes("totalModules"), false);
  assert.equal(schemaPaths.includes("userId"), false);
  assert.equal(schemaPaths.includes("password"), false);
  assert.equal(schemaPaths.includes("mfaCode"), false);
});
