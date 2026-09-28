import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
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

  return (
    <main className="reports-page review-page" id="main-content" aria-busy={loading}>
      <PageHeader
        title="IT Review Queue"
        description={
          <>
            <p>
              Review phishing incident reports submitted by PhishGuard users and
              open a Report for investigation.
            </p>
            <p className="reports-intro-note">
              Queue order, ticket information, automated evidence, workflow
              state, and reviewer information are supplied by the PhishGuard
              backend.
            </p>
          </>
        }
      />

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
        <section className="review-queue-section">
          <div className="review-queue-heading">
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

                <dl className="review-queue-grid">
                  <div>
                    <dt>IT Priority</dt>
                    <dd>
                      {getReportPriorityLabel(report.priority)}
                    </dd>
                  </div>

                  <div>
                    <dt>IT Assessment</dt>
                    <dd>
                      {getReportAssessmentLabel(report.assessment)}
                    </dd>
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
                    <dt>Reporter</dt>
                    <dd>{getReporterText(report.reporter)}</dd>
                  </div>

                  <div>
                    <dt>Reason</dt>
                    <dd>{getReportReasonLabel(report.reason)}</dd>
                  </div>
                </dl>

                <div className="review-queue-evidence">
                  <span className="review-queue-evidence-label">
                    Automated
                  </span>
                  <span className="review-queue-evidence-risk">
                    {report.analysisSnapshot.risk
                      ? report.analysisSnapshot.risk.toUpperCase()
                      : "Unavailable"}
                  </span>
                  <span className="review-queue-evidence-score">
                    Score:{" "}
                    {Number.isFinite(report.analysisSnapshot.score)
                      ? report.analysisSnapshot.score
                      : "Unavailable"}
                  </span>
                  <span className="review-queue-evidence-summary">
                    {getEvidenceSummary(report.analysisSnapshot)}
                  </span>
                </div>

                <div className="review-queue-footer">
                  <Link
                    className="report-card-action"
                    to={`/review/${encodeURIComponent(report.id)}`}
                  >
                    Open review
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default ReviewQueuePage;
