function errorHandler(err, req, res, next) {
  console.error(err);

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON payload"
    });
  }

  return res.status(500).json({
    success: false,
    error: "Internal server error"
  });
}

module.exports = errorHandler;