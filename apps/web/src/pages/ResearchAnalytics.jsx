import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import {
  downloadResearchCsv,
  getResearchAnalytics
} from "../services/api";

const UNAVAILABLE_VALUE = "—";
const REQUEST_ERROR_MESSAGE =
  "The research analytics could not be loaded. Please try again.";
const EXPORT_ERROR_MESSAGE =
  "The research dataset could not be downloaded. Please try again.";
const RESPONSE_FORMAT_ERROR_MESSAGE =
  "The research analytics response could not be read in the expected format.";

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

const RELATIONSHIP_FIELDS = [
  [
    "awarenessPhishingIdentification",
    "Awareness Score and Phishing Identification Score"
  ],
  ["trainingExposureAwareness", "Training Exposure and Awareness Score"],
  [
    "trainingExposurePhishingIdentification",
    "Training Exposure and Phishing Identification Score"
  ]
];

// Rendered in a fixed order, using only the methodology text the backend
// supplies. Unknown or missing keys are skipped instead of invented.
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

function isDistributionEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    Number.isFinite(entry.trainingExposure) &&
    isNonNegativeInteger(entry.count)
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
    !data.trainingExposureDistribution.every(isDistributionEntry)
  ) {
    return false;
  }

  if (
    data.relationships === null ||
    typeof data.relationships !== "object" ||
    !RELATIONSHIP_FIELDS.every(([field]) =>
      isRelationship(data.relationships[field])
    )
  ) {
    return false;
  }

  return (
    data.methodology !== null &&
    typeof data.methodology === "object" &&
    !Array.isArray(data.methodology)
  );
}

function isSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
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

function StatisticTable({ title, description, statistics, labelledBy }) {
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
            <td>{formatValue(statistics.mean)}</td>
          </tr>
          <tr>
            <th scope="row">Median</th>
            <td>{formatValue(statistics.median)}</td>
          </tr>
          <tr>
            <th scope="row">Minimum</th>
            <td>{formatValue(statistics.min)}</td>
          </tr>
          <tr>
            <th scope="row">Maximum</th>
            <td>{formatValue(statistics.max)}</td>
          </tr>
        </tbody>
      </table>

      <p className="research-boundary-note">
        A dash means the backend reported no available observations for this
        statistic. Missing data is never shown as zero.
      </p>
    </section>
  );
}

function ResearchAnalyticsPage() {
  const navigate = useNavigate();

  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getResearchAnalytics();

      if (!isResearchAnalyticsResponse(data)) {
        const formatError = new Error(
          RESPONSE_FORMAT_ERROR_MESSAGE
        );

        formatError.status = 500;
        throw formatError;
      }

      setAnalytics(data);
    } catch (requestError) {
      setAnalytics(null);
      setError(
        getErrorDetails(requestError, REQUEST_ERROR_MESSAGE)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadAnalytics();
    }

    loadOnMount();
  }, [loadAnalytics]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
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
  // Only assessment results can be missing. Training Exposure is defined for
  // every eligible participant, so 0% is a valid value and not missing data.
  const isPartiallyPopulated =
    !hasNoParticipants &&
    cohort !== undefined &&
    (cohort.participantsWithAwareness <
      cohort.totalEligibleParticipants ||
      cohort.participantsWithPhishingIdentification <
        cohort.totalEligibleParticipants);

  return (
    <main className="awareness-page research-page" aria-busy={loading}>
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Research Analytics</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Research analytics navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <ReportingNavLinks />
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro research-intro">
        <h1 className="awareness-page-title">Research Analytics</h1>
        <p>
          Descriptive, aggregate research view of the three PhishGuard research
          variables: Awareness Score, Phishing Identification Score, and Training
          Exposure. Every value on this page is calculated and returned by the
          backend; this page does not recalculate or interpret any statistic.
        </p>
        <p className="research-intro-note">
          This view is available to administrators only, and the API enforces
          that restriction independently of this page. Results are descriptive
          and exploratory: an observed association does not establish causation,
          and missing participant measurements reduce the available sample
          sizes.
        </p>
      </section>

      {loading ? (
        <ResearchLoadingState />
      ) : error ? (
        <ResearchErrorState error={error} onRetry={loadAnalytics} />
      ) : analytics ? (
        <>
          {hasNoParticipants && (
            <section className="research-panel research-empty-state">
              <h2>No eligible participants yet</h2>
              <p>
                The research population is currently empty, so no statistics
                can be calculated. This is a valid state, not an error. Values
                will appear once active user accounts exist.
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

            <dl className="research-cohort-grid">
              {COHORT_FIELDS.map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{cohort[field]}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="research-statistics-grid">
            <StatisticTable
              labelledBy="research-awareness-heading"
              title="Awareness Score"
              description="Descriptive statistics for the latest completed Awareness Assessment of each eligible participant."
              statistics={analytics.awareness}
            />

            <StatisticTable
              labelledBy="research-phishing-heading"
              title="Phishing Identification Score"
              description="Descriptive statistics for the latest completed Phishing Identification Assessment of each eligible participant."
              statistics={analytics.phishingIdentification}
            />
          </div>

          <section
            className="research-panel"
            aria-labelledby="research-training-heading"
          >
            <h2 id="research-training-heading">
              Training Exposure distribution
            </h2>
            <p className="research-panel-note">
              Participant counts per Training Exposure level, exactly as
              returned by the backend. Training Exposure reflects recorded
              completion of the three fixed training modules and does not
              indicate assessed performance.
            </p>

            <table className="research-stat-table">
              <caption className="research-table-caption">
                Training Exposure levels and participant counts
              </caption>
              <thead>
                <tr>
                  <th scope="col">Training Exposure</th>
                  <th scope="col">Participants</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trainingExposureDistribution.map((entry) => (
                  <tr key={entry.trainingExposure}>
                    <th scope="row">
                      {entry.trainingExposure}%
                    </th>
                    <td>{entry.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section
            className="research-panel"
            aria-labelledby="research-relationships-heading"
          >
            <h2 id="research-relationships-heading">
              Observed relationships
            </h2>
            <p className="research-panel-note">
              Pearson correlation coefficients for the available participant
              measurements. Each relationship uses only participants who have
              values for both variables.
            </p>

            <table className="research-stat-table">
              <caption className="research-table-caption">
                Pairwise Pearson correlation values
              </caption>
              <thead>
                <tr>
                  <th scope="col">Variables compared</th>
                  <th scope="col">n</th>
                  <th scope="col">Pearson r</th>
                </tr>
              </thead>
              <tbody>
                {RELATIONSHIP_FIELDS.map(([field, label]) => {
                  const relationship = analytics.relationships[field];

                  return (
                    <tr key={field}>
                      <th scope="row">{label}</th>
                      <td>{relationship.n}</td>
                      <td>
                        {relationship.r === null
                          ? UNAVAILABLE_VALUE
                          : relationship.r}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="research-boundary-note">
              A dash means the backend could not calculate the coefficient for
              the available data, for example with fewer than two paired
              observations or no variation in one of the variables. The values
              describe associations only; they are not a measure of strength,
              significance, or causation, and this page does not rank or judge
              participants.
            </p>
          </section>

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
              small sample sizes, missing participant measurements,
              self-selected participation, repeated assessment attempts, the use
              of the latest attempt only, the limited number of Training
              Exposure levels, and the specific PhishGuard assessment
              instruments.
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
                The CSV export is de-identified. Participants appear only as
                transient pseudonymous identifiers that are generated for the
                research dataset, are not permanent account identifiers, and
                are not authentication identifiers.
              </li>
              <li>
                Removing direct identifiers does not remove the research value
                of the export. Handle the downloaded file as research data,
                store it only where research data is permitted, and do not
                attempt to re-identify participants.
              </li>
            </ul>
          </section>

          <section
            className="research-panel research-export-panel"
            aria-labelledby="research-export-heading"
          >
            <h2 id="research-export-heading">Dataset export</h2>
            <p className="research-panel-note">
              Download the de-identified participant-level research dataset as
              CSV. The file is generated by the backend; this page never builds
              participant rows itself.
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
