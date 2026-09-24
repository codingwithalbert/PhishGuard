const {
  getAwarenessAssessmentHistoryForUser
} = require("./awareness.service");
const {
  getPhishingIdentificationAssessmentHistoryForUser
} = require("./phishingIdentification.service");
const {
  getTrainingModulesForUser,
  getTrainingProgressForUser
} = require("./training.service");

async function getProgressForUser(userId) {
  const [
    awarenessHistory,
    phishingIdentificationHistory,
    trainingProgressResult,
    trainingModulesResult
  ] = await Promise.all([
    getAwarenessAssessmentHistoryForUser(userId),
    getPhishingIdentificationAssessmentHistoryForUser(userId),
    getTrainingProgressForUser(userId),
    getTrainingModulesForUser(userId)
  ]);

  const {
    completedModules,
    totalModules,
    trainingExposure
  } = trainingProgressResult.progress;

  return {
    awareness: {
      latest: awarenessHistory.length > 0 ? awarenessHistory[0] : null,
      history: awarenessHistory
    },
    phishingIdentification: {
      latest:
        phishingIdentificationHistory.length > 0
          ? phishingIdentificationHistory[0]
          : null,
      history: phishingIdentificationHistory
    },
    training: {
      completedModules,
      totalModules,
      trainingExposure,
      modules: trainingModulesResult.modules
    }
  };
}

module.exports = {
  getProgressForUser
};
