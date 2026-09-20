import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
      <header>
        <div>
          <h1>PhishGuard Dashboard</h1>

          <p>
            Welcome{user?.name ? `, ${user.name}` : ""}.
          </p>
        </div>

        <button type="button" onClick={handleLogout}>
          Logout
        </button>
      </header>

      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}

      <section>
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
        <section>
          <h2>Analysis Result</h2>

          <p>
            <strong>URL:</strong> {result.url}
          </p>

          <p>
            <strong>Risk:</strong> {result.risk.toUpperCase()}
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

      <section>
        <h2>Analysis History</h2>

        {historyLoading ? (
          <p>Loading analysis history...</p>
        ) : analyses.length === 0 ? (
          <p>No analyses yet.</p>
        ) : (
          <div>
            {analyses.map((analysis) => {
              const analysisId = analysis._id || analysis.id;

              return (
                <article key={analysisId}>
                  <h3>{analysis.url}</h3>

                  <p>
                    <strong>Risk:</strong>{" "}
                    {analysis.risk.toUpperCase()}
                  </p>

                  <p>
                    <strong>Score:</strong> {analysis.score}
                  </p>

                  <div>
                    <label htmlFor={`status-${analysisId}`}>
                      <strong>Status:</strong>
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

                  <p>
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