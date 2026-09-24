const AwarenessAssessment = require("../models/AwarenessAssessment");

const AWARENESS_TOTAL_QUESTIONS = 10;
const AWARENESS_HISTORY_LIMIT = 10;

const AWARENESS_QUESTIONS = [
  {
    questionId: 1,
    text: "Which password practice provides better account security?",
    choices: [
      {
        value: "A",
        text: "Using the same password for every account"
      },
      {
        value: "B",
        text: "Using a long, unique password for each important account"
      },
      {
        value: "C",
        text: "Sharing passwords with trusted friends"
      },
      {
        value: "D",
        text: "Using your birthday because it is easy to remember"
      }
    ]
  },
  {
    questionId: 2,
    text: "What is the main purpose of multi-factor authentication (MFA)?",
    choices: [
      {
        value: "A",
        text: "To make passwords shorter"
      },
      {
        value: "B",
        text: "To automatically change your username"
      },
      {
        value: "C",
        text: "To require an additional form of verification when signing in"
      },
      {
        value: "D",
        text: "To prevent websites from storing any information"
      }
    ]
  },
  {
    questionId: 3,
    text: "You receive an unexpected message asking you to log in immediately through a provided link. What is the safest response?",
    choices: [
      {
        value: "A",
        text: "Open the link because the message says it is urgent"
      },
      {
        value: "B",
        text: "Reply with your password to confirm your identity"
      },
      {
        value: "C",
        text: "Forward it to friends to ask whether it is legitimate"
      },
      {
        value: "D",
        text: "Avoid the link and verify the request through the organization's official website or another trusted channel"
      }
    ]
  },
  {
    questionId: 4,
    text: "Why should you avoid sharing passwords or verification codes with other people?",
    choices: [
      {
        value: "A",
        text: "They may allow another person to access your account"
      },
      {
        value: "B",
        text: "They make your internet connection slower"
      },
      {
        value: "C",
        text: "They cause websites to stop working"
      },
      {
        value: "D",
        text: "They automatically delete your account"
      }
    ]
  },
  {
    questionId: 5,
    text: "Why are software and security updates important?",
    choices: [
      {
        value: "A",
        text: "They guarantee that a device can never be attacked"
      },
      {
        value: "B",
        text: "They can fix known security vulnerabilities and other software problems"
      },
      {
        value: "C",
        text: "They remove the need for passwords"
      },
      {
        value: "D",
        text: "They make every website trustworthy"
      }
    ]
  },
  {
    questionId: 6,
    text: "What should you be careful about when using public Wi-Fi?",
    choices: [
      {
        value: "A",
        text: "Sensitive activities may be riskier on networks you do not control"
      },
      {
        value: "B",
        text: "Public Wi-Fi automatically gives websites your password"
      },
      {
        value: "C",
        text: "Public Wi-Fi permanently disables antivirus software"
      },
      {
        value: "D",
        text: "Public Wi-Fi makes MFA unnecessary"
      }
    ]
  },
  {
    questionId: 7,
    text: "Someone claiming to be from technical support unexpectedly asks for your password to fix your account. What should you do?",
    choices: [
      {
        value: "A",
        text: "Give them the password if they know your name"
      },
      {
        value: "B",
        text: "Give them only part of the password"
      },
      {
        value: "C",
        text: "Refuse to provide the password and verify the request through an official channel"
      },
      {
        value: "D",
        text: "Change the password to something simple before giving it to them"
      }
    ]
  },
  {
    questionId: 8,
    text: "What is the safest approach to an unexpected email attachment from an unfamiliar sender?",
    choices: [
      {
        value: "A",
        text: "Open it immediately to see what it contains"
      },
      {
        value: "B",
        text: "Avoid opening it until the sender and attachment can be verified"
      },
      {
        value: "C",
        text: "Rename the file before opening it"
      },
      {
        value: "D",
        text: "Send it to another person and ask them to open it first"
      }
    ]
  },
  {
    questionId: 9,
    text: "If you think one of your accounts may have been compromised, what is an appropriate response?",
    choices: [
      {
        value: "A",
        text: "Ignore it unless the account stops working"
      },
      {
        value: "B",
        text: "Post your password publicly so others can check it"
      },
      {
        value: "C",
        text: "Continue using the account normally for several weeks"
      },
      {
        value: "D",
        text: "Secure the account using official recovery/security options and report the incident when appropriate"
      }
    ]
  },
  {
    questionId: 10,
    text: "Why should suspicious cybersecurity activity be reported to the appropriate school or organization personnel?",
    choices: [
      {
        value: "A",
        text: "Reporting can help the organization investigate and respond to potential security incidents"
      },
      {
        value: "B",
        text: "Reporting guarantees that no future cyberattack can happen"
      },
      {
        value: "C",
        text: "Reporting automatically identifies every attacker"
      },
      {
        value: "D",
        text: "Reporting replaces the need for other security practices"
      }
    ]
  }
];

const AWARENESS_ANSWER_KEY = {
  1: "B",
  2: "C",
  3: "D",
  4: "A",
  5: "B",
  6: "A",
  7: "C",
  8: "B",
  9: "D",
  10: "A"
};

const VALID_SELECTED_ANSWERS = ["A", "B", "C", "D"];

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
}

deepFreeze(AWARENESS_QUESTIONS);
deepFreeze(AWARENESS_ANSWER_KEY);
deepFreeze(VALID_SELECTED_ANSWERS);

function getAwarenessQuestions() {
  return AWARENESS_QUESTIONS.map(({ questionId, text, choices }) => ({
    questionId,
    text,
    choices: choices.map(({ value, text: choiceText }) => ({
      value,
      text: choiceText
    }))
  }));
}

function getAwarenessQuestionIds() {
  return AWARENESS_QUESTIONS.map(({ questionId }) => questionId);
}

function getValidSelectedAnswers() {
  return [...VALID_SELECTED_ANSWERS];
}

function scoreAwarenessAnswers(answers) {
  const rawScore = answers.reduce((total, answer) => {
    const correctAnswer = AWARENESS_ANSWER_KEY[answer.questionId];

    return total + (correctAnswer === answer.selectedAnswer ? 1 : 0);
  }, 0);

  return {
    rawScore,
    score: (rawScore / AWARENESS_TOTAL_QUESTIONS) * 100,
    totalQuestions: AWARENESS_TOTAL_QUESTIONS
  };
}

function toAwarenessAssessmentResult(assessment) {
  return {
    id: assessment._id,
    rawScore: assessment.rawScore,
    score: assessment.score,
    totalQuestions: assessment.totalQuestions,
    completedAt: assessment.completedAt
  };
}

async function getAwarenessAssessmentHistoryForUser(userId) {
  const assessments = await AwarenessAssessment.find({
    user: userId
  })
    .select({
      _id: 1,
      rawScore: 1,
      score: 1,
      totalQuestions: 1,
      completedAt: 1
    })
    .sort({ completedAt: -1, _id: -1 })
    .limit(AWARENESS_HISTORY_LIMIT)
    .lean();

  return assessments.map(toAwarenessAssessmentResult);
}

async function getLatestAwarenessAssessmentForUser(userId) {
  const assessment = await AwarenessAssessment.findOne({
    user: userId
  })
    .select({
      _id: 1,
      rawScore: 1,
      score: 1,
      totalQuestions: 1,
      completedAt: 1
    })
    .sort({ completedAt: -1, _id: -1 })
    .lean();

  return assessment ? toAwarenessAssessmentResult(assessment) : null;
}

module.exports = {
  AWARENESS_TOTAL_QUESTIONS,
  getAwarenessAssessmentHistoryForUser,
  getAwarenessQuestions,
  getAwarenessQuestionIds,
  getLatestAwarenessAssessmentForUser,
  getValidSelectedAnswers,
  scoreAwarenessAnswers,
  toAwarenessAssessmentResult
};
