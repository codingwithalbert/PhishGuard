const {
  analyzeUrl,
  getAnalysesForUser
} = require("../services/analysis.service");
const Analysis = require("../models/Analysis");

async function analyze(req, res, next) {
  try {
    const { url } = req.body;

    const result = analyzeUrl(url);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const savedAnalysis = await Analysis.create({
      user: req.user.userId,
      url: result.url,
      risk: result.risk,
      score: result.score,
      indicators: result.indicators
    });

    return res.status(201).json({
      success: true,
      message: "URL analyzed and saved successfully",
      analysis: {
        id: savedAnalysis._id,
        url: savedAnalysis.url,
        risk: savedAnalysis.risk,
        score: savedAnalysis.score,
        indicators: savedAnalysis.indicators,
        status: savedAnalysis.status,
        createdAt: savedAnalysis.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
}

async function getAnalyses(req, res, next) {
  try {
    const analyses = await getAnalysesForUser(req.user.userId);

    return res.status(200).json({
      success: true,
      count: analyses.length,
      analyses
    });
  } catch (error) {
    next(error);
  }
}

async function updateAnalysis(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const analysis = await Analysis.findOne({
      _id: id,
      user: req.user.userId
    });

    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: "Analysis not found"
      });
    }

    analysis.status = status;

    await analysis.save();

    return res.status(200).json({
      success: true,
      message: "Analysis updated successfully",
      analysis
    });
  } catch (error) {
    next(error);
  }
}

async function deleteAnalysis(req, res, next) {
  try {
    const { id } = req.params;

    const analysis = await Analysis.findOne({
      _id: id,
      user: req.user.userId
    });

    if (!analysis) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to delete this analysis"
      });
    }

    await analysis.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Analysis deleted successfully"
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  analyze,
  getAnalyses,
  updateAnalysis,
  deleteAnalysis
};