const {
  getLatestAwarenessAssessmentForUser
} = require("./awareness.service");
const {
  getLatestPhishingIdentificationAssessmentForUser
} = require("./phishingIdentification.service");
const {
  getTrainingProgressForUser
} = require("./training.service");
const {
  countAnalysesForUser,
  getRecentAnalysesForUser
} = require("./analysis.service");

async function getDashboardSummaryForUser(userId) {
  const [
    latestAwarenessAssessment,
    latestPhishingIdentificationAssessment,
    trainingResult,
    totalAnalyses,
    recentAnalyses
  ] = await Promise.all([
    getLatestAwarenessAssessmentForUser(userId),
    getLatestPhishingIdentificationAssessmentForUser(userId),
    getTrainingProgressForUser(userId),
    countAnalysesForUser(userId),
    getRecentAnalysesForUser(userId)
  ]);

  return {
    latestAwarenessAssessment,
    latestPhishingIdentificationAssessment,
    trainingProgress: trainingResult.progress,
    urlAnalyses: {
      total: totalAnalyses,
      recent: recentAnalyses
    }
  };
}

module.exports = {
  getDashboardSummaryForUser
};
