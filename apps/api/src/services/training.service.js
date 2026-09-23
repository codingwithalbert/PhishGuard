const TrainingCompletion = require("../models/TrainingCompletion");

const TRAINING_TOTAL_MODULES = 3;

const TRAINING_MODULES = [
  {
    moduleId: 1,
    title: "Recognizing Phishing Indicators",
    learningObjective:
      "Help users recognize common warning signs associated with phishing messages.",
    content: [
      {
        heading: "Inspect the sender identity",
        points: [
          "Compare the display name with the full sender domain.",
          "Treat an unfamiliar or mismatched domain as a reason to verify the message through an official channel."
        ]
      },
      {
        heading: "Check links and destinations",
        points: [
          "Inspect where a link actually leads before interacting with it.",
          "Be cautious when visible link text and the destination do not match."
        ]
      },
      {
        heading: "Notice pressure and urgency",
        points: [
          "Treat threats, countdowns, and demands for immediate action as warning signs.",
          "Slow down and verify unexpected requests independently."
        ]
      },
      {
        heading: "Protect sensitive information",
        points: [
          "Be cautious when a message requests passwords, verification codes, or other sensitive information."
        ]
      },
      {
        heading: "Handle attachments safely",
        points: [
          "Avoid opening unexpected attachments until the sender and file can be verified."
        ]
      },
      {
        heading: "Recognize impersonation",
        points: [
          "Messages that imitate trusted organizations or authority figures still require independent verification."
        ]
      },
      {
        heading: "Consider multiple signals",
        points: [
          "A message may look ordinary while combining several warning signs; consider the overall pattern rather than one detail alone."
        ]
      }
    ]
  },
  {
    moduleId: 2,
    title: "Password and MFA Security",
    learningObjective:
      "Help users understand basic account-protection practices.",
    content: [
      {
        heading: "Use strong, unique passwords",
        points: [
          "Use a strong password for each important account and avoid reusing passwords across services."
        ]
      },
      {
        heading: "Protect passwords",
        points: [
          "Never share passwords with support personnel, colleagues, or anyone else."
        ]
      },
      {
        heading: "Use multi-factor authentication",
        points: [
          "Enable MFA when it is available and review account security settings through official services."
        ]
      },
      {
        heading: "Protect verification codes",
        points: [
          "Never share password, verification, recovery, or MFA codes."
        ]
      },
      {
        heading: "Question unexpected requests",
        points: [
          "Treat unexpected requests for credentials or verification codes as a reason to stop and verify through an official channel."
        ]
      },
      {
        heading: "Keep access private",
        points: [
          "Do not include real passwords, codes, or recovery information in training exercises or support messages."
        ]
      }
    ]
  },
  {
    moduleId: 3,
    title: "Safe Handling and Reporting",
    learningObjective:
      "Help users respond safely when they encounter suspicious cybersecurity activity.",
    content: [
      {
        heading: "Pause before interacting",
        points: [
          "Avoid clicking suspicious links or opening suspicious attachments until they can be verified."
        ]
      },
      {
        heading: "Verify independently",
        points: [
          "Use a known official website, application, or contact route rather than contact details supplied by a suspicious message."
        ]
      },
      {
        heading: "Use official channels",
        points: [
          "Reach an organization through its established website, application, or institutional contact process."
        ]
      },
      {
        heading: "Report suspicious activity",
        points: [
          "Report suspicious messages or activity through the appropriate school or organizational reporting channel."
        ]
      },
      {
        heading: "Keep systems updated",
        points: [
          "Install legitimate software and security updates to reduce known security problems."
        ]
      },
      {
        heading: "Use untrusted networks cautiously",
        points: [
          "Be careful with sensitive activity on public or otherwise untrusted networks, and verify the network before relying on it."
        ]
      }
    ]
  }
];

const TRAINING_MODULE_IDS = TRAINING_MODULES.map(
  ({ moduleId }) => moduleId
);
const TRAINING_MODULE_ID_SET = new Set(TRAINING_MODULE_IDS);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
}

deepFreeze(TRAINING_MODULES);
deepFreeze(TRAINING_MODULE_IDS);

function getTrainingCatalog() {
  return TRAINING_MODULES.map(({ moduleId, title, learningObjective, content }) => ({
    moduleId,
    title,
    learningObjective,
    content: content.map(({ heading, points }) => ({
      heading,
      points: [...points]
    }))
  }));
}

function getTrainingModuleIds() {
  return [...TRAINING_MODULE_IDS];
}

function calculateTrainingExposure(completedModules) {
  return (
    Math.round(
      (completedModules / TRAINING_TOTAL_MODULES) * 10000
    ) / 100
  );
}

async function getTrainingProgressForUser(userId) {
  const completions = await TrainingCompletion.find({
    user: userId,
    moduleId: { $in: TRAINING_MODULE_IDS }
  })
    .select({ moduleId: 1 })
    .lean();

  const completedModules = new Set(
    completions
      .map(({ moduleId }) => moduleId)
      .filter((moduleId) => TRAINING_MODULE_ID_SET.has(moduleId))
  ).size;

  return {
    progress: {
      completedModules,
      totalModules: TRAINING_TOTAL_MODULES,
      trainingExposure: calculateTrainingExposure(completedModules)
    }
  };
}

async function getTrainingModulesForUser(userId) {
  const completions = await TrainingCompletion.find({
    user: userId,
    moduleId: { $in: TRAINING_MODULE_IDS }
  })
    .select({ moduleId: 1, completedAt: 1 })
    .lean();

  const completionByModuleId = new Map(
    completions.map((completion) => [completion.moduleId, completion])
  );

  return {
    modules: getTrainingCatalog().map((module) => {
      const completion = completionByModuleId.get(module.moduleId);

      return {
        ...module,
        completed: Boolean(completion),
        completedAt: completion?.completedAt || null
      };
    })
  };
}

async function buildCompletionResult(completion, created) {
  const { progress } = await getTrainingProgressForUser(completion.user);

  return {
    created,
    completion: {
      moduleId: completion.moduleId,
      completedAt: completion.completedAt
    },
    progress
  };
}

async function completeTrainingModuleForUser(userId, moduleId) {
  const existingCompletion = await TrainingCompletion.findOne({
    user: userId,
    moduleId
  });

  if (existingCompletion) {
    return buildCompletionResult(existingCompletion, false);
  }

  try {
    const createdCompletion = await TrainingCompletion.create({
      user: userId,
      moduleId,
      completedAt: new Date()
    });

    return buildCompletionResult(createdCompletion, true);
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    const duplicateCompletion = await TrainingCompletion.findOne({
      user: userId,
      moduleId
    });

    if (!duplicateCompletion) {
      throw error;
    }

    return buildCompletionResult(duplicateCompletion, false);
  }
}

module.exports = {
  TRAINING_TOTAL_MODULES,
  calculateTrainingExposure,
  completeTrainingModuleForUser,
  getTrainingCatalog,
  getTrainingModuleIds,
  getTrainingModulesForUser,
  getTrainingProgressForUser
};
