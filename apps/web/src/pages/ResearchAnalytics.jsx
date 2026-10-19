import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import ExposureLevelFilter, {
  ALL_EXPOSURE_LEVEL
} from "../components/research/ExposureLevelFilter";
import {
  AssessmentScoreComparisonChart,
  PearsonCorrelationChart,
  TrainingExposureDistributionChart
} from "../components/research/ResearchCharts";
import {
  describeMetricAvailability,
  METRIC_AVAILABILITY
} from "../components/research/researchChartUi";
import {
  downloadResearchCsv,
  getResearchAnalytics,
  safeProductError,
  toSafeErrorMessage
} from "../services/api";
import { isInvalidSessionError } from "../services/session";

const UNAVAILABLE_VALUE = "—";
const EXPOSURE_FILTER_ID = "research-exposure-level";
const REQUEST_ERROR_MESSAGE =
  "The research analytics could not be loaded. Please try again.";
const EXPORT_ERROR_MESSAGE =
  "The research dataset could not be downloaded. Please try again.";
const RESPONSE_FORMAT_ERROR_MESSAGE =
  "The research analytics response could not be read in the expected format.";
const RESPONSE_MISMATCH_MESSAGE =
  "The research analytics response did not describe the selected exposure level. Please try again.";

const COHORT_FIELDS = [
  ["totalEligibleParticipants", "Eligible participants"],
  ["participantsWithAwareness", "With an Awareness result"],
  [
    "participantsWithPhishingIdentification",
    "With a Phishing Identification result"
  ],
  ["participantsWithTrainingExposure", "With Training Exposure above 0%"],
  [
    "participantsWithFullTrainingExposure",
    "With 100% Training Exposure"
  ],
  [
    "participantsWithAllVariables",
    "With all three variables available"
  ]
];

const METHODOLOGY_FIELDS = [
  ["population", "Research population"],
  ["latestAttemptRule", "Assessment attempts"],
  ["trainingExposureRule", "Training Exposure"],
  ["missingDataRule", "Missing data"],
  ["statisticsRule", "Descriptive statistics"],
  ["relationshipRule", "Relationships"],
  ["interpretationRule", "Interpretation"],
  ["participantIdRule", "Participant identifiers"]
];

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNullableNumber(value) {
  return value === null || Number.isFinite(value);
}

function isDescriptiveStatistics(statistics) {
  return (
    statistics !== null &&
    typeof statistics === "object" &&
    isNonNegativeInteger(statistics.n) &&
    isNullableNumber(statistics.mean) &&
    isNullableNumber(statistics.median) &&
    isNullableNumber(statistics.min) &&
    isNullableNumber(statistics.max)
  );
}

function isRelationship(relationship) {
  return (
    relationship !== null &&
    typeof relationship === "object" &&
    Array.isArray(relationship.variables) &&
    relationship.variables.every(
      (variable) => typeof variable === "string"
    ) &&
    isNonNegativeInteger(relationship.n) &&
    (relationship.r === null || Number.isFinite(relationship.r))
  );
}

// Analytics Visualization V1: the canonical Training Exposure levels come from
// the backend and drive both the filter options and the distribution chart.
// Requiring them to be strictly ascending guarantees the fixed category order
// the charts depend on, rather than trusting response order implicitly.
function isCanonicalExposureLevels(levels) {
  return (
    Array.isArray(levels) &&
    levels.length > 0 &&
    levels.every((level) => Number.isFinite(level)) &&
    levels.every((level, index) => index === 0 || level > levels[index - 1])
  );
}

/*
 * The `filter` envelope is optional: the backend omits it when the parameter
 * was not supplied, which is exactly the unfiltered default state. When it is
 * present every value is validated before it is trusted, including the two
 * reporting fields that exist only for a selected level.
 */
function isFilterEnvelope(envelope) {
  if (envelope === undefined || envelope === null) {
    return true;
  }

  if (typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }

  if (
    typeof envelope.exposureLevel !== "string" ||
    typeof envelope.label !== "string" ||
    envelope.label.length === 0 ||
    typeof envelope.applied !== "boolean" ||
    typeof envelope.scope !== "string" ||
    envelope.scope.length === 0
  ) {
    return false;
  }

  if (
    envelope.applied &&
    (typeof envelope.statisticsSuppressed !== "boolean" ||
      !Number.isInteger(envelope.minimumStatisticN) ||
      envelope.minimumStatisticN < 1)
  ) {
    return false;
  }

  return true;
}

function isResearchAnalyticsResponse(data) {
  if (data?.success !== true) {
    return false;
  }

  const cohort = data.cohort;

  if (
    cohort === null ||
    typeof cohort !== "object" ||
    !COHORT_FIELDS.every(([field]) =>
      isNonNegativeInteger(cohort[field])
    )
  ) {
    return false;
  }

  if (
    !isDescriptiveStatistics(data.awareness) ||
    !isDescriptiveStatistics(data.phishingIdentification)
  ) {
    return false;
  }

  if (
    !Array.isArray(data.trainingExposureDistribution) ||
    !data.trainingExposureDistribution.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        Number.isFinite(entry.trainingExposure) &&
        isNonNegativeInteger(entry.count)
    )
  ) {
    return false;
  }

  if (
    data.relationships === null ||
    typeof data.relationships !== "object" ||
    !Object.values(data.relationships).every(isRelationship)
  ) {
    return false;
  }

  if (
    data.methodology === null ||
    typeof data.methodology !== "object" ||
    Array.isArray(data.methodology)
  ) {
    return false;
  }

  return (
    isCanonicalExposureLevels(data.methodology.trainingExposureLevels) &&
    isFilterEnvelope(data.filter)
  );
}

// The level a response actually describes, derived from the validated
// envelope. An absent envelope means the unfiltered cohort.
function getDescribedLevel(data) {
  if (data?.filter?.applied === true) {
    return data.filter.exposureLevel;
  }

  return ALL_EXPOSURE_LEVEL;
}

function isSessionError(error) {
  return isInvalidSessionError(error);
}

function getErrorDetails(error, fallback) {
  return {
    message: toSafeErrorMessage(error, fallback),
    status: error?.status
  };
}

function formatValue(value) {
  return value === null || value === undefined
    ? UNAVAILABLE_VALUE
    : String(value);
}

function ResearchLoadingState() {
  return (
    <section
      className="research-panel research-loading-panel"
      aria-label="Loading research analytics"
      aria-busy="true"
    >
      <div className="awareness-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <p className="awareness-status" role="status" aria-live="polite">
        Loading research analytics...
      </p>
    </section>
  );
}

function ResearchErrorState({ error, onRetry }) {
  return (
    <section className="research-panel research-error-panel" role="alert">
      <h2>Research analytics are unavailable</h2>
      <p>{error.message}</p>

      {isSessionError(error) ? (
        <p>
          <Link to="/login">Sign in again</Link>
        </p>
      ) : (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

/*
 * Suppression is reported here exactly as the charts report it. The previous
 * behaviour rendered every null as a dash, which made a deliberately withheld
 * statistic indistinguishable from one that was simply never available.
 * `n` is always shown, and the reason is stated once beneath the table rather
 * than repeated in every cell.
 */
function StatisticTable({
  title,
  description,
  statistics,
  labelledBy,
  context
}) {
  const availability = describeMetricAvailability(statistics, context ?? {});

  function renderValue(value) {
    if (availability.state === METRIC_AVAILABILITY.suppressed) {
      return "Suppressed";
    }

    if (availability.state === METRIC_AVAILABILITY.noObservations) {
      return "Not available";
    }

    return formatValue(value);
  }

  return (
    <section
      className="research-panel"
      aria-labelledby={labelledBy}
    >
      <h2 id={labelledBy}>{title}</h2>
      <p className="research-panel-note">{description}</p>

      <table className="research-stat-table">
        <caption className="research-table-caption">
          {title} values returned by the backend
        </caption>
        <thead>
          <tr>
            <th scope="col">Statistic</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Participants counted (n)</th>
            <td>{statistics.n}</td>
          </tr>
          <tr>
            <th scope="row">Mean</th>
            <td>{renderValue(statistics.mean)}</td>
          </tr>
          <tr>
            <th scope="row">Median</th>
            <td>{renderValue(statistics.median)}</td>
          </tr>
          <tr>
            <th scope="row">Minimum</th>
            <td>{renderValue(statistics.min)}</td>
          </tr>
          <tr>
            <th scope="row">Maximum</th>
            <td>{renderValue(statistics.max)}</td>
          </tr>
        </tbody>
      </table>

      {availability.state === METRIC_AVAILABILITY.suppressed ? (
        <p className="research-boundary-note">
          Suppressed — below minimum reporting size. This cohort has{" "}
          {statistics.n} valid observation{statistics.n === 1 ? "" : "s"},
          which is fewer than the minimum reporting size for a selected exposure
          level, so the values above are withheld. They are never shown as zero.
        </p>
      ) : availability.state === METRIC_AVAILABILITY.noObservations ? (
        <p className="research-boundary-note">
          Not available — no observations. No participant in this cohort has a
          recorded result for this assessment. Missing data is never shown as
          zero.
        </p>
      ) : (
        <p className="research-boundary-note">
          A dash means the backend reported no available observations for this
          statistic. Missing data is never shown as zero.
        </p>
      )}
    </section>
  );
}

function ResearchAnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(ALL_EXPOSURE_LEVEL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  // Stale-response protection. Every request takes a monotonically increasing
  // id, and a response is applied only when its id is still the newest. The
  // previous request is also aborted so a rapid filter change cannot leave an
  // earlier payload in flight long enough to overwrite a later selection.
  const latestRequestRef = useRef(0);
  const abortRef = useRef(null);

  const loadAnalytics = useCallback(async (level) => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller =
      typeof AbortController === "function" ? new AbortController() : null;

    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await getResearchAnalytics({
        exposureLevel: level,
        signal: controller?.signal
      });

      // A newer filter change has already been issued; discard this payload.
      if (latestRequestRef.current !== requestId) {
        return;
      }

      if (!isResearchAnalyticsResponse(data)) {
        throw safeProductError(RESPONSE_FORMAT_ERROR_MESSAGE, 500);
      }

      // Defence in depth against a mislabelled response: the payload must
      // describe the level that was requested.
      if (getDescribedLevel(data) !== level) {
        throw safeProductError(RESPONSE_MISMATCH_MESSAGE, 500);
      }

      setAnalytics(data);
    } catch (requestError) {
      if (latestRequestRef.current !== requestId) {
        return;
      }

      // An aborted request was superseded deliberately and is not a failure.
      if (requestError?.name === "AbortError") {
        return;
      }

      setAnalytics(null);
      setError(getErrorDetails(requestError, REQUEST_ERROR_MESSAGE));
    } finally {
      if (latestRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadAnalytics(selectedLevel);
    }

    loadOnMount();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [loadAnalytics, selectedLevel]);

  function handleLevelChange(level) {
    setSelectedLevel(level);
  }

  async function handleExport() {
    // Prevents repeated export actions while a download is in progress.
    if (exporting) {
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      await downloadResearchCsv();
    } catch (requestError) {
      setExportError(
        getErrorDetails(requestError, EXPORT_ERROR_MESSAGE)
      );
    } finally {
      setExporting(false);
    }
  }

  const cohort = analytics?.cohort;
  const hasNoParticipants = cohort?.totalEligibleParticipants === 0;
  const isFiltered =
    analytics !== null &&
    getDescribedLevel(analytics) !== ALL_EXPOSURE_LEVEL;
  const filterApplied =
    analytics?.filter?.applied === true &&
    isNonNegativeInteger(analytics?.filter?.minimumStatisticN);
  // Suppression metadata is only meaningful for a selected level. Absent
  // metadata is treated as "no minimum declared", never as a suppression.
  const minimumStatisticN = filterApplied
    ? analytics.filter.minimumStatisticN
    : null;

  // Only assessment results can be missing. Training Exposure is defined for
  // every eligible participant, so 0% is a valid value and not missing data.
  const isPartiallyPopulated =
    !hasNoParticipants &&
    cohort !== undefined &&
    (cohort.participantsWithAwareness <
      cohort.totalEligibleParticipants ||
      cohort.participantsWithPhishingIdentification <
        cohort.totalEligibleParticipants);

  const cohortScopeLabel = isFiltered
    ? analytics.filter.label
    : "All eligible participants";

  const chartContext = {
    filterApplied: isFiltered,
    minimumStatisticN
  };

  return (
    <main
      className="awareness-page research-page"
      id="main-content"
      tabIndex={-1}
      aria-busy={loading}
    >
      <PageHeader
        title="Research Analytics"
        description={
          <>
            <p>
              Descriptive, aggregate research view of the three PhishGuard
              research variables: Awareness Score, Phishing Identification
              Score, and Training Exposure. Every value on this page is
              calculated and returned by the backend; this page does not
              recalculate or interpret any statistic.
            </p>
            <p className="research-intro-note">
              This view is available to administrators only, and the API
              enforces that restriction independently of this page. Results are
              descriptive and exploratory: an observed association does not
              establish causation, and missing participant measurements reduce
              the available sample sizes.
            </p>
          </>
        }
      />

      <section
        className="research-panel research-filter-panel"
        aria-labelledby="research-filter-heading"
        aria-busy={loading}
      >
        <h2 id="research-filter-heading">Filter</h2>
        <p className="research-panel-note">
          Scope every count, chart and statistic below to one Training Exposure
          level. The filter is applied on the server before any aggregate is
          computed.
        </p>

        <ExposureLevelFilter
          id={EXPOSURE_FILTER_ID}
          levels={analytics?.methodology?.trainingExposureLevels ?? []}
          selectedLevel={selectedLevel}
          onChange={handleLevelChange}
          available={analytics !== null}
          loading={loading}
          stale={loading && analytics !== null}
          cohortSize={cohort?.totalEligibleParticipants ?? 0}
        />

        <p className="research-scope-line" aria-live="polite">
          Current scope: <strong>{cohortScopeLabel}</strong>
        </p>
      </section>

      {loading ? (
        <ResearchLoadingState />
      ) : error ? (
        <ResearchErrorState
          error={error}
          onRetry={() => loadAnalytics(selectedLevel)}
        />
      ) : analytics ? (
        <>
          {hasNoParticipants && (
            <section className="research-panel research-empty-state">
              <h2>
                {isFiltered
                  ? "No participants in this exposure cohort"
                  : "No eligible participants yet"}
              </h2>
              <p>
                {isFiltered
                  ? "No eligible account currently has this Training Exposure level, so no statistic can be calculated for it. This is a valid state, not an error. Choose another level or return to the whole cohort."
                  : "The research population is currently empty, so no statistics can be calculated. This is a valid state, not an error. Values will appear once active user accounts exist."}
              </p>
            </section>
          )}

          {isPartiallyPopulated && (
            <section className="research-panel research-partial-state">
              <h2>Some assessment results are missing</h2>
              <p>
                Not every eligible participant has a completed Awareness
                Assessment or Phishing Identification Assessment. Statistics and
                relationships use only the participants who have values for the
                variable being calculated, so their sample sizes can be smaller
                than the cohort.
              </p>
              <p>
                Training Exposure is different: it is recorded for every
                eligible participant, and a participant who has completed no
                training modules has a valid Training Exposure of 0%. That 0% is
                a measured value, not missing data.
              </p>
            </section>
          )}

          <section
            className="research-panel"
            aria-labelledby="research-cohort-heading"
          >
            <h2 id="research-cohort-heading">Cohort summary</h2>
            <p className="research-panel-note">
              Eligible participants are active accounts with the user role.
              Staff, admin, and inactive accounts are excluded.
            </p>
            <p className="research-scope-line">
              Within selected exposure cohort:{" "}
              <strong>{cohortScopeLabel}</strong>
            </p>

            <dl className="research-cohort-grid">
              {COHORT_FIELDS.map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{cohort[field]}</dd>
                </div>
              ))}
            </dl>

            {isFiltered && (
              <p className="research-boundary-note">
                Within a selected exposure cohort these two counts describe the
                selected level rather than the whole cohort, so they are
                determined by the filter: participants with Training Exposure
                above 0% is 0 at the 0% level and the cohort size at every other
                level, and participants with 100% Training Exposure is 0 at
                every level except 100%, where it is the cohort size.
              </p>
            )}
          </section>

          <div className="research-statistics-grid">
            <div className="research-table-scroll">
              <StatisticTable
                labelledBy="research-awareness-heading"
                title="Awareness Score"
                description={`Descriptive statistics for the latest completed Awareness Assessment of each participant in ${cohortScopeLabel}.`}
                statistics={analytics.awareness}
                context={chartContext}
              />
            </div>

            <div className="research-table-scroll">
              <StatisticTable
                labelledBy="research-phishing-heading"
                title="Phishing Identification Score"
                description={`Descriptive statistics for the latest completed Phishing Identification Assessment of each participant in ${cohortScopeLabel}.`}
                statistics={analytics.phishingIdentification}
                context={chartContext}
              />
            </div>
          </div>

          <TrainingExposureDistributionChart
            levels={analytics.methodology.trainingExposureLevels}
            distribution={analytics.trainingExposureDistribution}
            cohortSize={cohort.totalEligibleParticipants}
            withinSelectedCohort={isFiltered}
          />

          <AssessmentScoreComparisonChart
            awareness={analytics.awareness}
            phishingIdentification={analytics.phishingIdentification}
            context={chartContext}
          />

          <PearsonCorrelationChart
            relationships={analytics.relationships}
            context={chartContext}
          />

          <section
            className="research-panel"
            aria-labelledby="research-methodology-heading"
          >
            <h2 id="research-methodology-heading">
              Methodology and interpretation boundaries
            </h2>
            <p className="research-panel-note">
              These rules come from the backend methodology metadata that
              accompanies the analytics response.
            </p>

            <dl className="research-methodology-list">
              {METHODOLOGY_FIELDS.filter(
                ([field]) =>
                  typeof analytics.methodology[field] === "string"
              ).map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{analytics.methodology[field]}</dd>
                </div>
              ))}
            </dl>

            <p className="research-boundary-note">
              Limitations worth considering when reading these results include
              small sample sizes, missing participant measurements, repeated
              assessment attempts, the use of the latest attempt only, the
              limited number of Training Exposure levels, and the specific
              PhishGuard assessment instruments.
            </p>

            <p className="research-boundary-note">
              How the dataset is assembled is also a limitation. Every eligible
              student account is included automatically. No consent or voluntary
              participation mechanism exists yet, so no account holder has been
              asked to take part and no account can be excluded from these
              figures. Treat any value here as a description of the accounts that
              exist in the system, not as the result of a recruited research
              sample, and do not present it as a research finding until
              participation and consent have been established and approved.
            </p>
          </section>

          <section
            className="research-panel research-privacy-panel"
            aria-labelledby="research-privacy-heading"
          >
            <h2 id="research-privacy-heading">Privacy note</h2>
            <ul className="research-privacy-list">
              <li>
                This page contains aggregate research values only. It shows no
                participant identities, and it does not request or display any
                participant-level records.
              </li>
              <li>
                The CSV export uses pseudonymous participant identifiers.
                Participants appear only as transient research-dataset
                identifiers that are generated for the export, are not
                permanent account identifiers, and are not authentication
                identifiers.
              </li>
              <li>
                Removing direct identifiers does not remove the research value
                of the export. Handle the downloaded file as research data,
                store it only where research data is permitted, and do not
                attempt to re-identify participants.
              </li>
              <li>
                A selected exposure cohort can be small. Where the backend
                withholds a statistic because too few valid observations are
                available, this page shows the reason instead of the value and
                never substitutes zero. That safeguard limits what is displayed;
                it is not a guarantee that no inference is possible from the
                figures that remain.
              </li>
            </ul>
          </section>

          <section
            className="research-panel research-export-panel"
            aria-labelledby="research-export-heading"
          >
            <h2 id="research-export-heading">Dataset export</h2>
            <p className="research-panel-note">
              Download the pseudonymous participant-level research dataset as
              CSV. The file is generated by the backend and always contains the
              whole eligible cohort; the filter above does not change it. This
              page never builds participant rows itself.
            </p>

            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? "Preparing export..." : "Export CSV"}
            </button>

            {exporting && (
              <p
                className="awareness-status"
                role="status"
                aria-live="polite"
              >
                Downloading the research dataset...
              </p>
            )}

            {exportError && (
              <div
                className="research-export-error"
                role="alert"
              >
                <p>{exportError.message}</p>

                {isSessionError(exportError) ? (
                  <p>
                    <Link to="/login">Sign in again</Link>
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default ResearchAnalyticsPage;
