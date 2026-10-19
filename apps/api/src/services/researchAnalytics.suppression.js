// Research Analytics V1 small-cohort suppression
// (specs/analytics-visualization-v1.md, sections 5.1, 5.2, 5.3, and 5.4).
//
// This module is an OPTIONAL post-summary transformation. It never participates
// in computing a statistic: `buildResearchAnalyticsSummary` keeps its exact
// one-argument behavior, and the pure statistics module stays free of privacy
// policy. Nothing here is called unless an exposure level was explicitly
// selected.
//
// Ordering (spec section 7, steps 3 and 4): the eligible participant array is
// filtered FIRST, the unchanged one-argument summary runs SECOND, and this
// transformation runs LAST. It therefore sees only the selected cohort.
//
// What this control is, stated honestly (spec section 5.4):
//   - It is a DISPLAY safeguard. Its purpose is to reduce the chance that a
//     small aggregate is read aloud on a projected screen or captured in a
//     manuscript screenshot.
//   - It is NOT a security boundary. An authorized administrator can already
//     download the de-identified participant CSV and recompute any subgroup
//     statistic offline, including for cohorts smaller than the threshold.
//   - Per-metric suppression alone does not prevent inference. A suppressed
//     subgroup can sometimes be reconstructed from the unfiltered mean and the
//     other visible subgroups, because the weights of every exposure level are
//     published in the distribution. Complementary suppression, an unfiltered
//     baseline threshold, and the CSV implications all require a separate,
//     institutionally approved policy.
//   - No institutional privacy policy is approved. Real student data must not
//     be displayed, projected, or screenshotted until that decision exists.
const MINIMUM_REPORTABLE_OBSERVATIONS = 5;

// Only these descriptive fields are disclosive. `n` is a count, is always
// preserved, and is deliberately not suppressed: without it a reader cannot
// tell "no observations" from "suppressed", which would make the response
// misleading rather than private.
const DESCRIPTIVE_SUPPRESSIBLE_FIELDS = Object.freeze([
  "mean",
  "median",
  "min",
  "max"
]);

function isObservationCount(value) {
  return Number.isInteger(value) && value >= 0;
}

// n below the threshold but above zero: valid observations exist, and their
// aggregate is disclosive. This is the only case that suppresses.
function isSuppressedObservationCount(n, minimumStatisticN) {
  return isObservationCount(n) && n > 0 && n < minimumStatisticN;
}

function isReportableObservationCount(n, minimumStatisticN) {
  return isObservationCount(n) && n >= minimumStatisticN;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A null value produced by the statistics layer (empty sample, or zero variance
// for a coefficient) is a FACT and is returned untouched. Only a genuinely
// disclosive small-n aggregate is replaced, and `n` is never altered.
function suppressDescriptiveStatistics(statistics, minimumStatisticN) {
  if (!isPlainObject(statistics)) {
    return { statistics, suppressed: false };
  }

  if (
    isReportableObservationCount(statistics.n, minimumStatisticN) ||
    !isSuppressedObservationCount(statistics.n, minimumStatisticN)
  ) {
    return { statistics, suppressed: false };
  }

  const suppressedStatistics = { ...statistics };

  for (const field of DESCRIPTIVE_SUPPRESSIBLE_FIELDS) {
    suppressedStatistics[field] = null;
  }

  return { statistics: suppressedStatistics, suppressed: true };
}

// Suppression is decided per relationship from that relationship's own valid
// pair count. Two valid pairs yield a Pearson coefficient of exactly +1 or -1,
// so a small pair count is disclosive in exactly the same way a small
// descriptive n is.
function suppressRelationship(relationship, minimumStatisticN) {
  if (!isPlainObject(relationship)) {
    return { relationship, suppressed: false };
  }

  if (!isSuppressedObservationCount(relationship.n, minimumStatisticN)) {
    return { relationship, suppressed: false };
  }

  return {
    relationship: { ...relationship, r: null },
    suppressed: true
  };
}

// Returns a new summary object; the input is never mutated. The returned
// `statisticsSuppressed` flag is true only when at least one value was
// actually suppressed, which keeps "suppressed" distinguishable from
// "no observations" (n === 0) for the presentation layer.
function applySmallCohortSuppression(
  summary,
  { minimumStatisticN = MINIMUM_REPORTABLE_OBSERVATIONS } = {}
) {
  if (!isPlainObject(summary)) {
    return { summary, statisticsSuppressed: false };
  }

  // A threshold must be a positive observation count. Anything else disables
  // suppression entirely rather than guessing at an intended policy.
  if (!isObservationCount(minimumStatisticN) || minimumStatisticN < 1) {
    return { summary, statisticsSuppressed: false };
  }

  const suppressedSummary = { ...summary };
  let statisticsSuppressed = false;

  const awareness = suppressDescriptiveStatistics(
    summary.awareness,
    minimumStatisticN
  );

  if (awareness.suppressed) {
    suppressedSummary.awareness = awareness.statistics;
    statisticsSuppressed = true;
  }

  const phishingIdentification = suppressDescriptiveStatistics(
    summary.phishingIdentification,
    minimumStatisticN
  );

  if (phishingIdentification.suppressed) {
    suppressedSummary.phishingIdentification =
      phishingIdentification.statistics;
    statisticsSuppressed = true;
  }

  if (isPlainObject(summary.relationships)) {
    let relationshipsChanged = false;
    const suppressedRelationships = {};

    for (const [key, relationship] of Object.entries(summary.relationships)) {
      const result = suppressRelationship(relationship, minimumStatisticN);

      if (result.suppressed) {
        relationshipsChanged = true;
        statisticsSuppressed = true;
      }

      suppressedRelationships[key] = result.relationship;
    }

    if (relationshipsChanged) {
      suppressedSummary.relationships = suppressedRelationships;
    }
  }

  return { summary: suppressedSummary, statisticsSuppressed };
}

module.exports = {
  DESCRIPTIVE_SUPPRESSIBLE_FIELDS,
  MINIMUM_REPORTABLE_OBSERVATIONS,
  applySmallCohortSuppression,
  isSuppressedObservationCount
};
