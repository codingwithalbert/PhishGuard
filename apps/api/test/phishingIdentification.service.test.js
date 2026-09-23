const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../src/services/phishingIdentification.service");
const {
  PHISHING_IDENTIFICATION_TOTAL_SCENARIOS,
  getPhishingIdentificationScenarios,
  getPhishingIdentificationScenarioIds,
  getValidSelectedAnswers,
  scorePhishingIdentificationAnswers
} = service;

const correctAnswers = [
  "B",
  "C",
  "A",
  "D",
  "B",
  "A",
  "C",
  "B",
  "D",
  "A"
];

function makeAnswers(correctCount = correctAnswers.length) {
  const answers = correctAnswers.map((selectedAnswer, index) => ({
    scenarioId: index + 1,
    selectedAnswer
  }));

  for (let index = correctCount; index < answers.length; index += 1) {
    answers[index].selectedAnswer =
      answers[index].selectedAnswer === "A" ? "B" : "A";
  }

  return answers;
}

test("uses the exact Phishing Identification collection name", () => {
  const Assessment = require("../src/models/PhishingIdentificationAssessment");

  assert.equal(
    Assessment.collection.collectionName,
    "phishingIdentificationAssessments"
  );
});

test("returns ten sanitized public scenarios", () => {
  const scenarios = getPhishingIdentificationScenarios();

  assert.equal(PHISHING_IDENTIFICATION_TOTAL_SCENARIOS, 10);
  assert.equal(scenarios.length, 10);
  assert.deepEqual(getPhishingIdentificationScenarioIds(), [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10
  ]);
  assert.deepEqual(getValidSelectedAnswers(), ["A", "B", "C", "D"]);

  for (const scenario of scenarios) {
    assert.deepEqual(Object.keys(scenario).sort(), [
      "choices",
      "question",
      "scenario",
      "scenarioId"
    ]);
    assert.equal(scenario.choices.length, 4);

    for (const choice of scenario.choices) {
      assert.deepEqual(Object.keys(choice).sort(), ["text", "value"]);
    }
  }

  assert.equal(
    scenarios[0].scenario,
    "You receive an email that appears to be from your school's IT department. The display name says \"Campus IT Support,\" but the sender address is `support@campus-security-help.example`."
  );

  const serializedScenarios = JSON.stringify(scenarios);

  assert.equal(serializedScenarios.includes("correctAnswer"), false);
  assert.equal(serializedScenarios.includes("answerKey"), false);
  assert.equal(serializedScenarios.includes("correctness"), false);
  assert.equal(serializedScenarios.includes("rawScore"), false);
  assert.equal(serializedScenarios.includes("score"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      service,
      "PHISHING_IDENTIFICATION_ANSWER_KEY"
    ),
    false
  );
});

test("calculates a perfect Phishing Identification Score", () => {
  assert.deepEqual(scorePhishingIdentificationAnswers(makeAnswers()), {
    rawScore: 10,
    score: 100,
    totalScenarios: 10
  });
});

test("calculates the approved partial scores", () => {
  assert.deepEqual(scorePhishingIdentificationAnswers(makeAnswers(8)), {
    rawScore: 8,
    score: 80,
    totalScenarios: 10
  });

  assert.deepEqual(scorePhishingIdentificationAnswers(makeAnswers(5)), {
    rawScore: 5,
    score: 50,
    totalScenarios: 10
  });

  assert.deepEqual(scorePhishingIdentificationAnswers(makeAnswers(0)), {
    rawScore: 0,
    score: 0,
    totalScenarios: 10
  });
});

test("scores answers independently of submission order", () => {
  const answers = makeAnswers(8).reverse();

  assert.deepEqual(scorePhishingIdentificationAnswers(answers), {
    rawScore: 8,
    score: 80,
    totalScenarios: 10
  });
});

test("does not produce interpretation categories", () => {
  const result = scorePhishingIdentificationAnswers(makeAnswers());

  assert.deepEqual(Object.keys(result).sort(), [
    "rawScore",
    "score",
    "totalScenarios"
  ]);
});
