/*
 * Derivation helpers for Analytics Visualization V1 charts.
 *
 * Every value rendered by a chart is read from the API response. This module
 * only decides formatting and, critically, WHY a statistic is unavailable. It
 * never computes, imputes, or infers a statistic.
 *
 * Two rules are load bearing:
 *
 * 1. Canonical Training Exposure percentages are never duplicated here. They
 *    come from `methodology.trainingExposureLevels`, which the backend owns, so
 *    a label can never drift away from the value it describes.
 *
 * 2. An unavailable statistic is never rendered as zero. A mean of 0% and a
 *    mean that could not be calculated are very different statements, and a
 *    zero-length bar would present the second as the first. Each unavailable
 *    state therefore carries its own explicit reason.
 */

export const METRIC_AVAILABILITY = Object.freeze({
  available: "available",
  suppressed: "suppressed",
  noObservations: "no-observations",
  undefined: "undefined"
});

export const EXPOSURE_VARIABLE = "trainingExposure";

// One decimal place, matching the canonical display used by the backend
// envelope. Deriving it this way means 0, 33.33, 66.67 and 100 render as
// "0%", "33.3%", "66.7%" and "100%" without a single literal percent here.
export function formatExposureLabel(trainingExposure) {
  if (!Number.isFinite(trainingExposure)) {
    return null;
  }

  return `${Number(trainingExposure.toFixed(1))}%`;
}

// Filter option values are positional: option "0" is the first canonical level.
// The API contract accepts the completed-module count, which is the index into
// the canonical level list.
export function buildExposureLevelOptions(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    return [];
  }

  return levels.map((trainingExposure, index) => ({
    value: String(index),
    percent: trainingExposure,
    label: formatExposureLabel(trainingExposure)
  }));
}

// Guarantees every canonical category is present, including the ones the
// backend reports with a count of zero, and preserves the canonical order.
export function normalizeExposureDistribution(levels, distribution) {
  if (!Array.isArray(levels)) {
    return [];
  }

  const countByPercent = new Map();

  if (Array.isArray(distribution)) {
    for (const entry of distribution) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        Number.isFinite(entry.trainingExposure) &&
        Number.isInteger(entry.count)
      ) {
        countByPercent.set(entry.trainingExposure, entry.count);
      }
    }
  }

  return levels.map((trainingExposure) => ({
    percent: trainingExposure,
    label: formatExposureLabel(trainingExposure),
    count: countByPercent.get(trainingExposure) ?? 0
  }));
}

// The backend reports valid observation counts and, for a selected exposure
// level, a minimum reporting size. Those two values together are the only
// signal that distinguishes a deliberately suppressed statistic from a
// statistic that was simply never available.
function getMinimumStatisticN(context) {
  const minimum = context?.minimumStatisticN;

  return Number.isInteger(minimum) && minimum > 0 ? minimum : null;
}

/*
 * Descriptive statistics (Awareness Score, Phishing Identification Score).
 *
 * `n === 0` means nobody completed the assessment. That is a fact about the
 * cohort, not a privacy decision, so it is reported as no observations and
 * never as suppressed. Only `0 < n < minimumStatisticN` is a suppression.
 */
export function describeMetricAvailability(statistics, context = {}) {
  const n = statistics?.n;
  const minimumStatisticN = getMinimumStatisticN(context);

  if (Number.isInteger(n) && minimumStatisticN !== null && n > 0 && n < minimumStatisticN) {
    return {
      state: METRIC_AVAILABILITY.suppressed,
      message: "Suppressed — below minimum reporting size"
    };
  }

  if (Number.isInteger(n) && n === 0) {
    return {
      state: METRIC_AVAILABILITY.noObservations,
      message: "Not available — no observations"
    };
  }

  if (!Number.isFinite(statistics?.mean)) {
    return {
      state: METRIC_AVAILABILITY.undefined,
      message: "Not available"
    };
  }

  return {
    state: METRIC_AVAILABILITY.available,
    message: null
  };
}

/*
 * Pearson coefficients.
 *
 * Two distinct reasons produce a null coefficient and they must never be
 * conflated, because they mean different things to a reader:
 *
 *   - a suppressed statistic, withheld because too few valid pairs were
 *     available to report safely;
 *   - an undefined coefficient, which is what a constant variable produces.
 *     Selecting one exposure level makes Training Exposure constant by
 *     construction, so both exposure relationships are undefined by
 *     definition, not by accident.
 */
export function describeCoefficientAvailability(relationship, context = {}) {
  const n = relationship?.n;
  const minimumStatisticN = getMinimumStatisticN(context);
  const isExposureRelationship = isExposureRelationshipKey(relationship);
  const filterApplied = context?.filterApplied === true;

  if (Number.isInteger(n) && minimumStatisticN !== null && n > 0 && n < minimumStatisticN) {
    return {
      state: METRIC_AVAILABILITY.suppressed,
      message: "Suppressed — below minimum reporting size"
    };
  }

  if (filterApplied && isExposureRelationship) {
    return {
      state: METRIC_AVAILABILITY.undefined,
      message: "Not available — exposure is constant in this cohort"
    };
  }

  if (Number.isInteger(n) && n === 0) {
    return {
      state: METRIC_AVAILABILITY.noObservations,
      message: "Not available — no paired observations"
    };
  }

  if (!Number.isFinite(relationship?.r)) {
    return {
      state: METRIC_AVAILABILITY.undefined,
      message: "Not available"
    };
  }

  return {
    state: METRIC_AVAILABILITY.available,
    message: null
  };
}

// Derived from the variables the backend reports rather than from key names, so
// the frontend never hard-codes the relationship identifiers.
export function isExposureRelationshipKey(relationship) {
  const variables = relationship?.variables;

  return (
    Array.isArray(variables) &&
    variables.some((variable) => variable === EXPOSURE_VARIABLE)
  );
}

/*
 * A signed coefficient is always labelled with an explicit sign so the sign is
 * never conveyed by bar direction or color alone. An exact zero is rendered as
 * "0.000" with no sign, because neither "+0.000" nor "-0.000" would be true.
 */
export function formatSignedCoefficient(coefficient) {
  if (!Number.isFinite(coefficient)) {
    return null;
  }

  const absolute = Math.abs(coefficient);

  if (absolute === 0) {
    return coefficient.toFixed(3);
  }

  return `${coefficient > 0 ? "+" : "-"}${absolute.toFixed(3)}`;
}

// The backend rounds means to two decimals; this only appends the unit.
export function formatScorePercent(statistics) {
  if (!Number.isFinite(statistics?.mean)) {
    return null;
  }

  return `${Number(statistics.mean.toFixed(2))}%`;
}

// Shares are computed against the cohort actually on screen, and are only
// meaningful when that cohort is non-empty.
export function formatShare(count, total) {
  if (!Number.isInteger(count) || !Number.isInteger(total) || total <= 0) {
    return null;
  }

  return `${((count / total) * 100).toFixed(1)}%`;
}
