import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getProgress } from "../services/api";

function isAssessmentAttempt(attempt, totalKey) {
  return (
    attempt &&
    typeof attempt.id === "string" &&
    Number.isFinite(attempt.rawScore) &&
    Number.isFinite(attempt.score) &&
    Number.isInteger(attempt[totalKey]) &&
    typeof attempt.completedAt === "string"
  );
}

function isAssessmentGroup(group, totalKey) {
  return (
    group &&
    (group.latest === null || isAssessmentAttempt(group.latest, totalKey)) &&
    Array.isArray(group.history) &&
    group.history.every((attempt) => isAssessmentAttempt(attempt, totalKey))
  );
}

function isTrainingModule(module) {
  return (
    module &&
    Number.isInteger(module.moduleId) &&
    typeof module.title === "string" &&
    typeof module.learningObjective === "string" &&
    Array.isArray(module.content) &&
    module.content.every(
      (section) =>
        section &&
        typeof section.heading === "string" &&
        Array.isArray(section.points) &&
        section.points.every((point) => typeof point === "string")
    ) &&
    typeof module.completed === "boolean" &&
    (module.completedAt === null || typeof module.completedAt === "string")
  );
}

function isProgressResponse(data) {
  return (
    data?.success === true &&
    isAssessmentGroup(data.awareness, "totalQuestions") &&
    isAssessmentGroup(
      data.phishingIdentification,
      "totalScenarios"
    ) &&
    data.training &&
    Number.isInteger(data.training.completedModules) &&
    data.training.completedModules >= 0 &&
    Number.isInteger(data.training.totalModules) &&
    data.training.totalModules >= 0 &&
    Number.isFinite(data.training.trainingExposure) &&
    Array.isArray(data.training.modules) &&
    data.training.modules.every(isTrainingModule)
  );
}

function hasAssessmentData(group) {
  return (
    group &&
    ((group.latest !== null && group.latest !== undefined) ||
      group.history.length > 0)
  );
}

function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
    status: error?.status
  };
}

function isSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

function formatCompletedAt(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Completion date unavailable"
    : date.toLocaleString();
}

function ProgressLoadingState() {
  return (
    <section
      className="progress-loading-panel"
      aria-label="Loading progress"
      aria-busy="true"
    >
      <div className="awareness-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="awareness-status" role="status" aria-live="polite">
        Loading your personal progress...
      </p>
    </section>
  );
}

function ProgressErrorState({ error, onRetry }) {
  return (
    <section className="progress-error-panel" role="alert">
      <h2>Progress is unavailable</h2>
      <p>{error.message}</p>

      {isSessionError(error) ? (
        <p>
          <Link to="/login">Sign in again</Link>
        </p>
      ) : (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

function ProgressStateSummary({ hasAnyProgress, isPartiallyPopulated }) {
  let title = "Your recorded learning activity";
  let description =
    "Latest results, recent assessment history, and backend-provided training completion state are shown below.";

  if (!hasAnyProgress) {
    title = "Your progress record is empty";
    description =
      "No completed assessment attempts or training modules are recorded yet. The fixed training catalog and links to the learning activities are available below.";
  } else if (isPartiallyPopulated) {
    title = "Some learning activity is recorded";
    description =
      "Available results and module statuses are shown below. Sections without a completed record will remain empty until a result is submitted or a module is completed in Training.";
  }

  return (
    <section className="progress-state-summary" aria-live="polite">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function LatestAssessmentCard({
  title,
  assessment,
  totalKey,
  totalLabel,
  emptyMessage,
  actionTo,
  actionLabel
}) {
  return (
    <article className="progress-latest-card">
      <div className="progress-card-heading">
        <h2>{title}</h2>
        <span
          className={`progress-record-status ${
            assessment !== null
              ? "progress-record-status-completed"
              : "progress-record-status-empty"
          }`}
        >
          {assessment !== null ? "Completed result" : "No result"}
        </span>
      </div>

      {assessment !== null ? (
        <>
          <p className="progress-score-label">Score returned by backend</p>
          <p className="progress-score">
            <strong>{assessment.score}</strong>
            <span>/100</span>
          </p>

          <dl className="progress-result-details">
            <div>
              <dt>Raw score</dt>
              <dd>
                {assessment.rawScore} / {assessment[totalKey]}
              </dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                <time dateTime={assessment.completedAt}>
                  {formatCompletedAt(assessment.completedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{totalLabel}</dt>
              <dd>{assessment[totalKey]}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="progress-empty-message">{emptyMessage}</p>
      )}

      <Link className="progress-card-action" to={actionTo}>
        {actionLabel}
      </Link>
    </article>
  );
}

function TrainingExposureSummary({ training }) {
  return (
    <section
      className="progress-training-summary"
      aria-labelledby="progress-training-summary-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="progress-training-summary-heading">Training Exposure</h2>
          <p>
            These values are returned by the backend and are not recalculated
            on this page.
          </p>
        </div>
      </div>

      <div className="progress-training-stats">
        <div className="progress-training-stat">
          <span>Completed modules</span>
          <strong>{training.completedModules}</strong>
        </div>
        <div className="progress-training-stat">
          <span>Total modules</span>
          <strong>{training.totalModules}</strong>
        </div>
        <div className="progress-training-stat">
          <span>Training Exposure</span>
          <strong>{training.trainingExposure}%</strong>
        </div>
      </div>

      <p className="progress-boundary-note">
        Training Exposure represents recorded module completion. It is
        descriptive and does not demonstrate phishing resistance or training
        effectiveness.
      </p>
    </section>
  );
}

function TrainingModuleList({ modules }) {
  return (
    <section
      className="progress-training-modules"
      aria-labelledby="progress-training-modules-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="progress-training-modules-heading">Fixed training modules</h2>
          <p>
            These statuses are supplied by the backend. Progress is read-only;
            use the Training page when you want to record a completion.
          </p>
        </div>

        <Link className="progress-section-action" to="/training">
          Open Training
        </Link>
      </div>

      {modules.length === 0 ? (
        <p className="progress-empty-message">
          No fixed training modules are available right now.
        </p>
      ) : (
        <ul className="progress-module-list">
          {modules.map((module) => (
            <li
              className={`progress-module ${
                module.completed ? "progress-module-completed" : ""
              }`}
              key={module.moduleId}
            >
              <div className="progress-module-header">
                <div>
                  <h3>{module.title}</h3>
                  <p>{module.learningObjective}</p>
                </div>

                <span className="progress-module-status">
                  {module.completed ? "Completed" : "Not completed"}
                </span>
              </div>

              {module.completed && (
                <p className="progress-module-date">
                  {module.completedAt ? (
                    <>
                      Completed{" "}
                      <time dateTime={module.completedAt}>
                        {formatCompletedAt(module.completedAt)}
                      </time>
                    </>
                  ) : (
                    "Completed; completion date unavailable"
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssessmentHistory({
  headingId,
  title,
  history,
  totalKey,
  totalLabel,
  emptyMessage
}) {
  return (
    <section
      className="progress-history-section"
      aria-labelledby={`${headingId}-heading`}
    >
      <div className="section-heading">
        <div>
          <h2 id={`${headingId}-heading`}>{title}</h2>
          <p>Newest attempts first, exactly as returned by the backend.</p>
        </div>

        <span className="progress-history-count">
          {history.length} {history.length === 1 ? "attempt" : "attempts"}
        </span>
      </div>

      {history.length === 0 ? (
        <p className="progress-empty-message">{emptyMessage}</p>
      ) : (
        <ol className="progress-history-list">
          {history.map((attempt) => (
            <li className="progress-history-item" key={attempt.id}>
              <div className="progress-history-score">
                <span>Score</span>
                <strong>
                  {attempt.score}
                  <span>/100</span>
                </strong>
              </div>

              <dl className="progress-history-details">
                <div>
                  <dt>Raw score</dt>
                  <dd>
                    {attempt.rawScore} / {attempt[totalKey]}
                  </dd>
                </div>
                <div>
                  <dt>{totalLabel}</dt>
                  <dd>{attempt[totalKey]}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    <time dateTime={attempt.completedAt}>
                      {formatCompletedAt(attempt.completedAt)}
                    </time>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ProgressPage() {
  const navigate = useNavigate();

  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProgress = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      const data = await getProgress();

      if (!isProgressResponse(data)) {
        const formatError = new Error(
          "The progress data could not be read in the expected format."
        );

        formatError.status = 500;
        throw formatError;
      }

      setProgress(data);
    } catch (requestError) {
      setError(
        getErrorDetails(
          requestError,
          "Your progress could not be loaded. Please try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadProgress();
    }

    loadOnMount();
  }, [loadProgress]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  const awareness = progress?.awareness;
  const phishingIdentification = progress?.phishingIdentification;
  const training = progress?.training;

  const hasAwarenessProgress = hasAssessmentData(awareness);
  const hasPhishingProgress = hasAssessmentData(phishingIdentification);
  const hasTrainingProgress = (training?.completedModules ?? 0) > 0;
  const hasAnyProgress =
    hasAwarenessProgress || hasPhishingProgress || hasTrainingProgress;
  const isPartiallyPopulated =
    hasAnyProgress &&
    (!hasAwarenessProgress || !hasPhishingProgress || !hasTrainingProgress);

  return (
    <main className="awareness-page progress-page" aria-busy={loading}>
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Personal Progress</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Progress navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro progress-intro">
        <h1 className="awareness-page-title">Personal Progress</h1>
        <p>
          Review the latest assessment results, recent attempt history, and
          recorded training completion status for your PhishGuard account.
        </p>
        <p className="progress-intro-note">
          This page is descriptive and read-only. Scores and Training Exposure
          come from the backend; this view does not calculate or interpret them.
        </p>
      </section>

      {loading ? (
        <ProgressLoadingState />
      ) : error ? (
        <ProgressErrorState error={error} onRetry={loadProgress} />
      ) : progress ? (
        <>
          <ProgressStateSummary
            hasAnyProgress={hasAnyProgress}
            isPartiallyPopulated={isPartiallyPopulated}
          />

          <section
            className="progress-latest-section"
            aria-labelledby="progress-latest-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="progress-latest-heading">Latest assessment results</h2>
                <p>
                  The newest completed result supplied for each assessment is
                  shown separately below.
                </p>
              </div>
            </div>

            <div className="progress-latest-grid">
              <LatestAssessmentCard
                title="Awareness Assessment"
                assessment={awareness.latest}
                totalKey="totalQuestions"
                totalLabel="Total questions"
                emptyMessage="No completed Awareness Assessment has been recorded yet."
                actionTo="/awareness"
                actionLabel="Open Awareness Assessment"
              />
              <LatestAssessmentCard
                title="Phishing Identification Assessment"
                assessment={phishingIdentification.latest}
                totalKey="totalScenarios"
                totalLabel="Total scenarios"
                emptyMessage="No completed Phishing Identification Assessment has been recorded yet."
                actionTo="/phishing-identification"
                actionLabel="Open Phishing Identification Assessment"
              />
            </div>
          </section>

          <TrainingExposureSummary training={training} />
          <TrainingModuleList modules={training.modules} />

          <div className="progress-history-grid">
            <AssessmentHistory
              headingId="awareness-attempt-history"
              title="Awareness Assessment attempt history"
              history={awareness.history}
              totalKey="totalQuestions"
              totalLabel="Total questions"
              emptyMessage="No Awareness Assessment attempts have been recorded yet."
            />
            <AssessmentHistory
              headingId="phishing-identification-attempt-history"
              title="Phishing Identification Assessment attempt history"
              history={phishingIdentification.history}
              totalKey="totalScenarios"
              totalLabel="Total scenarios"
              emptyMessage="No Phishing Identification Assessment attempts have been recorded yet."
            />
          </div>

          <section
            className="progress-actions-section"
            aria-labelledby="progress-actions-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="progress-actions-heading">Learning activities</h2>
                <p>
                  Open an existing activity to submit a new assessment or
                  record a training module completion.
                </p>
              </div>
            </div>

            <div className="progress-action-grid">
              <Link
                className="progress-action-card"
                to="/awareness"
              >
                <span className="progress-action-title">
                  Awareness Assessment
                </span>
                <span className="progress-action-description">
                  Review or complete the cybersecurity awareness questions.
                </span>
              </Link>
              <Link
                className="progress-action-card"
                to="/phishing-identification"
              >
                <span className="progress-action-title">
                  Phishing Identification
                </span>
                <span className="progress-action-description">
                  Review or complete the controlled phishing scenarios.
                </span>
              </Link>
              <Link className="progress-action-card" to="/training">
                <span className="progress-action-title">Training</span>
                <span className="progress-action-description">
                  Review fixed modules and record explicit completions.
                </span>
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

export default ProgressPage;
