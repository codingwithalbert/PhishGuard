function validateAnalyzeRequest(req, res, next) {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required"
    });
  }

  if (typeof url !== "string") {
    return res.status(400).json({
      success: false,
      error: "URL must be a string"
    });
  }

  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    return res.status(400).json({
      success: false,
      error: "URL cannot be empty"
    });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return res.status(400).json({
      success: false,
      error: "Invalid URL"
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return res.status(400).json({
      success: false,
      error: "URL must use HTTP or HTTPS"
    });
  }

  req.body.url = trimmedUrl;

  next();
}

module.exports = {
  validateAnalyzeRequest
};