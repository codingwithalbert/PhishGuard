import {
  useCallback,
  useEffect,
  useState
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import ReportEvidence from "../components/reporting/ReportEvidence";
import ReportMessageThread from "../components/reporting/ReportMessageThread";
import {
  formatReportingDate,
  getReportAssessmentLabel,
  getReportPriorityLabel,
  getReportReasonLabel,
  getReportStatusLabel
} from "../components/reporting/reportingUi";
import {
  createOwnReportMessage,
  getOwnReport,
  getOwnReportMessages
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

function isReport(report) {
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
      Array.isArray(snapshot.findings)
  );
}

function isReportMessage(message) {
  return Boolean(
    message &&
      typeof message.id === "string" &&
      typeof message.message === "string" &&
      message.sender &&
      typeof message.sender.name === "string" &&
      typeof message.sender.role === "string" &&
      typeof message.createdAt === "string"
  );
}

function isReportResponse(data) {
  return data?.success === true && isReport(data.report);
}

function isMessagesResponse(data) {
  return (
    data?.success === true &&
    Array.isArray(data.messages) &&
    data.messages.every(isReportMessage)
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

  if (typeof user.role === "string" && user.role.length > 0) {
    return `${user.name} (${user.role})`;
  }

  return user.name;
}

function getReviewerNoteText(report) {
  if (report.status !== "completed") {
    return "Not available until review is completed";
  }

  return report.reviewerNote || "No final reviewer note was provided";
}

function ReportDetailPage() {
  const navigate = useNavigate();
  const { reportId } = useParams();

  const [report, setReport] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [messageError, setMessageError] = useState(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessagesError(null);
    setMessageError(null);
    setReport(null);
    setMessages([]);

    if (!reportId) {
      const missingIdError = new Error("Report ID is unavailable");

      missingIdError.status = 404;
      setError({
        message: missingIdError.message,
        status: missingIdError.status
      });
      setLoading(false);
      return;
    }

    const [reportResult, messagesResult] = await Promise.allSettled([
      getOwnReport(reportId),
      getOwnReportMessages(reportId)
    ]);

    if (reportResult.status === "fulfilled") {
      if (!isReportResponse(reportResult.value)) {
        setError({
          message:
            "The Report data could not be read in the expected format.",
          status: 500
        });
      } else {
        setReport(reportResult.value.report);
      }
    } else {
      setError(
        getErrorDetails(
          reportResult.reason,
          "The Report could not be loaded. Please try again."
        )
      );
    }

    if (messagesResult.status === "fulfilled") {
      if (!isMessagesResponse(messagesResult.value)) {
        setMessagesError({
          message:
            "The Report conversation could not be read in the expected format.",
          status: 500
        });
      } else {
        setMessages(messagesResult.value.messages);
      }
    } else {
      setMessagesError(
        getErrorDetails(
          messagesResult.reason,
          "The Report conversation could not be loaded."
        )
      );
    }

    setLoading(false);
  }, [reportId]);

  useEffect(() => {
    async function loadOnMount() {
      await loadReport();
    }

    loadOnMount();
  }, [loadReport]);

  const handleSendMessage = useCallback(async (message) => {
    if (!report || report.status === "completed" || isSending) {
      return false;
    }

    setIsSending(true);
    setMessageError(null);

    try {
      await createOwnReportMessage({
        reportId: report.id,
        message
      });

      try {
        const refreshedMessages = await getOwnReportMessages(report.id);

        if (!isMessagesResponse(refreshedMessages)) {
          const refreshError = new Error(
            "The Report conversation could not be refreshed."
          );

          refreshError.status = 500;
          throw refreshError;
        }

        setMessages(refreshedMessages.messages);
      } catch (refreshError) {
        setMessageError(
          getErrorDetails(
            refreshError,
            "The message was sent, but the conversation could not be refreshed."
          )
        );
      }

      return true;
    } catch (error) {
      setMessageError(
        getErrorDetails(
          error,
          "The message could not be sent. Please try again."
        )
      );

      return false;
    } finally {
      setIsSending(false);
    }
  }, [isSending, report]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  return (
    <main
      className="reports-page report-detail-page"
      aria-busy={loading}
    >
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Report detail</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Report detail navigation"
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
          Loading Report...
        </section>
      ) : error ? (
        <section className="reports-error-state" role="alert">
          <h2>
            {error.status === 404
              ? "Report not found"
              : "Report unavailable"}
          </h2>
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : error.status === 404 ? (
            <Link to="/reports">Back to Reports</Link>
          ) : (
            <button type="button" onClick={loadReport}>
              Try again
            </button>
          )}
        </section>
      ) : report ? (
        <>
          <section className="report-detail-header">
            <Link to="/reports">Back to Reports</Link>

            <span className="report-ticket-label">Ticket number</span>
            <h1 className="report-ticket-number">
              {report.ticketNumber}
            </h1>

            <span className={getStatusClassName(report.status)}>
              {getReportStatusLabel(report.status)}
            </span>
          </section>

          <section className="report-detail-section">
            <h2>Report submission</h2>

            <dl className="report-detail-grid">
              <div>
                <dt>Reason</dt>
                <dd>{getReportReasonLabel(report.reason)}</dd>
              </div>

              <div>
                <dt>Initial details</dt>
                <dd>
                  {report.details ||
                    "No initial details were provided."}
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
            </dl>
          </section>

          <section className="report-detail-section">
            <ReportEvidence analysisSnapshot={report.analysisSnapshot} />
          </section>

          <section className="report-detail-section">
            <h2>IT review state</h2>

            <dl className="report-detail-grid">
              <div>
                <dt>Workflow status</dt>
                <dd>{getReportStatusLabel(report.status)}</dd>
              </div>

              <div>
                <dt>IT Priority</dt>
                <dd>{getReportPriorityLabel(report.priority)}</dd>
              </div>

              <div>
                <dt>IT Assessment</dt>
                <dd>
                  {getReportAssessmentLabel(report.assessment)}
                </dd>
              </div>

              <div>
                <dt>Assigned IT staff</dt>
                <dd>
                  {getUserReferenceText(
                    report.assignedTo,
                    "Not assigned"
                  )}
                </dd>
              </div>

              <div>
                <dt>Final reviewer</dt>
                <dd>
                  {getUserReferenceText(
                    report.reviewedBy,
                    "Not available"
                  )}
                </dd>
              </div>

              <div>
                <dt>Reviewer note</dt>
                <dd>{getReviewerNoteText(report)}</dd>
              </div>

              <div>
                <dt>Reviewed at</dt>
                <dd>
                  {report.reviewedAt
                    ? formatReportingDate(report.reviewedAt)
                    : "Not available"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="report-detail-section report-messages-section">
            <div className="section-heading">
              <div>
                <h2>Communication</h2>
                <p>
                  {report.status === "completed"
                    ? "This completed Report conversation is read-only."
                    : "Send additional context for the reporting user and IT review team."}
                </p>
              </div>
            </div>

            {messagesError ? (
              <div
                className="reports-inline-error"
                role="alert"
              >
                <p>{messagesError.message}</p>

                {isSessionError(messagesError) ? (
                  <p>
                    <Link to="/login">Sign in again</Link>
                  </p>
                ) : (
                  <button type="button" onClick={loadReport}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <ReportMessageThread
                messages={messages}
                canSend={report.status !== "completed"}
                onSend={handleSendMessage}
                isSending={isSending}
                sendError={messageError}
                composerLabel="Add context"
                emptyMessage="No messages have been sent for this Report."
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default ReportDetailPage;
