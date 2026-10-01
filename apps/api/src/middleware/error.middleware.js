const DIAGNOSTIC_ERROR_TYPES = [
  TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError, Error
];

function errorHandler(err, req, res, next) {
  const isInvalidJson =
    err instanceof SyntaxError && err.status === 400 && "body" in err;
  const errorType = DIAGNOSTIC_ERROR_TYPES.find(
    (ErrorType) => err instanceof ErrorType
  );

  // Only fixed classifications and server-generated metadata are logged.
  // Error messages, stacks, names, codes, causes, and request fields may
  // contain submitted bodies or credentials and must not be serialized.
  console.error("[ERROR]", JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "GLOBAL_ERROR",
    category: isInvalidJson ? "invalid_json" : "unexpected_error",
    errorType: errorType ? errorType.name : "Unknown",
    status: isInvalidJson ? 400 : 500
  }));

  if (isInvalidJson) {
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
