const AwarenessAssessment = require("../models/AwarenessAssessment");
const {
  getAwarenessQuestions,
  scoreAwarenessAnswers
} = require("../services/awareness.service");

function toAssessmentResponse(assessment) {
  return {
    id: assessment._id,
    rawScore: assessment.rawScore,
    score: assessment.score,
    totalQuestions: assessment.totalQuestions,
    completedAt: assessment.completedAt
  };
}

async function getQuestions(req, res, next) {
  try {
    const questions = getAwarenessQuestions();

    return res.status(200).json({
      success: true,
      questions
    });
  } catch (error) {
    next(error);
  }
}

async function submitAssessment(req, res, next) {
  try {
    const { answers } = req.body;
    const result = scoreAwarenessAnswers(answers);

    const savedAssessment = await AwarenessAssessment.create({
      user: req.user.userId,
      answers: answers.map(({ questionId, selectedAnswer }) => ({
        questionId,
        selectedAnswer
      })),
      rawScore: result.rawScore,
      score: result.score,
      totalQuestions: result.totalQuestions,
      completedAt: new Date()
    });

    return res.status(201).json({
      success: true,
      message: "Awareness assessment submitted successfully",
      assessment: toAssessmentResponse(savedAssessment)
    });
  } catch (error) {
    next(error);
  }
}

async function getLatestAssessment(req, res, next) {
  try {
    const assessment = await AwarenessAssessment.findOne({
      user: req.user.userId
    }).sort({ completedAt: -1, _id: -1 });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: "No awareness assessment found"
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
  getQuestions,
  submitAssessment,
  getLatestAssessment
};
