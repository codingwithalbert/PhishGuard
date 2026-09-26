import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import { getOwnReports } from "../services/api";
import {
  formatReportingDate,
  getReportAssessmentLabel,
  getReportPriorityLabel,
  getReportReasonLabel,
  getReportStatusLabel
} from "../components/reporting/reportingUi";

function isSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
    status: error?.status
  };
}

function isReportSummary(report) {
  const snapshot = report?.analysisSnapshot;

  return Boolean(
    report &&
      typeof report.id === "string" &&
      typeof report.ticketNumber === "string" &&
      typeof report.reason === "string" &&
      typeof report.status === "string" &&
      typeof report.priority === "string" &&
      typeof report.assessment === "string" &&
      (report.details === null ||
        typeof report.details === "string") &&
      (report.createdAt === null ||
        typeof report.createdAt === "string") &&
      snapshot &&
      typeof snapshot === "object" &&
      typeof snapshot.url === "string" &&
      Array.isArray(snapshot.indicators) &&
      Array.isArray(snapshot.findings)
  );
}

function isReportsResponse(data) {
  return (
    data?.success === true &&
    Array.isArray(data.reports) &&
    data.reports.every(isReportSummary)
  );
}

function getStatusClassName(status) {
  if (status === "completed") {
    return "report-status-badge report-status-completed";
  }

  if (status === "under_review") {
    return "report-status-badge report-status-under-review";
  }

  return "report-status-badge report-status-submitted";
}

function getAssignmentText(assignedTo) {
  if (!assignedTo || typeof assignedTo.name !== "string") {
    return "Not assigned";
  }

  if (
    typeof assignedTo.role === "string" &&
    assignedTo.role.length > 0
  ) {
    return `${assignedTo.name} (${assignedTo.role})`;
  }

  return assignedTo.name;
}

function ReportsPage() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReports([]);

    try {
      const data = await getOwnReports();

      if (!isReportsResponse(data)) {
        const formatError = new Error(
          "The Reports data could not be read in the expected format."
        );

        formatError.status = 500;
        throw formatError;
      }

      setReports(data.reports);
    } catch (requestError) {
      setError(
        getErrorDetails(
          requestError,
          "Your Reports could not be loaded. Please try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadReports();
    }

    loadOnMount();
  }, [loadReports]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  return (
    <main className="reports-page" aria-busy={loading}>
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Reports</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Reports navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <ReportingNavLinks />
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro reports-intro">
        <h1 className="awareness-page-title">Reports</h1>
        <p>
          Review the suspicious-URL reports you submitted to school IT and
          follow their current review state.
        </p>
        <p className="reports-intro-note">
          Report details, ticket numbers, automated analysis evidence, and IT
          review information are supplied by the PhishGuard backend.
        </p>
      </section>

      {loading ? (
        <section
          className="reports-state"
          role="status"
          aria-live="polite"
        >
          Loading your Reports...
        </section>
      ) : error ? (
        <section className="reports-error-state" role="alert">
          <h2>Reports are unavailable</h2>
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : (
            <button type="button" onClick={loadReports}>
              Try again
            </button>
          )}
        </section>
      ) : reports.length === 0 ? (
        <section className="reports-empty-state">
          <h2>No Reports yet</h2>
          <p>
            Reports you submit from Analysis History will appear here.
          </p>
        </section>
      ) : (
        <section
          className="reports-list-section"
          aria-labelledby="reports-list-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="reports-list-heading">Your Reports</h2>
              <p>Reports are shown in the order returned by the backend.</p>
            </div>

            <span className="report-count">
              {reports.length}{" "}
              {reports.length === 1 ? "report" : "reports"}
            </span>
          </div>

          <div className="reports-list">
            {reports.map((report) => (
              <article className="report-card" key={report.id}>
                <div className="report-card-heading">
                  <div>
                    <span className="report-ticket-label">
                      Ticket number
                    </span>
                    <h2 className="report-ticket-number">
                      {report.ticketNumber}
                    </h2>
                  </div>

                  <span className={getStatusClassName(report.status)}>
                    {getReportStatusLabel(report.status)}
                  </span>
                </div>

                <p className="report-card-url">
                  {report.analysisSnapshot.url}
                </p>

                <dl className="report-summary-grid">
                  <div>
                    <dt>Submitted</dt>
                    <dd>
                      <time dateTime={report.createdAt || undefined}>
                        {formatReportingDate(report.createdAt)}
                      </time>
                    </dd>
                  </div>

                  <div>
                    <dt>Reason</dt>
                    <dd>{getReportReasonLabel(report.reason)}</dd>
                  </div>

                  <div>
                    <dt>IT Priority</dt>
                    <dd>
                      {getReportPriorityLabel(report.priority)}
                    </dd>
                  </div>

                  <div>
                    <dt>IT Assessment</dt>
                    <dd>
                      {report.status === "completed"
                        ? getReportAssessmentLabel(report.assessment)
                        : "Pending IT Review"}
                    </dd>
                  </div>

                  <div>
                    <dt>Assigned IT staff</dt>
                    <dd>{getAssignmentText(report.assignedTo)}</dd>
                  </div>
                </dl>

                <Link
                  className="report-card-action"
                  to={`/reports/${encodeURIComponent(report.id)}`}
                >
                  View report
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default ReportsPage;
