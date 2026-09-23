const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateAnalyzeRequest,
  validateAwarenessSubmission
} = require("../src/middleware/validate.middleware");

function runMiddleware(body, middleware = validateAnalyzeRequest) {
  const req = {
    body: body
  };

  let response;

  const res = {
    status(code) {
      return {
        json(data) {
          response = {
            status: code,
            data: data
          };
        }
      };
    }
  };

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  middleware(req, res, next);

  return {
    req,
    response,
    nextCalled
  };
}

const correctAwarenessAnswers = [
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

function makeValidAwarenessAnswers() {
  return correctAwarenessAnswers.map((selectedAnswer, index) => ({
    questionId: index + 1,
    selectedAnswer
  }));
}

function runAwarenessMiddleware(body) {
  return runMiddleware(body, validateAwarenessSubmission);
}

function assertAwarenessValidationFails(body) {
  const result = runAwarenessMiddleware(body);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.success, false);
}

test("rejects a missing URL", () => {
  const result = runMiddleware({});

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL is required");
});

test("rejects a non-string URL", () => {
  const result = runMiddleware({
    url: 12345
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL must be a string");
});

test("rejects an empty URL", () => {
  const result = runMiddleware({
    url: "   "
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "URL cannot be empty");
});

test("rejects an invalid URL", () => {
  const result = runMiddleware({
    url: "not-a-real-url"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.data.error, "Invalid URL");
});

test("rejects unsupported URL protocols", () => {
  const result = runMiddleware({
    url: "ftp://example.com/file"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.equal(
    result.response.data.error,
    "URL must use HTTP or HTTPS"
  );
});

test("accepts a valid HTTPS URL", () => {
  const result = runMiddleware({
    url: "  https://example.com/login  "
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, undefined);
  assert.equal(result.req.body.url, "https://example.com/login");
});

test("awareness validation rejects a missing answers field", () => {
  assertAwarenessValidationFails({});
});

test("awareness validation rejects non-object and non-array bodies", () => {
  assertAwarenessValidationFails(null);
  assertAwarenessValidationFails([]);
  assertAwarenessValidationFails({ answers: "not-an-array" });
});

test("awareness validation rejects fewer or more than 10 answers", () => {
  const answers = makeValidAwarenessAnswers();

  assertAwarenessValidationFails({ answers: answers.slice(0, 9) });
  assertAwarenessValidationFails({
    answers: [...answers, { questionId: 11, selectedAnswer: "A" }]
  });
});

test("awareness validation rejects missing, non-integer, and unknown question IDs", () => {
  const missingQuestionId = makeValidAwarenessAnswers();
  delete missingQuestionId[0].questionId;
  assertAwarenessValidationFails({ answers: missingQuestionId });

  const stringQuestionId = makeValidAwarenessAnswers();
  stringQuestionId[0].questionId = "1";
  assertAwarenessValidationFails({ answers: stringQuestionId });

  const decimalQuestionId = makeValidAwarenessAnswers();
  decimalQuestionId[0].questionId = 1.5;
  assertAwarenessValidationFails({ answers: decimalQuestionId });

  const unknownQuestionId = makeValidAwarenessAnswers();
  unknownQuestionId[0].questionId = 11;
  assertAwarenessValidationFails({ answers: unknownQuestionId });
});

test("awareness validation rejects duplicate question IDs", () => {
  const answers = makeValidAwarenessAnswers();

  answers[1].questionId = answers[0].questionId;

  assertAwarenessValidationFails({ answers });
});

test("awareness validation rejects missing or invalid selected answers", () => {
  const missingSelectedAnswer = makeValidAwarenessAnswers();
  delete missingSelectedAnswer[0].selectedAnswer;
  assertAwarenessValidationFails({ answers: missingSelectedAnswer });

  const nonStringSelectedAnswer = makeValidAwarenessAnswers();
  nonStringSelectedAnswer[0].selectedAnswer = 1;
  assertAwarenessValidationFails({ answers: nonStringSelectedAnswer });

  const lowercaseSelectedAnswer = makeValidAwarenessAnswers();
  lowercaseSelectedAnswer[0].selectedAnswer = "b";
  assertAwarenessValidationFails({ answers: lowercaseSelectedAnswer });

  const unknownSelectedAnswer = makeValidAwarenessAnswers();
  unknownSelectedAnswer[0].selectedAnswer = "E";
  assertAwarenessValidationFails({ answers: unknownSelectedAnswer });
});

test("awareness validation rejects extra answer fields", () => {
  const answers = makeValidAwarenessAnswers();

  answers[0].correctAnswer = "B";

  assertAwarenessValidationFails({ answers });
});

test("awareness validation rejects server-owned top-level fields", () => {
  const serverOwnedFields = [
    "user",
    "rawScore",
    "score",
    "totalQuestions",
    "completedAt",
    "createdAt"
  ];

  for (const field of serverOwnedFields) {
    const body = {
      answers: makeValidAwarenessAnswers()
    };

    body[field] = "client-controlled";

    assertAwarenessValidationFails(body);
  }
});

test("awareness validation accepts a shuffled complete submission", () => {
  const answers = makeValidAwarenessAnswers().reverse();
  const result = runAwarenessMiddleware({ answers });

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, undefined);
  assert.deepEqual(result.req.body.answers, answers);
});
