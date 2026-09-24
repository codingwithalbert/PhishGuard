import {
  useCallback,
  useEffect,
  useState
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  analyzeUrl,
  deleteAnalysis,
  getAnalyses,
  getDashboardSummary,
  updateAnalysis
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
  const navigate = useNavigate();

  const storedUser = localStorage.getItem("user");
  const user = storedUser ? JSON.parse(storedUser) : null;

  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);
  const [analyses, setAnalyses] = useState([]);
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

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

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

  async function handleStatusChange(id, status) {
    setError("");
    setMessage("");

    try {
      const data = await updateAnalysis(id, status);

      setAnalyses((current) =>
        current.map((analysis) => {
          const analysisId = analysis._id || analysis.id;

          return analysisId === id
            ? data.analysis
            : analysis;
        })
      );

      if ((result?._id || result?.id) === id) {
        setResult(data.analysis);
      }

      setMessage("Analysis status updated successfully.");
    } catch (err) {
      setError(err.message);
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

  return (
    <main>
      <header className="dashboard-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Phishing URL Analysis Dashboard</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Dashboard navigation"
        >
          <a href="#scanner">Scanner</a>
          <a href="#history">History</a>
          <Link to="/awareness">Awareness</Link>
          <Link to="/phishing-identification">Phishing Identification</Link>
          <Link to="/training">Training</Link>

          <span className="user-role">
            {user?.role || "user"}
          </span>

          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      {message && (
        <p className="success-message">
          {message}
        </p>
      )}

      {error && <p role="alert">{error}</p>}

      <section
        className="dashboard-overview"
        aria-labelledby="dashboard-overview-heading"
        aria-busy={summaryLoading}
      >
        <div className="dashboard-overview-heading">
          <div>
            <h2 id="dashboard-overview-heading">Welcome to your dashboard</h2>
            <p>
              Review your latest assessment results, training progress, and
              recent URL analysis activity.
            </p>
          </div>

          <span className="dashboard-overview-label">Activity overview</span>
        </div>

        {summaryLoading ? (
          <div
            className="dashboard-overview-loading"
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
          <div className="dashboard-overview-error" role="alert">
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
          <>
            <div className="dashboard-assessment-grid">
              <div className="dashboard-summary-card">
                <div className="dashboard-summary-card-heading">
                  <h3>Awareness Assessment</h3>
                  <span
                    className={`dashboard-summary-status ${
                      latestAwarenessAssessment !== null
                        ? "dashboard-summary-status-completed"
                        : "dashboard-summary-status-pending"
                    }`}
                  >
                    {latestAwarenessAssessment !== null
                      ? "Completed"
                      : "Not yet completed"}
                  </span>
                </div>

                {latestAwarenessAssessment !== null ? (
                  <>
                    <p className="dashboard-summary-score">
                      <span>Score</span>
                      <strong>
                        {latestAwarenessAssessment.score}
                      </strong>
                    </p>
                    <p className="dashboard-summary-detail">
                      {latestAwarenessAssessment.totalQuestions} questions
                      completed
                    </p>
                    <p className="dashboard-summary-detail">
                      Completed{" "}
                      <time dateTime={latestAwarenessAssessment.completedAt}>
                        {formatDate(latestAwarenessAssessment.completedAt)}
                      </time>
                    </p>
                  </>
                ) : (
                  <p className="dashboard-summary-empty">
                    No completed Awareness Assessment yet.
                  </p>
                )}

                <Link
                  className="dashboard-card-action"
                  to="/awareness"
                >
                  Open Awareness Assessment
                </Link>
              </div>

              <div className="dashboard-summary-card">
                <div className="dashboard-summary-card-heading">
                  <h3>Phishing Identification Assessment</h3>
                  <span
                    className={`dashboard-summary-status ${
                      latestPhishingIdentificationAssessment !== null
                        ? "dashboard-summary-status-completed"
                        : "dashboard-summary-status-pending"
                    }`}
                  >
                    {latestPhishingIdentificationAssessment !== null
                      ? "Completed"
                      : "Not yet completed"}
                  </span>
                </div>

                {latestPhishingIdentificationAssessment !== null ? (
                  <>
                    <p className="dashboard-summary-score">
                      <span>Score</span>
                      <strong>
                        {latestPhishingIdentificationAssessment.score}
                      </strong>
                    </p>
                    <p className="dashboard-summary-detail">
                      {
                        latestPhishingIdentificationAssessment.totalScenarios
                      }{" "}
                      scenarios completed
                    </p>
                    <p className="dashboard-summary-detail">
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
                    </p>
                  </>
                ) : (
                  <p className="dashboard-summary-empty">
                    No completed Phishing Identification Assessment yet.
                  </p>
                )}

                <Link
                  className="dashboard-card-action"
                  to="/phishing-identification"
                >
                  Open Phishing Identification Assessment
                </Link>
              </div>
            </div>

            <div className="dashboard-overview-lower-grid">
              <div className="dashboard-summary-card">
                <div className="dashboard-summary-card-heading">
                  <h3>Training</h3>
                  <span className="dashboard-summary-status">
                    Module completion
                  </span>
                </div>

                <div className="dashboard-training-stats">
                  <div>
                    <span>Completed modules</span>
                    <strong>
                      {trainingProgress.completedModules}
                    </strong>
                  </div>
                  <div>
                    <span>Total modules</span>
                    <strong>{trainingProgress.totalModules}</strong>
                  </div>
                  <div>
                    <span>Training Exposure</span>
                    <strong>
                      {trainingProgress.trainingExposure}%
                    </strong>
                  </div>
                </div>

                <Link className="dashboard-card-action" to="/training">
                  Open Training
                </Link>
              </div>

              <div className="dashboard-summary-card dashboard-analysis-summary-card">
                <div className="dashboard-summary-card-heading">
                  <h3>URL analyses</h3>
                  <span className="dashboard-summary-status">
                    Owned by you
                  </span>
                </div>

                <p className="dashboard-analysis-total">
                  <strong>{urlAnalyses.total}</strong> total URL analyses
                </p>

                <div className="dashboard-recent-heading">
                  <h4>Recent analyses</h4>
                  <span>Up to 5 most recent</span>
                </div>

                {urlAnalyses.recent.length === 0 ? (
                  <p className="dashboard-summary-empty">
                    No URL analyses yet. Use Analyze URL to start your history.
                  </p>
                ) : (
                  <ul className="dashboard-recent-list">
                    {urlAnalyses.recent.map((analysis) => (
                      <li
                        className="dashboard-recent-item"
                        key={analysis.id}
                      >
                        <div className="dashboard-recent-item-top">
                          <span className="dashboard-recent-url">
                            {analysis.url}
                          </span>
                          <span
                            className={`risk risk-${analysis.risk}`}
                          >
                            {analysis.risk.toUpperCase()}
                          </span>
                        </div>

                        <div className="dashboard-recent-item-meta">
                          <span>Score: {analysis.score}</span>
                          <span>Status: {analysis.status}</span>
                          <time dateTime={analysis.createdAt}>
                            {formatDate(analysis.createdAt)}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <a className="dashboard-card-action" href="#history">
                  Review Analysis History
                </a>
              </div>
            </div>
          </>
        ) : null}

        <nav
          className="dashboard-quick-actions"
          aria-label="Dashboard quick actions"
        >
          <h3>Quick actions</h3>

          <ul>
            <li>
              <a href="#scanner">Analyze URL</a>
            </li>
            <li>
              <a href="#history">Review History</a>
            </li>
            <li>
              <Link to="/awareness">Awareness Assessment</Link>
            </li>
            <li>
              <Link to="/phishing-identification">
                Phishing Identification Assessment
              </Link>
            </li>
            <li>
              <Link to="/training">Training</Link>
            </li>
          </ul>
        </nav>
      </section>

      <section id="scanner">
        <h2>Analyze a URL</h2>

        <p>
          Enter a suspicious URL to check it for phishing indicators.
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
        <section className="result-section">
          <h2>Analysis Result</h2>

          <p>
            <strong>URL:</strong> {result.url}
          </p>

          <p>
            <strong>Risk:</strong>{" "}
            <span className={`risk risk-${result.risk}`}>
              {result.risk.toUpperCase()}
            </span>
          </p>

          <p>
            <strong>Score:</strong> {result.score}
          </p>

          <p>
            <strong>Status:</strong> {result.status}
          </p>

          <h3>Detected Indicators</h3>

          {result.indicators.length > 0 ? (
            <ul>
              {result.indicators.map((indicator) => (
                <li key={indicator}>{indicator}</li>
              ))}
            </ul>
          ) : (
            <p>No suspicious indicators were detected.</p>
          )}
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

        {historyLoading ? (
          <p>Loading analysis history...</p>
        ) : analyses.length === 0 ? (
          <p>No analyses yet.</p>
        ) : (
          <div className="history-grid">
            {analyses.map((analysis) => {
              const analysisId = analysis._id || analysis.id;

              return (
                <article key={analysisId}>
                  <div className="history-card-heading">
                    <h3>{analysis.url}</h3>

                    <span
                      className={`risk risk-${analysis.risk}`}
                    >
                      {analysis.risk.toUpperCase()}
                    </span>
                  </div>

                  <p>
                    <strong>Score:</strong> {analysis.score}
                  </p>

                  <div className="status-control">
                    <label htmlFor={`status-${analysisId}`}>
                      Status
                    </label>

                    <select
                      id={`status-${analysisId}`}
                      value={analysis.status}
                      onChange={(event) =>
                        handleStatusChange(
                          analysisId,
                          event.target.value
                        )
                      }
                    >
                      <option value="active">Active</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>

                  <p className="created-date">
                    <strong>Created:</strong>{" "}
                    {new Date(
                      analysis.createdAt
                    ).toLocaleString()}
                  </p>

                  <button
                    type="button"
                    onClick={() => handleDelete(analysisId)}
                  >
                    Delete
                  </button>
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