const PhishingIdentificationAssessment = require("../models/PhishingIdentificationAssessment");
const {
  getPhishingIdentificationScenarios,
  scorePhishingIdentificationAnswers
} = require("../services/phishingIdentification.service");

function toAssessmentResponse(assessment) {
  return {
    id: assessment._id,
    rawScore: assessment.rawScore,
    score: assessment.score,
    totalScenarios: assessment.totalScenarios,
    completedAt: assessment.completedAt
  };
}

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
      assessment: toAssessmentResponse(savedAssessment)
    });
  } catch (error) {
    next(error);
  }
}

async function getLatestAssessment(req, res, next) {
  try {
    const assessment = await PhishingIdentificationAssessment.findOne({
      user: req.user.userId
    }).sort({ completedAt: -1, _id: -1 });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: "No phishing identification assessment found"
      });
    }

    return res.status(200).json({
      success: true,
      assessment: toAssessmentResponse(assessment)
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
