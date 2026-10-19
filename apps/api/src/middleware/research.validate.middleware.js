// Analytics Visualization V1 query validation
// (specs/analytics-visualization-v1.md, sections 3 and 7).
//
// Mounted on `GET /api/research/analytics` ONLY, after the router-wide
// `authenticate` and `authorizeRoles("admin")` layers. It therefore never runs
// before authorization, and it never runs for the CSV export route, whose
// query handling is deliberately left exactly as it was.
//
// The validator never accepts a participant identifier, a role, or any
// free-form filter expression. The only accepted input is one of five literal
// exposure-level values.
const EXPOSURE_LEVEL_ALL = "all";
const EXPOSURE_LEVEL_PARAMETER = "exposureLevel";

// The accepted numeric levels are the completed-module counts 0 through 3.
// They are validated as literal strings so no numeric coercion of user input
// is ever performed.
const EXPOSURE_LEVEL_QUERY_VALUES = new Set(["0", "1", "2", "3"]);

function sendValidationError(res, error) {
  return res.status(400).json({
    success: false,
    error
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Express 5's default query parser produces these shapes, each of which must
// be rejected rather than silently accepted or ignored:
//   - a repeated parameter becomes an array
//   - `?exposureLevel` and `?exposureLevel=` both become an empty string
//   - `?exposureLevel[]=2` becomes a DISTINCT key, caught as an unknown key
//   - any other key is an unknown key
function validateAnalyticsQuery(req, res, next) {
  const query = req.query;

  if (!isPlainObject(query)) {
    return sendValidationError(res, "Invalid analytics query");
  }

  const suppliedKeys = Object.keys(query);
  const unexpectedKeys = suppliedKeys.filter(
    (key) => key !== EXPOSURE_LEVEL_PARAMETER
  );

  if (unexpectedKeys.length > 0) {
    return sendValidationError(res, "Only exposureLevel may be supplied");
  }

  // Omitted parameter: the response keeps its exact existing shape and the
  // service performs no filtering and no suppression.
  if (!suppliedKeys.includes(EXPOSURE_LEVEL_PARAMETER)) {
    req.researchExposureFilter = {
      supplied: false,
      level: null,
      queryValue: null
    };

    return next();
  }

  const rawValue = query[EXPOSURE_LEVEL_PARAMETER];

  if (Array.isArray(rawValue)) {
    return sendValidationError(
      res,
      "exposureLevel may only be supplied once"
    );
  }

  if (typeof rawValue !== "string" || rawValue.length === 0) {
    return sendValidationError(
      res,
      "exposureLevel must be all, 0, 1, 2, or 3"
    );
  }

  // `all` is an explicit request for the unfiltered cohort. It is recorded as
  // supplied so the response can carry its metadata, but it never filters and
  // never suppresses (spec section 5.1: suppression applies only to a selected
  // level, and note N2: a minimum is defined only for levels 0 through 3).
  if (rawValue === EXPOSURE_LEVEL_ALL) {
    req.researchExposureFilter = {
      supplied: true,
      level: null,
      queryValue: EXPOSURE_LEVEL_ALL
    };

    return next();
  }

  if (!EXPOSURE_LEVEL_QUERY_VALUES.has(rawValue)) {
    return sendValidationError(
      res,
      "exposureLevel must be all, 0, 1, 2, or 3"
    );
  }

  req.researchExposureFilter = {
    supplied: true,
    level: Number(rawValue),
    queryValue: rawValue
  };

  return next();
}

module.exports = {
  EXPOSURE_LEVEL_ALL,
  EXPOSURE_LEVEL_PARAMETER,
  validateAnalyticsQuery
};
