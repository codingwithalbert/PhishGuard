import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import ReportEvidence from "../components/reporting/ReportEvidence";
import {
  REPORT_REASON_OPTIONS
} from "../components/reporting/reportingUi";
import {
  createReport,
  getAnalyses,
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

function getAnalysisId(analysis) {
  const id = analysis?._id || analysis?.id;

  return typeof id === "string" ? id : null;
}

function isAnalysisSummary(analysis) {
  return Boolean(
    analysis &&
      typeof getAnalysisId(analysis) === "string" &&
      typeof analysis.url === "string" &&
      typeof analysis.risk === "string" &&
      Number.isFinite(analysis.score) &&
      Array.isArray(analysis.indicators) &&
      Array.isArray(analysis.findings)
  );
}

function isExistingReportReference(report) {
  return Boolean(
    report &&
      typeof report.id === "string" &&
      typeof report.analysisId === "string" &&
      typeof report.ticketNumber === "string"
  );
}

function isCreatedReport(report) {
  return Boolean(
    report &&
      typeof report.id === "string" &&
      typeof report.ticketNumber === "string"
  );
}

function findExistingReport(reports, analysisId) {
  if (!Array.isArray(reports) || !analysisId) {
    return null;
  }

  return (
    reports.find(
      (report) =>
        isExistingReportReference(report) &&
        String(report.analysisId) === String(analysisId)
    ) || null
  );
}

function ReportCreatePage() {
  const navigate = useNavigate();
  const { analysisId } = useParams();

  const [analysis, setAnalysis] = useState(null);
  const [existingReport, setExistingReport] = useState(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCreateData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAnalysis(null);
    setExistingReport(null);

    if (!analysisId) {
      setLoadError({
        message: "The Analysis selected for reporting is unavailable.",
        status: 404
      });
      setLoading(false);
      return;
    }

    const [analysesResult, reportsResult] = await Promise.allSettled([
      getAnalyses(),
      getOwnReports()
    ]);

    if (analysesResult.status === "fulfilled") {
      const analyses = Array.isArray(analysesResult.value?.analyses)
        ? analysesResult.value.analyses
        : [];
      const matchingAnalysis = analyses.find(
        (candidate) =>
          isAnalysisSummary(candidate) &&
          getAnalysisId(candidate) === String(analysisId)
      );

      if (matchingAnalysis) {
        setAnalysis(matchingAnalysis);
      } else {
        setLoadError({
          message:
            "The selected Analysis could not be found in your Analysis History.",
          status: 404
        });
      }
    } else {
      setLoadError(
        getErrorDetails(
          analysesResult.reason,
          "The selected Analysis could not be loaded."
        )
      );
    }

    if (reportsResult.status === "fulfilled") {
      setExistingReport(
        findExistingReport(
          Array.isArray(reportsResult.value?.reports)
            ? reportsResult.value.reports
            : [],
          analysisId
        )
      );
    }

    setLoading(false);
  }, [analysisId]);

  useEffect(() => {
    async function loadOnMount() {
      await loadCreateData();
    }

    loadOnMount();
  }, [loadCreateData]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting || !analysis) {
      return;
    }

    if (!reason) {
      setSubmitError({
        message: "Select a reason before submitting the Report.",
        status: 400
      });
      return;
    }

    if (details.length > 500) {
      setSubmitError({
        message: "Initial details must not exceed 500 characters.",
        status: 400
      });
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const data = await createReport({
        analysisId: getAnalysisId(analysis),
        reason,
        details: details.trim() || undefined
      });

      if (!isCreatedReport(data?.report)) {
        const formatError = new Error(
          "The created Report could not be read in the expected format."
        );

        formatError.status = 500;
        throw formatError;
      }

      navigate(`/reports/${encodeURIComponent(data.report.id)}`, {
        replace: true
      });
    } catch (error) {
      setSubmitError(
        getErrorDetails(
          error,
          "The Report could not be submitted. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  return (
    <main
      className="reports-page report-create-page"
      aria-busy={loading}
    >
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Report to school IT</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Report creation navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <ReportingNavLinks />
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      {loading ? (
        <section
          className="reports-state"
          role="status"
          aria-live="polite"
        >
          Loading the Analysis for reporting...
        </section>
      ) : loadError ? (
        <section className="reports-error-state" role="alert">
          <h2>
            {loadError.status === 404
              ? "Analysis not found"
              : "Analysis unavailable"}
          </h2>
          <p>{loadError.message}</p>

          {isSessionError(loadError) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : loadError.status === 404 ? (
            <Link to="/dashboard">Back to Dashboard</Link>
          ) : (
            <button type="button" onClick={loadCreateData}>
              Try again
            </button>
          )}
        </section>
      ) : analysis ? (
        <>
          <section className="awareness-intro reports-intro">
            <h1 className="awareness-page-title">Report to school IT</h1>
            <p>
              Submit this Analysis and its incident context to school IT for
              human investigation.
            </p>
            <p className="reports-intro-note">
              The automated URL result is heuristic evidence. Submitting a
              Report does not confirm that the URL is phishing, malicious, or
              safe.
            </p>
          </section>

          {existingReport && (
            <section className="report-existing-notice">
              <p>
                This Analysis already has a Report. Open the existing Report
                instead of submitting it again.
              </p>
              <Link
                className="report-card-action"
                to={`/reports/${encodeURIComponent(existingReport.id)}`}
              >
                View existing Report
              </Link>
            </section>
          )}

          <section className="report-create-section">
            <ReportEvidence analysisSnapshot={analysis} />
          </section>

          <section className="report-create-section">
            <h2>Report details</h2>

            <form
              className="report-create-form"
              onSubmit={handleSubmit}
            >
              <div className="report-form-field">
                <label htmlFor="report-reason">Reason</label>
                <select
                  id="report-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  disabled={submitting}
                >
                  <option value="">Select a reason</option>
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="report-form-field">
                <label htmlFor="report-details">
                  Initial details (optional)
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  maxLength={500}
                  disabled={submitting}
                />
                <p className="report-form-reminder">
                  Do not include passwords, MFA codes, authentication tokens,
                  or other authentication secrets.
                </p>
              </div>

              {submitError && (
                <div className="reports-inline-error" role="alert">
                  <p>{submitError.message}</p>

                  {isSessionError(submitError) ? (
                    <p>
                      <Link to="/login">Sign in again</Link>
                    </p>
                  ) : submitError.status === 409 ? (
                    existingReport ? (
                      <Link
                        to={`/reports/${encodeURIComponent(existingReport.id)}`}
                      >
                        Open existing Report
                      </Link>
                    ) : (
                      <Link to="/reports">Back to Reports</Link>
                    )
                  ) : null}
                </div>
              )}

              <div className="report-create-actions">
                <p>
                  The server creates the ticket number and preserves the
                  Analysis evidence at submission time.
                </p>
                <button
                  type="submit"
                  disabled={submitting || !reason}
                >
                  {submitting ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}

export default ReportCreatePage;
