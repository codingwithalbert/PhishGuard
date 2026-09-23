const PHISHING_IDENTIFICATION_TOTAL_SCENARIOS = 10;

const PHISHING_IDENTIFICATION_SCENARIOS = [
  {
    scenarioId: 1,
    scenario: "You receive an email that appears to be from your school's IT department. The display name says \"Campus IT Support,\" but the sender address is `support@campus-security-help.example`.",
    question: "Which detail is the strongest phishing indicator?",
    choices: [
      {
        value: "A",
        text: "The message claims to be from the IT department."
      },
      {
        value: "B",
        text: "The sender's domain does not match the organization's expected domain."
      },
      {
        value: "C",
        text: "The email contains a support-related subject."
      },
      {
        value: "D",
        text: "The message was delivered to your inbox."
      }
    ]
  },
  {
    scenarioId: 2,
    scenario: "A message says, \"Your student account will be permanently disabled in 30 minutes unless you verify it immediately using the link below.\"",
    question: "Which characteristic should make you most suspicious?",
    choices: [
      {
        value: "A",
        text: "The message discusses a student account."
      },
      {
        value: "B",
        text: "The message contains a link."
      },
      {
        value: "C",
        text: "The message uses an urgent threat to pressure you into acting quickly."
      },
      {
        value: "D",
        text: "The message was received during the school day."
      }
    ]
  },
  {
    scenarioId: 3,
    scenario: "An email contains a button labeled \"Open Student Portal.\" Before clicking, you inspect the destination and see that it points to an unrelated domain rather than the school's official portal.",
    question: "What is the clearest phishing indicator?",
    choices: [
      {
        value: "A",
        text: "The visible button text and actual link destination do not match the expected service."
      },
      {
        value: "B",
        text: "The email contains a button instead of plain text."
      },
      {
        value: "C",
        text: "The message mentions the student portal."
      },
      {
        value: "D",
        text: "The link uses lowercase letters."
      }
    ]
  },
  {
    scenarioId: 4,
    scenario: "You receive a message claiming to be from technical support. It asks you to reply with your account password so the support team can \"verify your identity and repair your account.\"",
    question: "What is the strongest warning sign?",
    choices: [
      {
        value: "A",
        text: "The message refers to technical support."
      },
      {
        value: "B",
        text: "The sender offers to repair the account."
      },
      {
        value: "C",
        text: "The message asks you to reply."
      },
      {
        value: "D",
        text: "The sender asks you to provide your password."
      }
    ]
  },
  {
    scenarioId: 5,
    scenario: "You receive an unexpected email claiming to contain an important document. The sender is unfamiliar to you, and the message asks you to open the attached file immediately.",
    question: "What is the safest identification of this situation?",
    choices: [
      {
        value: "A",
        text: "The attachment is safe because the message calls it important."
      },
      {
        value: "B",
        text: "The unexpected attachment from an unfamiliar sender is a phishing warning sign."
      },
      {
        value: "C",
        text: "The attachment should be opened first so you can determine what it contains."
      },
      {
        value: "D",
        text: "The email is trustworthy because it reached your inbox."
      }
    ]
  },
  {
    scenarioId: 6,
    scenario: "Shortly after receiving a login verification code, you receive a message from someone claiming to be account support. They ask you to send them the verification code to confirm your identity.",
    question: "Which detail is the strongest phishing indicator?",
    choices: [
      {
        value: "A",
        text: "The person asks you to share a login verification code."
      },
      {
        value: "B",
        text: "A verification code was generated."
      },
      {
        value: "C",
        text: "The message refers to account support."
      },
      {
        value: "D",
        text: "The message discusses identity verification."
      }
    ]
  },
  {
    scenarioId: 7,
    scenario: "A message claims to be from a school administrator and tells you to complete an unusual account-verification request immediately. The request is unexpected, and the sender address does not use the school's normal domain.",
    question: "Which combination provides the strongest reason to suspect phishing?",
    choices: [
      {
        value: "A",
        text: "The message mentions an administrator and an account."
      },
      {
        value: "B",
        text: "The message arrived unexpectedly."
      },
      {
        value: "C",
        text: "The unexpected request, pressure to act immediately, and unusual sender domain."
      },
      {
        value: "D",
        text: "The message contains formal language."
      }
    ]
  },
  {
    scenarioId: 8,
    scenario: "A message directs you to a login page at `https://student-portal.example-login.test`, while your school's normal login service uses a different official domain.",
    question: "What should you identify as the main warning sign?",
    choices: [
      {
        value: "A",
        text: "The address begins with HTTPS."
      },
      {
        value: "B",
        text: "The login page uses a domain different from the expected official domain."
      },
      {
        value: "C",
        text: "The address contains the words \"student\" and \"portal.\""
      },
      {
        value: "D",
        text: "The page contains a login form."
      }
    ]
  },
  {
    scenarioId: 9,
    scenario: "An email claims that your account information is incomplete and asks you to submit your password and other sensitive account information through a form linked in the message.",
    question: "Which detail most strongly indicates a phishing attempt?",
    choices: [
      {
        value: "A",
        text: "The message says your information is incomplete."
      },
      {
        value: "B",
        text: "The message includes a form."
      },
      {
        value: "C",
        text: "The message discusses your account."
      },
      {
        value: "D",
        text: "The message requests sensitive account information through an unsolicited link."
      }
    ]
  },
  {
    scenarioId: 10,
    scenario: "You receive an unexpected account-security email from an unfamiliar domain. It says your account will be locked immediately and asks you to use a provided link to enter your login information.",
    question: "What is the best assessment of the message?",
    choices: [
      {
        value: "A",
        text: "It contains multiple phishing indicators, including an unusual sender, urgency, and a request to enter login information through a provided link."
      },
      {
        value: "B",
        text: "It is probably legitimate because it discusses account security."
      },
      {
        value: "C",
        text: "It should be trusted because urgent security messages require immediate action."
      },
      {
        value: "D",
        text: "It is safe as long as the message contains a link."
      }
    ]
  }
];

const PHISHING_IDENTIFICATION_ANSWER_KEY = {
  1: "B",
  2: "C",
  3: "A",
  4: "D",
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

deepFreeze(PHISHING_IDENTIFICATION_SCENARIOS);
deepFreeze(PHISHING_IDENTIFICATION_ANSWER_KEY);
deepFreeze(VALID_SELECTED_ANSWERS);

function getPhishingIdentificationScenarios() {
  return PHISHING_IDENTIFICATION_SCENARIOS.map(
    ({ scenarioId, scenario, question, choices }) => ({
      scenarioId,
      scenario,
      question,
      choices: choices.map(({ value, text }) => ({ value, text }))
    })
  );
}

function getPhishingIdentificationScenarioIds() {
  return PHISHING_IDENTIFICATION_SCENARIOS.map(({ scenarioId }) => scenarioId);
}

function getValidSelectedAnswers() {
  return [...VALID_SELECTED_ANSWERS];
}

function scorePhishingIdentificationAnswers(answers) {
  const rawScore = answers.reduce((total, answer) => {
    const correctAnswer =
      PHISHING_IDENTIFICATION_ANSWER_KEY[answer.scenarioId];

    return total + (correctAnswer === answer.selectedAnswer ? 1 : 0);
  }, 0);

  return {
    rawScore,
    score: (rawScore / PHISHING_IDENTIFICATION_TOTAL_SCENARIOS) * 100,
    totalScenarios: PHISHING_IDENTIFICATION_TOTAL_SCENARIOS
  };
}

module.exports = {
  PHISHING_IDENTIFICATION_TOTAL_SCENARIOS,
  getPhishingIdentificationScenarios,
  getPhishingIdentificationScenarioIds,
  getValidSelectedAnswers,
  scorePhishingIdentificationAnswers
};
