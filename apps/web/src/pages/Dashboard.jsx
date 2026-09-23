import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  analyzeUrl,
  deleteAnalysis,
  getAnalyses,
  updateAnalysis
} from "../services/api";

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