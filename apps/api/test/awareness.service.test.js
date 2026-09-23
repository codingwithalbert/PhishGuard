const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AWARENESS_TOTAL_QUESTIONS,
  getAwarenessQuestions,
  getAwarenessQuestionIds,
  scoreAwarenessAnswers
} = require("../src/services/awareness.service");

const correctAnswers = [
  "B",
  "C",
  "D",
  "A",
  "B",
  "A",
  "C",
  "B",
  "D",
  "A"
];

function makeAnswers(correctCount = correctAnswers.length) {
  const answers = correctAnswers.map((selectedAnswer, index) => ({
    questionId: index + 1,
    selectedAnswer
  }));

  for (let index = correctCount; index < answers.length; index += 1) {
    answers[index].selectedAnswer =
      answers[index].selectedAnswer === "A" ? "B" : "A";
  }

  return answers;
}

test("returns ten sanitized public questions", () => {
  const questions = getAwarenessQuestions();

  assert.equal(AWARENESS_TOTAL_QUESTIONS, 10);
  assert.equal(questions.length, 10);
  assert.deepEqual(getAwarenessQuestionIds(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  for (const question of questions) {
    assert.equal(typeof question.text, "string");
    assert.equal(question.choices.length, 4);
    assert.deepEqual(
      question.choices.map(({ value }) => value),
      ["A", "B", "C", "D"]
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(question, "correctAnswer"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(question, "answerKey"),
      false
    );
  }

  const serializedQuestions = JSON.stringify(questions);

  assert.equal(serializedQuestions.includes("correctAnswer"), false);
  assert.equal(serializedQuestions.includes("answerKey"), false);
  assert.equal(serializedQuestions.includes("rawScore"), false);
  assert.equal(serializedQuestions.includes("score"), false);
});

test("calculates a perfect Awareness Score", () => {
  assert.deepEqual(scoreAwarenessAnswers(makeAnswers()), {
    rawScore: 10,
    score: 100,
    totalQuestions: 10
  });
});

test("calculates the approved partial scores", () => {
  assert.deepEqual(scoreAwarenessAnswers(makeAnswers(8)), {
    rawScore: 8,
    score: 80,
    totalQuestions: 10
  });

  assert.deepEqual(scoreAwarenessAnswers(makeAnswers(5)), {
    rawScore: 5,
    score: 50,
    totalQuestions: 10
  });

  assert.deepEqual(scoreAwarenessAnswers(makeAnswers(0)), {
    rawScore: 0,
    score: 0,
    totalQuestions: 10
  });
});

test("scores answers independently of submission order", () => {
  const answers = makeAnswers(8).reverse();

  assert.deepEqual(scoreAwarenessAnswers(answers), {
    rawScore: 8,
    score: 80,
    totalQuestions: 10
  });
});

test("does not produce interpretation categories", () => {
  const result = scoreAwarenessAnswers(makeAnswers());

  assert.deepEqual(Object.keys(result).sort(), [
    "rawScore",
    "score",
    "totalQuestions"
  ]);
});
