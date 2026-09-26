import {
  useCallback,
  useEffect,
  useId,
  useRef,
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
  assignReviewReport,
  claimReviewReport,
  completeReviewReport,
  createReviewReportMessage,
  getAssignmentCandidates,
  getReviewReport,
  getReviewReportMessages,
  startReviewReport,
  updateReviewReportPriority
} from "../services/api";

const IT_PRIORITY_VALUES = Object.freeze([
  "low",
  "normal",
  "high"
]);

const FINAL_ASSESSMENT_VALUES = Object.freeze([
  "phishing",
  "suspicious",
  "no_threat_identified"
]);

const MESSAGE_MAX_LENGTH = 1000;
const REVIEWER_NOTE_MAX_LENGTH = 1000;

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
      (report.updatedAt === null ||
        typeof report.updatedAt === "string") &&
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

function isCandidatesResponse(data) {
  return data?.success === true && Array.isArray(data.assignees);
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

function getReviewerNoteText(report) {
  if (report.status !== "completed") {
    return "Not available until review is completed";
  }

  return report.reviewerNote || "No final reviewer note was provided";
}

function getStoredViewer() {
  try {
    const storedUser = localStorage.getItem("user");

    if (!storedUser) {
      return null;
    }

    const parsedUser = JSON.parse(storedUser);

    return parsedUser && typeof parsedUser === "object"
      ? parsedUser
      : null;
  } catch {
    return null;
  }
}

function getStoredText(source, key) {
  const value = source?.[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function isUnfinishedStatus(status) {
  return status === "submitted" || status === "under_review";
}

function isSelectableUserId(value) {
  return typeof value === "string" && value.length > 0;
}

function getEffectivePriority(selectedPriority, reportPriority) {
  if (typeof selectedPriority === "string") {
    return selectedPriority;
  }

  return typeof reportPriority === "string" ? reportPriority : "";
}

function getEffectiveCandidateId(
  selectedCandidateId,
  currentAssigneeId,
  candidates
) {
  if (isSelectableUserId(selectedCandidateId)) {
    return selectedCandidateId;
  }

  if (
    isSelectableUserId(currentAssigneeId) &&
    candidates.some((candidate) => candidate?.id === currentAssigneeId)
  ) {
    return currentAssigneeId;
  }

  return "";
}

function ReviewReportDetailPage() {
  const navigate = useNavigate();
  const { reportId } = useParams();
  const priorityInputId = useId();
  const assigneeInputId = useId();
  const assessmentInputId = useId();
  const reviewerNoteInputId = useId();

  const actionLockRef = useRef(false);
  const sendLockRef = useRef(false);

  const [report, setReport] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messagesError, setMessagesError] = useState(null);

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  const [selectedPriority, setSelectedPriority] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);

  const [completionAssessment, setCompletionAssessment] = useState("");
  const [reviewerNote, setReviewerNote] = useState("");

  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [sendError, setSendError] = useState(null);

  const viewer = getStoredViewer();
  const viewerRole = getStoredText(viewer, "role");
  const viewerId = getStoredText(viewer, "id");
  const isAdmin = viewerRole === "admin";
  const isReviewerRole = viewerRole === "staff" || isAdmin;

  const isCompleted = report?.status === "completed";
  const isUnfinished = Boolean(report && isUnfinishedStatus(report.status));
  const isUnassigned = Boolean(report && !report.assignedTo);
  const isSubmitted = report?.status === "submitted";
  const controlsDisabled = pendingAction !== null;

  const assignedToAnotherReviewer = Boolean(
    !isAdmin &&
      isUnfinished &&
      !isUnassigned &&
      viewerId &&
      isSelectableUserId(report?.assignedTo?.id) &&
      report.assignedTo.id !== viewerId
  );

  const effectivePriority = getEffectivePriority(
    selectedPriority,
    report?.priority
  );

  const effectiveCandidateId = getEffectiveCandidateId(
    selectedCandidateId,
    report?.assignedTo?.id,
    candidates
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessagesError(null);
    setActionError(null);
    setActionNotice(null);
    setSendError(null);
    setSelectedPriority(null);
    setSelectedCandidateId(null);
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
      getReviewReport(reportId),
      getReviewReportMessages(reportId)
    ]);

    if (reportResult.status === "fulfilled") {
      if (!isReportResponse(reportResult.value)) {
        setError({
          message:
            "The IT Report data could not be read in the expected format.",
          status: 500
        });
      } else {
        setReport(reportResult.value.report);
      }
    } else {
      setError(
        getErrorDetails(
          reportResult.reason,
          "The IT Report could not be loaded. Please try again."
        )
      );
    }

    if (messagesResult.status === "fulfilled") {
      if (!isMessagesResponse(messagesResult.value)) {
        setMessagesError({
          message:
            "The IT Report conversation could not be read in the expected format.",
          status: 500
        });
      } else {
        setMessages(messagesResult.value.messages);
      }
    } else {
      setMessagesError(
        getErrorDetails(
          messagesResult.reason,
          "The IT Report conversation could not be loaded."
        )
      );
    }

    setLoading(false);
  }, [reportId]);

  const refreshReport = useCallback(async () => {
    if (!reportId) {
      return false;
    }

    try {
      const data = await getReviewReport(reportId);

      if (!isReportResponse(data)) {
        return false;
      }

      setReport(data.report);
      return true;
    } catch {
      return false;
    }
  }, [reportId]);

  const reloadMessages = useCallback(async () => {
    if (!reportId) {
      return;
    }

    try {
      const data = await getReviewReportMessages(reportId);

      if (!isMessagesResponse(data)) {
        setMessagesError({
          message:
            "The IT Report conversation could not be read in the expected format.",
          status: 500
        });
        return;
      }

      setMessages(data.messages);
      setMessagesError(null);
    } catch (messagesFailure) {
      setMessagesError(
        getErrorDetails(
          messagesFailure,
          "The IT Report conversation could not be loaded."
        )
      );
    }
  }, [reportId]);

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    setCandidatesError(null);

    try {
      const data = await getAssignmentCandidates();

      if (!isCandidatesResponse(data)) {
        setCandidatesError({
          message:
            "Assignment candidates could not be read in the expected format.",
          status: 500
        });
        return;
      }

      setCandidates(data.assignees);
    } catch (candidatesFailure) {
      setCandidatesError(
        getErrorDetails(
          candidatesFailure,
          "Assignment candidates could not be loaded."
        )
      );
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadReport();
    }

    loadOnMount();
  }, [loadReport]);

  useEffect(() => {
    if (!isAdmin || !isUnfinished) {
      return;
    }

    async function loadOnDemand() {
      await loadCandidates();
    }

    loadOnDemand();
  }, [isAdmin, isUnfinished, loadCandidates]);

  async function runReportMutation({
    action,
    request,
    fallbackMessage,
    successMessage
  }) {
    if (actionLockRef.current) {
      return false;
    }

    actionLockRef.current = true;
    setPendingAction(action);
    setActionError(null);
    setActionNotice(null);

    try {
      const data = await request();
      let hasAuthoritativeReport = false;

      if (isReportResponse(data)) {
        setReport(data.report);
        hasAuthoritativeReport = true;
      } else {
        hasAuthoritativeReport = await refreshReport();
      }

      if (hasAuthoritativeReport) {
        setSelectedPriority(null);
        setSelectedCandidateId(null);
        setActionNotice(successMessage);
      } else {
        setActionError({
          message:
            "The updated Report could not be read from the backend. Reload this Report and try again.",
          status: 500
        });
      }

      return hasAuthoritativeReport;
    } catch (mutationError) {
      const details = getErrorDetails(mutationError, fallbackMessage);
      const isStateConflict =
        details.status === 409 || details.status === 404;
      const refreshed = isStateConflict
        ? await refreshReport()
        : false;

      if (refreshed) {
        setSelectedPriority(null);
        setSelectedCandidateId(null);
        setActionError({
          ...details,
          message: `${details.message} The latest Report state from the backend is now displayed.`
        });
      } else {
        setActionError(details);
      }

      return false;
    } finally {
      actionLockRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleClaim() {
    if (!report || !isUnfinished || !isUnassigned) {
      return;
    }

    await runReportMutation({
      action: "claim",
      request: () => claimReviewReport(report.id),
      fallbackMessage: "The Report could not be claimed. Please try again.",
      successMessage:
        "Report claimed. The assignment below comes from the backend."
    });
  }

  async function handleStartReview() {
    if (!report || !isSubmitted) {
      return;
    }

    await runReportMutation({
      action: "start",
      request: () => startReviewReport(report.id),
      fallbackMessage:
        "The review could not be started. Please try again.",
      successMessage:
        "Review started. The workflow status comes from the backend."
    });
  }

  async function handleAssign(event) {
    event.preventDefault();

    if (!report || !isUnfinished) {
      return;
    }

    if (!isSelectableUserId(effectiveCandidateId)) {
      setActionError({
        message: "Select a reviewer before saving the assignment.",
        status: 400
      });
      return;
    }

    await runReportMutation({
      action: "assign",
      request: () =>
        assignReviewReport({
          reportId: report.id,
          assignedTo: effectiveCandidateId
        }),
      fallbackMessage:
        "The assignment could not be saved. Please try again.",
      successMessage:
        "Assignment saved. The assigned reviewer comes from the backend."
    });
  }

  async function handlePrioritySubmit(event) {
    event.preventDefault();

    if (!report || !isUnfinished) {
      return;
    }

    if (!IT_PRIORITY_VALUES.includes(effectivePriority)) {
      setActionError({
        message: "Select an IT priority before submitting.",
        status: 400
      });
      return;
    }

    await runReportMutation({
      action: "priority",
      request: () =>
        updateReviewReportPriority({
          reportId: report.id,
          priority: effectivePriority
        }),
      fallbackMessage:
        "The IT priority could not be updated. Please try again.",
      successMessage:
        "IT Priority updated. This is separate from the automated URL risk result."
    });
  }

  async function handleCompleteSubmit(event) {
    event.preventDefault();

    if (!report || !isUnfinished || isUnassigned) {
      return;
    }

    if (!FINAL_ASSESSMENT_VALUES.includes(completionAssessment)) {
      setActionError({
        message: "Select a final IT assessment before completing.",
        status: 400
      });
      return;
    }

    const trimmedNote =
      typeof reviewerNote === "string" ? reviewerNote.trim() : "";

    if (trimmedNote.length > REVIEWER_NOTE_MAX_LENGTH) {
      setActionError({
        message: "The reviewer note must not exceed 1000 characters.",
        status: 400
      });
      return;
    }

    const didComplete = await runReportMutation({
      action: "complete",
      request: () =>
        completeReviewReport({
          reportId: report.id,
          assessment: completionAssessment,
          reviewerNote: trimmedNote
        }),
      fallbackMessage:
        "The review could not be completed. Please try again.",
      successMessage:
        "Review completed. The final assessment, reviewer note, and review timestamp come from the backend."
    });

    if (didComplete) {
      setCompletionAssessment("");
      setReviewerNote("");
    }
  }

  async function handleSendMessage(message) {
    if (
      !report ||
      !isUnfinished ||
      !isReviewerRole ||
      sendLockRef.current
    ) {
      return false;
    }

    const trimmedMessage =
      typeof message === "string" ? message.trim() : "";

    if (
      !trimmedMessage ||
      trimmedMessage.length > MESSAGE_MAX_LENGTH
    ) {
      return false;
    }

    sendLockRef.current = true;
    setIsSendingMessage(true);
    setSendError(null);

    try {
      await createReviewReportMessage({
        reportId: report.id,
        message: trimmedMessage
      });

      await reloadMessages();
      return true;
    } catch (sendFailure) {
      const details = getErrorDetails(
        sendFailure,
        "The message could not be sent. Please try again."
      );

      setSendError(details);

      if (details.status === 409 || details.status === 404) {
        await refreshReport();
      }

      return false;
    } finally {
      sendLockRef.current = false;
      setIsSendingMessage(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  function renderActionError(targetError) {
    if (!targetError) {
      return null;
    }

    return (
      <div className="reports-inline-error" role="alert">
        <p>{targetError.message}</p>

        {isSessionError(targetError) && (
          <p>
            <Link to="/login">Sign in again</Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <main
      className="reports-page review-page review-detail-page"
      aria-busy={loading}
    >
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>IT Report detail</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="IT Report detail navigation"
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
          Loading IT Report...
        </section>
      ) : error ? (
        <section className="reports-error-state" role="alert">
          <h2>
            {error.status === 404
              ? "Report not found"
              : "IT Report unavailable"}
          </h2>
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : error.status === 404 ? (
            <Link to="/review">Back to Review Queue</Link>
          ) : (
            <button type="button" onClick={loadReport}>
              Try again
            </button>
          )}
        </section>
      ) : report ? (
        <>
          <section className="report-detail-header review-detail-header">
            <Link to="/review">Back to Review Queue</Link>

            <span className="report-ticket-label">Ticket number</span>
            <h1 className="report-ticket-number">
              {report.ticketNumber}
            </h1>

            <span className={getStatusClassName(report.status)}>
              {getReportStatusLabel(report.status)}
            </span>
          </section>

          <section className="report-detail-section">
            <h2>Student Report</h2>

            <dl className="report-detail-grid">
              <div>
                <dt>Reporter</dt>
                <dd>{getReporterText(report.reporter)}</dd>
              </div>

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
            <h2>IT investigation</h2>

            {isCompleted ? (
              <p className="review-action-hint">
                This Report is completed. The Reporting V1 review is final,
                and workflow, priority, assignment, and communication controls
                are read-only. The conversation remains available below.
              </p>
            ) : null}

            {isUnfinished && isReviewerRole ? (
              <div className="review-action-panel">
                {actionNotice && (
                  <p
                    className="success-message"
                    role="status"
                  >
                    {actionNotice}
                  </p>
                )}

                {renderActionError(actionError)}

                <div className="review-action-grid">
                  {isUnassigned ? (
                    <div className="review-action-block">
                      <h3>Claim</h3>
                      <p className="review-action-hint">
                        Claim this Report to become the assigned reviewer. The
                        workflow status is not changed automatically.
                      </p>
                      <button
                        type="button"
                        onClick={handleClaim}
                        disabled={controlsDisabled}
                      >
                        {pendingAction === "claim"
                          ? "Claiming..."
                          : "Claim Report"}
                      </button>
                    </div>
                  ) : null}

                  {isSubmitted ? (
                    <div className="review-action-block">
                      <h3>Start review</h3>
                      <p className="review-action-hint">
                        Move this Report from Submitted to Under Review.
                        Assignment is not required first, and no final
                        assessment is selected.
                      </p>
                      <button
                        type="button"
                        onClick={handleStartReview}
                        disabled={controlsDisabled}
                      >
                        {pendingAction === "start"
                          ? "Starting..."
                          : "Start review"}
                      </button>
                    </div>
                  ) : null}

                  <div className="review-action-block">
                    <h3>IT Priority</h3>
                    <p className="review-action-hint">
                      IT Priority is a human workflow priority. It is separate
                      from PhishGuard&apos;s automated risk result.
                    </p>

                    <form
                      className="report-create-form"
                      onSubmit={handlePrioritySubmit}
                    >
                      <div className="report-form-field">
                        <label htmlFor={priorityInputId}>
                          IT Priority
                        </label>
                        <select
                          id={priorityInputId}
                          value={effectivePriority}
                          onChange={(event) =>
                            setSelectedPriority(event.target.value)
                          }
                          disabled={controlsDisabled}
                        >
                          {IT_PRIORITY_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {getReportPriorityLabel(value)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          controlsDisabled ||
                          !IT_PRIORITY_VALUES.includes(effectivePriority)
                        }
                      >
                        {pendingAction === "priority"
                          ? "Updating..."
                          : "Update IT Priority"}
                      </button>
                    </form>
                  </div>

                  {isAdmin ? (
                    <div className="review-action-block">
                      <h3>Assignment</h3>
                      <p className="review-action-hint">
                        Assign or reassign this Report to an active staff or
                        admin account supplied by the backend.
                      </p>

                      {candidatesLoading ? (
                        <p
                          className="review-action-hint"
                          role="status"
                        >
                          Loading assignment candidates...
                        </p>
                      ) : candidatesError ? (
                        <>
                          {renderActionError(candidatesError)}
                          <button
                            type="button"
                            onClick={loadCandidates}
                            disabled={controlsDisabled}
                          >
                            Try again
                          </button>
                        </>
                      ) : (
                        <form
                          className="report-create-form"
                          onSubmit={handleAssign}
                        >
                          <div className="report-form-field">
                            <label htmlFor={assigneeInputId}>
                              Assigned reviewer
                            </label>
                            <select
                              id={assigneeInputId}
                              value={effectiveCandidateId}
                              onChange={(event) =>
                                setSelectedCandidateId(event.target.value)
                              }
                              required
                              disabled={
                                controlsDisabled ||
                                candidates.length === 0
                              }
                            >
                              <option value="">
                                Select a reviewer
                              </option>
                              {candidates.map((candidate, index) => (
                                <option
                                  key={
                                    isSelectableUserId(candidate?.id)
                                      ? candidate.id
                                      : `candidate-${index}`
                                  }
                                  value={
                                    isSelectableUserId(candidate?.id)
                                      ? candidate.id
                                      : ""
                                  }
                                  disabled={
                                    !isSelectableUserId(candidate?.id)
                                  }
                                >
                                  {getUserReferenceText(
                                    candidate,
                                    "Unnamed account"
                                  )}
                                </option>
                              ))}
                            </select>
                          </div>

                          {candidates.length === 0 ? (
                            <p className="review-action-hint">
                              No assignment candidates were returned by the
                              backend.
                            </p>
                          ) : null}

                          <button
                            type="submit"
                            disabled={
                              controlsDisabled ||
                              !isSelectableUserId(effectiveCandidateId)
                            }
                          >
                            {pendingAction === "assign"
                              ? "Saving..."
                              : "Save assignment"}
                          </button>
                        </form>
                      )}
                    </div>
                  ) : null}

                  <div className="review-action-block review-action-block-wide">
                    <h3>Complete review</h3>

                    {isUnassigned ? (
                      <p className="review-action-hint">
                        Claim this Report or ask an admin to assign it before
                        the review can be completed.
                      </p>
                    ) : assignedToAnotherReviewer ? (
                      <p className="review-action-hint">
                        This Report is assigned to another reviewer. Only the
                        assigned staff member or an admin can complete it.
                      </p>
                    ) : (
                      <>
                        <p className="review-action-hint">
                          Select exactly one final IT assessment. Completing
                          this Report makes the Reporting V1 review final. A
                          completed assessment reflects the investigation using
                          the information available at that time and is not a
                          permanent guarantee about the URL.
                        </p>

                        <form
                          className="report-create-form"
                          onSubmit={handleCompleteSubmit}
                        >
                          <div className="report-form-field">
                            <label htmlFor={assessmentInputId}>
                              Final IT assessment
                            </label>
                            <select
                              id={assessmentInputId}
                              value={completionAssessment}
                              onChange={(event) =>
                                setCompletionAssessment(event.target.value)
                              }
                              required
                              disabled={controlsDisabled}
                            >
                              <option value="">
                                Select a final assessment
                              </option>
                              {FINAL_ASSESSMENT_VALUES.map((value) => (
                                <option key={value} value={value}>
                                  {getReportAssessmentLabel(value)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="report-form-field">
                            <label htmlFor={reviewerNoteInputId}>
                              Reviewer note (optional)
                            </label>
                            <textarea
                              id={reviewerNoteInputId}
                              value={reviewerNote}
                              onChange={(event) =>
                                setReviewerNote(event.target.value)
                              }
                              maxLength={REVIEWER_NOTE_MAX_LENGTH}
                              disabled={controlsDisabled}
                            />
                            <p className="report-form-reminder">
                              Do not include passwords, MFA codes,
                              authentication tokens, or other authentication
                              secrets.
                            </p>
                          </div>

                          <button
                            type="submit"
                            disabled={
                              controlsDisabled ||
                              !FINAL_ASSESSMENT_VALUES.includes(
                                completionAssessment
                              )
                            }
                          >
                            {pendingAction === "complete"
                              ? "Completing..."
                              : "Complete review"}
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

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
                <dt>Human IT assessment</dt>
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

              <div>
                <dt>Last updated</dt>
                <dd>
                  {report.updatedAt
                    ? formatReportingDate(report.updatedAt)
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
                  {isCompleted
                    ? "This Report is completed, so the conversation is read-only."
                    : "Ask the reporter for additional incident context, such as where the URL was encountered."}
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
                canSend={isUnfinished && isReviewerRole}
                onSend={
                  isUnfinished && isReviewerRole
                    ? handleSendMessage
                    : undefined
                }
                isSending={isSendingMessage}
                sendError={sendError}
                emptyMessage="No messages have been sent for this Report."
                composerLabel="Message to reporter"
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default ReviewReportDetailPage;
