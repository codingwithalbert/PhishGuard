const { analyzeUrl } = require("../services/analysis.service");

function analyze(req, res) {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      success: false,
      error: "A URL is required"
    });
  }

  const result = analyzeUrl(url);

  if (!result.success) {
    return res.status(400).json(result);
  }

  return res.status(200).json(result);
}

module.exports = {
  analyze
};