const DIAGNOSTIC_ERROR_TYPES = [
  TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError, Error
];

// Stable client-facing responses. Only fixed strings are ever published.
const INVALID_JSON_MESSAGE = "Invalid JSON payload";
const PAYLOAD_TOO_LARGE_MESSAGE = "Request body too large";
const INTERNAL_ERROR_MESSAGE = "Internal server error";

function isInvalidJson(err) {
  return err instanceof SyntaxError && err.status === 400 && "body" in err;
}

// The JSON body parser rejects an oversized request body with the http-errors
// type `entity.too.large` and a 413 status. Detection uses those stable
// properties rather than the error message, which may embed body details.
//
// A SyntaxError carrying status 413 is deliberately NOT treated as an
// oversized body. JSON parse failures arrive as a SyntaxError with status 400
// and are classified as invalid JSON, so the two conditions stay separate.
function isPayloadTooLarge(err) {
  if (err?.type === "entity.too.large") {
    return true;
  }

  return (
    err instanceof Error &&
    err.status === 413 &&
    !(err instanceof SyntaxError)
  );
}

function errorHandler(err, req, res, next) {
  const invalidJson = isInvalidJson(err);
  const payloadTooLarge = !invalidJson && isPayloadTooLarge(err);
  const errorType = DIAGNOSTIC_ERROR_TYPES.find(
    (ErrorType) => err instanceof ErrorType
  );

  // Only fixed classifications and server-generated metadata are logged.
  // Error messages, stacks, names, codes, causes, and request fields may
  // contain submitted bodies or credentials and must not be serialized. The
  // received body, its length, and the configured limit are all excluded.
  console.error("[ERROR]", JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "GLOBAL_ERROR",
    category: invalidJson
      ? "invalid_json"
      : payloadTooLarge
        ? "payload_too_large"
        : "unexpected_error",
    errorType: errorType ? errorType.name : "Unknown",
    status: invalidJson ? 400 : payloadTooLarge ? 413 : 500
  }));

  if (invalidJson) {
    return res.status(400).json({
      success: false,
      error: INVALID_JSON_MESSAGE
    });
  }

  if (payloadTooLarge) {
    return res.status(413).json({
      success: false,
      error: PAYLOAD_TOO_LARGE_MESSAGE
    });
  }

  return res.status(500).json({
    success: false,
    error: INTERNAL_ERROR_MESSAGE
  });
}

module.exports = errorHandler;
module.exports.INTERNAL_ERROR_MESSAGE = INTERNAL_ERROR_MESSAGE;
module.exports.INVALID_JSON_MESSAGE = INVALID_JSON_MESSAGE;
module.exports.PAYLOAD_TOO_LARGE_MESSAGE = PAYLOAD_TOO_LARGE_MESSAGE;
