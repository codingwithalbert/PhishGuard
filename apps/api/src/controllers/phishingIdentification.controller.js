const PhishingIdentificationAssessment = require("../models/PhishingIdentificationAssessment");
const {
  getLatestPhishingIdentificationAssessmentForUser,
  getPhishingIdentificationScenarios,
  scorePhishingIdentificationAnswers,
  toPhishingIdentificationAssessmentResult
} = require("../services/phishingIdentification.service");

async function getScenarios(req, res, next) {
  try {
    const scenarios = getPhishingIdentificationScenarios();

    return res.status(200).json({
      success: true,
      scenarios
    });
  } catch (error) {
    next(error);
  }
}

async function submitAssessment(req, res, next) {
  try {
    const { answers } = req.body;
    const result = scorePhishingIdentificationAnswers(answers);

    const savedAssessment = await PhishingIdentificationAssessment.create({
      user: req.user.userId,
      answers: answers.map(({ scenarioId, selectedAnswer }) => ({
        scenarioId,
        selectedAnswer
      })),
      rawScore: result.rawScore,
      score: result.score,
      totalScenarios: result.totalScenarios,
      completedAt: new Date()
    });

    return res.status(201).json({
      success: true,
      message: "Phishing identification assessment submitted successfully",
      assessment: toPhishingIdentificationAssessmentResult(savedAssessment)
    });
  } catch (error) {
    next(error);
  }
}

async function getLatestAssessment(req, res, next) {
  try {
    const assessment = await getLatestPhishingIdentificationAssessmentForUser(
      req.user.userId
    );

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: "No phishing identification assessment found"
      });
    }

    return res.status(200).json({
      success: true,
      assessment
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getScenarios,
  submitAssessment,
  getLatestAssessment
};
