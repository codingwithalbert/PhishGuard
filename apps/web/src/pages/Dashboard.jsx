import {
  useCallback,
  useEffect,
  useState
} from "react";
import { Link } from "react-router-dom";
import AnalysisFindings from "../components/AnalysisFindings";
import PageHeader from "../components/PageHeader";
import {
  getValidFindings as getFindings
} from "../components/reporting/reportingUi";
import {
  analyzeUrl,
  deleteAnalysis,
  getAnalyses,
  getDashboardSummary,
  getOwnReports
} from "../services/api";

function isSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
    status: error?.status
  };
}

function getResultFindingsMessage(analysis) {
  if (!Array.isArray(analysis?.findings)) {
    return "Structured findings are not available for this result.";
  }

  if (analysis.findings.length === 0) {
    return "No findings were returned. No suspicious characteristics covered by the current heuristic checks were detected.";
  }

  return "No valid structured findings are available for this result.";
}

function getHistoryFindingsMessage(analysis) {
  if (!Array.isArray(analysis?.findings)) {
    return "Structured findings are not available for this legacy analysis.";
  }

  if (analysis.findings.length === 0) {
    return "No structured findings were returned. Some legacy indicators may not have explanations.";
  }

  return "No valid structured findings are available for this analysis.";
}

function getRiskContext(risk) {
  switch (risk) {
    case "low":
      return "Few or none of the characteristics covered by PhishGuard's current heuristic checks were detected.";
    case "medium":
      return "Some characteristics detected by PhishGuard warrant additional caution.";
    case "high":
      return "Multiple or strongly weighted characteristics detected by PhishGuard warrant additional caution.";
    default:
      return "This assessment reflects the characteristics covered by PhishGuard's current heuristic checks.";
  }
}

function formatDate(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();
}

function isAssessmentSummary(value, totalKey) {
  return (
    value === null ||
    (value &&
      Number.isFinite(value.score) &&
      Number.isFinite(value[totalKey]) &&
      typeof value.completedAt === "string")
  );
}

function isDashboardSummary(data) {
  const trainingProgress = data?.trainingProgress;
  const urlAnalyses = data?.urlAnalyses;

  return (
    data?.success === true &&
    isAssessmentSummary(data.latestAwarenessAssessment, "totalQuestions") &&
    isAssessmentSummary(
      data.latestPhishingIdentificationAssessment,
      "totalScenarios"
    ) &&
    trainingProgress &&
    Number.isFinite(trainingProgress.completedModules) &&
    Number.isFinite(trainingProgress.totalModules) &&
    Number.isFinite(trainingProgress.trainingExposure) &&
    urlAnalyses &&
    Number.isInteger(urlAnalyses.total) &&
    urlAnalyses.total >= 0 &&
    Array.isArray(urlAnalyses.recent) &&
    urlAnalyses.recent.every(
      (analysis) =>
        analysis &&
        typeof analysis.id === "string" &&
        typeof analysis.url === "string" &&
        typeof analysis.risk === "string" &&
        Number.isFinite(analysis.score) &&
        typeof analysis.status === "string" &&
        typeof analysis.createdAt === "string"
    )
  );
}

function Dashboard() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);
  const [analyses, setAnalyses] = useState([]);
  const [ownReports, setOwnReports] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);

  const loadDashboardSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);

    try {
      const data = await getDashboardSummary();

      if (!isDashboardSummary(data)) {
        throw new Error(
          "The dashboard summary could not be read in the expected format."
        );
      }

      setSummary(data);
    } catch (err) {
      setSummaryError(
        getErrorDetails(
          err,
          "The dashboard summary could not be loaded. Please try again."
        )
      );
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadDashboardSummary();
    }

    loadOnMount();
  }, [loadDashboardSummary]);

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await getAnalyses();
        setAnalyses(data.analyses);
      } catch (err) {
        setError(err.message);
      } finally {
        setHistoryLoading(false);
      }
    }

    loadHistory();
  }, []);

  useEffect(() => {
    async function loadExistingReports() {
      try {
        const data = await getOwnReports();

        if (Array.isArray(data?.reports)) {
          setOwnReports(data.reports);
        }
      } catch {
        // Reporting actions remain available if this convenience lookup fails.
      }
    }

    loadExistingReports();
  }, []);

  async function handleAnalyze(event) {
    event.preventDefault();

    setError("");
    setMessage("");
    setResult(null);
    setLoading(true);

    try {
      const data = await analyzeUrl(url);

      setResult(data.analysis);

      setAnalyses((current) => [
        data.analysis,
        ...current
      ]);

      setUrl("");
      setMessage("URL analyzed successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this analysis?"
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await deleteAnalysis(id);

      setAnalyses((current) =>
        current.filter((analysis) => {
          const analysisId = analysis._id || analysis.id;
          return analysisId !== id;
        })
      );

      if ((result?._id || result?.id) === id) {
        setResult(null);
      }

      setMessage("Analysis deleted successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  const latestAwarenessAssessment = summary?.latestAwarenessAssessment;
  const latestPhishingIdentificationAssessment =
    summary?.latestPhishingIdentificationAssessment;
  const trainingProgress = summary?.trainingProgress;
  const urlAnalyses = summary?.urlAnalyses;
  const reportedReportsByAnalysisId = new Map(
    ownReports
      .filter(
        (report) =>
          report &&
          typeof report.id === "string" &&
          typeof report.analysisId === "string"
      )
      .map((report) => [String(report.analysisId), report])
  );

  return (
    <main id="main-content">
      {message && (
        <p className="success-message">
          {message}
        </p>
      )}

      {error && <p role="alert">{error}</p>}

      <PageHeader
        title="Dashboard"
        description="Review your learning status, analyze a suspicious URL, and check your analysis history."
      />

      <section
        className="dashboard-status"
        aria-label="Your progress"
        aria-busy={summaryLoading}
      >
        {summaryLoading ? (
          <div
            className="dashboard-status-loading"
            role="status"
            aria-live="polite"
          >
            <div className="awareness-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="awareness-status">Loading dashboard summary...</p>
          </div>
        ) : summaryError ? (
          <div className="dashboard-status-error" role="alert">
            <p>{summaryError.message}</p>

            {isSessionError(summaryError) ? (
              <p>
                <Link to="/login">Sign in again</Link>
              </p>
            ) : (
              <button type="button" onClick={loadDashboardSummary}>
                Try again
              </button>
            )}
          </div>
        ) : summary ? (
          <div className="dashboard-status-grid">
            <div className="dashboard-status-item">
              <span className="dashboard-status-label">
                Awareness Assessment
              </span>

              {latestAwarenessAssessment !== null ? (
                <>
                  <span className="dashboard-status-value">
                    {latestAwarenessAssessment.score}%<span className="dashboard-status-value-total"> · {latestAwarenessAssessment.totalQuestions} questions</span>
                  </span>
                  <span className="dashboard-status-meta">
                    Completed{" "}
                    <time dateTime={latestAwarenessAssessment.completedAt}>
                      {formatDate(latestAwarenessAssessment.completedAt)}
                    </time>
                  </span>
                </>
              ) : (
                <span className="dashboard-status-value dashboard-status-value-pending">
                  Not yet completed
                </span>
              )}

              <Link className="dashboard-status-link" to="/awareness">
                Open assessment
              </Link>
            </div>

            <div className="dashboard-status-item">
              <span className="dashboard-status-label">
                Phishing Identification
              </span>

              {latestPhishingIdentificationAssessment !== null ? (
                <>
                  <span className="dashboard-status-value">
                    {latestPhishingIdentificationAssessment.score}%<span className="dashboard-status-value-total"> · {latestPhishingIdentificationAssessment.totalScenarios} scenarios</span>
                  </span>
                  <span className="dashboard-status-meta">
                    Completed{" "}
                    <time
                      dateTime={
                        latestPhishingIdentificationAssessment.completedAt
                      }
                    >
                      {formatDate(
                        latestPhishingIdentificationAssessment.completedAt
                      )}
                    </time>
                  </span>
                </>
              ) : (
                <span className="dashboard-status-value dashboard-status-value-pending">
                  Not yet completed
                </span>
              )}

              <Link
                className="dashboard-status-link"
                to="/phishing-identification"
              >
                Open assessment
              </Link>
            </div>

            <div className="dashboard-status-item">
              <span className="dashboard-status-label">Training</span>
              <span className="dashboard-status-value">
                {trainingProgress.completedModules}
                <span className="dashboard-status-value-total">
                  {" "}/ {trainingProgress.totalModules} modules
                </span>
              </span>
              <span className="dashboard-status-meta">
                Training Exposure {trainingProgress.trainingExposure}%
              </span>
              <Link className="dashboard-status-link" to="/training">
                Open training
              </Link>
            </div>

            <div className="dashboard-status-item">
              <span className="dashboard-status-label">URL analyses</span>
              <span className="dashboard-status-value">
                {urlAnalyses.total}
                <span className="dashboard-status-value-total"> total</span>
              </span>

              {urlAnalyses.recent.length === 0 ? (
                <span className="dashboard-status-meta">
                  No URL analyses yet. Use Analyze URL to start your history.
                </span>
              ) : (
                <ul className="dashboard-status-recent">
                  {urlAnalyses.recent.map((analysis) => (
                    <li key={analysis.id}>
                      <span
                        className={`risk risk-${analysis.risk}`}
                      >
                        {analysis.risk.toUpperCase()}
                      </span>
                      <span className="dashboard-status-recent-url">
                        {analysis.url}
                      </span>
                      <span className="dashboard-status-recent-meta">
                        <span>Score {analysis.score}</span>
                        <time dateTime={analysis.createdAt}>
                          {formatDate(analysis.createdAt)}
                        </time>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <a className="dashboard-status-link" href="#history">
                Review history
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <section id="scanner" className="scanner-section">
        <h2>Analyze a URL</h2>

        <p>
          Enter a URL to review the characteristics covered by PhishGuard's
          heuristic checks.
        </p>

        <form onSubmit={handleAnalyze}>
          <label htmlFor="url">URL</label>

          <input
            id="url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? "Analyzing..." : "Analyze URL"}
          </button>
        </form>
      </section>

      {result && (
        <section
          className="result-section"
          aria-labelledby="analysis-result-heading"
        >
          <div className="result-section-heading">
            <div>
              <h2 id="analysis-result-heading">Analysis Result</h2>
              <p>
                Review the characteristics covered by PhishGuard's
                heuristic checks.
              </p>
            </div>
          </div>

          <div className="result-summary">
            <p className="result-url">
              <strong>URL:</strong> {result.url}
            </p>

            <div className="result-metrics">
              <p>
                <strong>Risk:</strong>{" "}
                <span className={`risk risk-${result.risk}`}>
                  {result.risk.toUpperCase()}
                </span>
              </p>

              <p>
                <strong>Heuristic score:</strong>{" "}
                <span className="result-score-value">
                  {result.score}
                </span>
              </p>
            </div>
          </div>

          <div className="analysis-context">
            <p className="analysis-heuristic-note">
              PhishGuard evaluates URL characteristics with heuristic
              checks. This result is not definitive proof that a URL is
              safe, phishing, or malicious.
            </p>
            <p className="analysis-risk-context">
              {getRiskContext(result.risk)}
            </p>
          </div>

          <div className="analysis-findings">
            <h3>Detected findings</h3>
            <AnalysisFindings
              findings={getFindings(result)}
              emptyMessage={getResultFindingsMessage(result)}
            />
          </div>

          <div className="analysis-indicators">
            <h3>Detected indicators</h3>

            {result.indicators.length > 0 ? (
              <ul>
                {result.indicators.map((indicator) => (
                  <li key={indicator}>{indicator}</li>
                ))}
              </ul>
            ) : (
              <p>No suspicious indicators were detected.</p>
            )}
          </div>

          <aside
            className="analysis-guidance"
            aria-labelledby="analysis-guidance-heading"
          >
            <h3 id="analysis-guidance-heading">Defensive guidance</h3>
            <ul>
              <li>Verify the destination independently when uncertain.</li>
              <li>
                Avoid entering credentials or sensitive information when a
                destination appears suspicious.
              </li>
              <li>
                Use a known official website or trusted bookmark when
                possible.
              </li>
            </ul>
          </aside>
        </section>
      )}

      <section id="history">
        <div className="section-heading">
          <div>
            <h2>Analysis History</h2>
            <p>
              Review and manage your previously analyzed URLs.
            </p>
          </div>

          <span className="history-count">
            {analyses.length}{" "}
            {analyses.length === 1 ? "scan" : "scans"}
          </span>
        </div>

        <p className="analysis-heuristic-note history-disclaimer">
          Historical results are heuristic assessments. They are not
          definitive proof that a URL is safe, phishing, or malicious.
        </p>

        {historyLoading ? (
          <p>Loading analysis history...</p>
        ) : analyses.length === 0 ? (
          <p>No analyses yet.</p>
        ) : (
          <div className="history-grid">
            {analyses.map((analysis) => {
              const analysisId = analysis._id || analysis.id;
              const findings = getFindings(analysis);
              const findingsMessage =
                getHistoryFindingsMessage(analysis);
              const existingReport =
                reportedReportsByAnalysisId.get(String(analysisId));

              return (
                <article
                  className="history-card"
                  key={analysisId}
                >
                  <div className="history-card-heading">
                    <h3>{analysis.url}</h3>

                    <span
                      className={`risk risk-${analysis.risk}`}
                    >
                      {analysis.risk.toUpperCase()}
                    </span>
                  </div>

                  <p className="history-card-meta">
                    <span>
                      <strong>Score:</strong> {analysis.score}
                    </span>
                    <time dateTime={analysis.createdAt}>
                      {new Date(
                        analysis.createdAt
                      ).toLocaleString()}
                    </time>
                  </p>

                  <div className="history-findings">
                    <h4>Findings</h4>
                    <AnalysisFindings
                      findings={findings}
                      emptyMessage={findingsMessage}
                    />
                  </div>

                  <div className="history-indicators">
                    <h4>Indicators</h4>

                    {Array.isArray(analysis.indicators) && analysis.indicators.length > 0 ? (
                      <ul>
                        {analysis.indicators.map((indicator) => (
                          <li key={indicator}>{indicator}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No suspicious indicators were detected.</p>
                    )}
                  </div>

                  <div className="history-card-actions">
                    {existingReport ? (
                      <Link
                        className="history-report-action"
                        to={`/reports/${encodeURIComponent(existingReport.id)}`}
                      >
                        View Report
                      </Link>
                    ) : (
                      <Link
                        className="history-report-action"
                        to={`/reports/new/${encodeURIComponent(analysisId)}`}
                      >
                        Report to IT
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(analysisId)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default Dashboard;
