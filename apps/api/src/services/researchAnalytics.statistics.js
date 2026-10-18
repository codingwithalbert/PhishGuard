// Research Analytics V1 pure statistics layer (spec 7, 9, and 10).
//
// These helpers are intentionally free of database and framework concerns so
// every number is directly unit-testable. They never return NaN or Infinity:
// undefined statistics are reported as null, never as a fabricated zero.
const MEAN_PRECISION = 2;
const MEDIAN_PRECISION = 2;
const CORRELATION_PRECISION = 3;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  const magnitude = Math.round(
    Math.abs(value) * factor + Number.EPSILON
  );
  const rounded = Math.sign(value) * magnitude;

  if (rounded === 0) {
    return 0;
  }

  return rounded / factor;
}

function toObservationList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(isFiniteNumber);
}

function computeMedian(sortedAscending, precision = MEDIAN_PRECISION) {
  const count = sortedAscending.length;
  const middle = Math.floor(count / 2);

  if (count % 2 === 1) {
    return roundTo(sortedAscending[middle], precision);
  }

  return roundTo(
    (sortedAscending[middle - 1] + sortedAscending[middle]) / 2,
    precision
  );
}

// Spec 7 and 10: sample size plus mean, median, minimum, and maximum. An empty
// sample returns n 0 with every statistic null.
function computeDescriptiveStatistics(values) {
  const observations = toObservationList(values);

  if (observations.length === 0) {
    return {
      n: 0,
      mean: null,
      median: null,
      min: null,
      max: null
    };
  }

  const total = observations.reduce(
    (sum, value) => sum + value,
    0
  );
  const sortedAscending = [...observations].sort(
    (left, right) => left - right
  );

  return {
    n: observations.length,
    mean: roundTo(total / observations.length, MEAN_PRECISION),
    median: computeMedian(sortedAscending),
    min: sortedAscending[0],
    max: sortedAscending[sortedAscending.length - 1]
  };
}

function toCompletePairs(pairs) {
  if (!Array.isArray(pairs)) {
    return [];
  }

  const complete = [];

  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }

    const [x, y] = pair;

    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      complete.push([x, y]);
    }
  }

  return complete;
}

// A constant variable makes the Pearson coefficient mathematically undefined.
//
// The exact-equality comparison is deliberate and is what this helper exists
// for. Accumulating variance from deviations of a running mean is not exact for
// values that are not representable in binary: for six or more identical
// observations of 33.33, the mean does not round-trip, the accumulated variance
// is a residue of roughly 3e-28 rather than exactly zero, the denominator check
// below is skipped, and a fabricated `0` is reported where the honest answer is
// `null`. Comparing the observations directly is exact, and it cannot alter any
// defined coefficient, because identical values always imply zero variance.
function hasConstantValue(observations, index) {
  const firstValue = observations[0][index];

  return observations.every(
    (observation) => observation[index] === firstValue
  );
}

// Spec 9: Pearson correlation over pairwise complete observations. The result
// is null whenever it is not mathematically defined, and the applicable sample
// size is always reported. No qualitative label is attached to any value.
function computePearsonCorrelation(pairs) {
  const observations = toCompletePairs(pairs);
  const n = observations.length;

  if (n < 2) {
    return { n, r: null };
  }

  // Checked before any variance accumulation, so a constant variable is
  // reported as undefined rather than as a fabricated zero.
  if (
    hasConstantValue(observations, 0) ||
    hasConstantValue(observations, 1)
  ) {
    return { n, r: null };
  }

  const meanX =
    observations.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY =
    observations.reduce((sum, [, y]) => sum + y, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (const [x, y] of observations) {
    const deviationX = x - meanX;
    const deviationY = y - meanY;

    covariance += deviationX * deviationY;
    varianceX += deviationX * deviationX;
    varianceY += deviationY * deviationY;
  }

  const denominator = Math.sqrt(varianceX * varianceY);

  // Retained as defense in depth. A nonconstant variable has a genuinely
  // positive variance, so this is normally unreachable once the exact
  // constancy check above has run.
  if (denominator === 0) {
    return { n, r: null };
  }

  const r = covariance / denominator;

  if (!Number.isFinite(r)) {
    return { n, r: null };
  }

  return { n, r: roundTo(r, CORRELATION_PRECISION) };
}

module.exports = {
  CORRELATION_PRECISION,
  MEAN_PRECISION,
  MEDIAN_PRECISION,
  computeDescriptiveStatistics,
  computeMedian,
  computePearsonCorrelation,
  isFiniteNumber,
  roundTo
};
