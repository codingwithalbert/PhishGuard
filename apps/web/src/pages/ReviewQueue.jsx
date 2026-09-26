import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import { getReviewQueue } from "../services/api";
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

function isSafeUserReference(value) {
  return value === null || (value && typeof value === "object");
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
      (report.reviewedAt === null ||
        typeof report.reviewedAt === "string") &&
      snapshot &&
      typeof snapshot === "object" &&
      typeof snapshot.url === "string" &&
      Array.isArray(snapshot.indicators) &&
      Array.isArray(snapshot.findings) &&
      isSafeUserReference(report.reporter) &&
      isSafeUserReference(report.assignedTo) &&
      isSafeUserReference(report.reviewedBy)
  );
}

function isReviewQueueResponse(data) {
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

function getUserReferenceText(user, emptyMessage) {
  if (!user || typeof user.name !== "string") {
    return emptyMessage;
  }

  const role = typeof user.role === "string" ? user.role : null;
  const email = typeof user.email === "string" ? user.email : null;
  const nameWithRole = role ? `${user.name} (${role})` : user.name;

  return email ? `${nameWithRole} — ${email}` : nameWithRole;
}

function getReporterText(reporter) {
  return getUserReferenceText(reporter, "Reporter unavailable");
}

function getEvidenceSummary(snapshot) {
  const indicatorCount = Array.isArray(snapshot?.indicators)
    ? snapshot.indicators.length
    : 0;
  const findingCount = Array.isArray(snapshot?.findings)
    ? snapshot.findings.length
    : 0;

  return `${findingCount} findings, ${indicatorCount} indicators`;
}

function ReviewQueuePage() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReports([]);

    try {
      const data = await getReviewQueue();

      if (!isReviewQueueResponse(data)) {
        const formatError = new Error(
          "The IT Review queue could not be read in the expected format."
        );

        formatError.status = 500;
        throw formatError;
      }

      setReports(data.reports);
    } catch (requestError) {
      setError(
        getErrorDetails(
          requestError,
          "The IT Review queue could not be loaded. Please try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadQueue();
    }

    loadOnMount();
  }, [loadQueue]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  return (
    <main className="reports-page review-page" aria-busy={loading}>
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>IT Report Review</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="IT Review navigation"
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
        <h1 className="awareness-page-title">IT Review Queue</h1>
        <p>
          Review phishing incident reports submitted by PhishGuard users and
          open a Report for investigation.
        </p>
        <p className="reports-intro-note">
          Queue order, ticket information, automated evidence, workflow state,
          and reviewer information are supplied by the PhishGuard backend.
        </p>
      </section>

      {loading ? (
        <section
          className="reports-state"
          role="status"
          aria-live="polite"
        >
          Loading the IT Review queue...
        </section>
      ) : error ? (
        <section className="reports-error-state" role="alert">
          <h2>IT Review queue unavailable</h2>
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : (
            <button type="button" onClick={loadQueue}>
              Try again
            </button>
          )}
        </section>
      ) : reports.length === 0 ? (
        <section className="reports-empty-state">
          <h2>No Reports available</h2>
          <p>
            There are no Reports in the IT review queue right now.
          </p>
        </section>
      ) : (
        <section
          className="review-queue-section"
          aria-labelledby="review-queue-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="review-queue-heading">Review queue</h2>
              <p>
                Reports are shown in the order returned by the backend.
              </p>
            </div>

            <span className="report-count">
              {reports.length}{" "}
              {reports.length === 1 ? "report" : "reports"}
            </span>
          </div>

          <div className="review-queue-list">
            {reports.map((report) => (
              <article
                className="report-card review-queue-card"
                key={report.id}
              >
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

                <div className="review-card-metrics">
                  <div>
                    <span>Automated risk</span>
                    <strong>
                      {report.analysisSnapshot.risk
                        ? report.analysisSnapshot.risk.toUpperCase()
                        : "Unavailable"}
                    </strong>
                  </div>
                  <div>
                    <span>Automated score</span>
                    <strong>
                      {Number.isFinite(report.analysisSnapshot.score)
                        ? report.analysisSnapshot.score
                        : "Unavailable"}
                    </strong>
                  </div>
                  <div>
                    <span>IT Priority</span>
                    <strong>
                      {getReportPriorityLabel(report.priority)}
                    </strong>
                  </div>
                  <div>
                    <span>IT Assessment</span>
                    <strong>
                      {getReportAssessmentLabel(report.assessment)}
                    </strong>
                  </div>
                </div>

                <dl className="report-summary-grid review-queue-summary">
                  <div>
                    <dt>Reporter</dt>
                    <dd>{getReporterText(report.reporter)}</dd>
                  </div>

                  <div>
                    <dt>Reason</dt>
                    <dd>{getReportReasonLabel(report.reason)}</dd>
                  </div>

                  <div>
                    <dt>Assigned reviewer</dt>
                    <dd>
                      {getUserReferenceText(
                        report.assignedTo,
                        "Unassigned"
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Submitted</dt>
                    <dd>
                      <time dateTime={report.createdAt || undefined}>
                        {formatReportingDate(report.createdAt)}
                      </time>
                    </dd>
                  </div>

                  <div>
                    <dt>Evidence summary</dt>
                    <dd>
                      {getEvidenceSummary(report.analysisSnapshot)}
                    </dd>
                  </div>
                </dl>

                <Link
                  className="report-card-action"
                  to={`/review/${encodeURIComponent(report.id)}`}
                >
                  Open review
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default ReviewQueuePage;
