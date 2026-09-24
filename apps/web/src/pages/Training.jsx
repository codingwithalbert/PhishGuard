import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  completeTrainingModule,
  getTrainingModules,
  getTrainingProgress
} from "../services/api";

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
    (module.completedAt === null ||
      typeof module.completedAt === "string")
  );
}

function isTrainingProgress(progress) {
  return (
    progress &&
    Number.isFinite(progress.completedModules) &&
    Number.isFinite(progress.totalModules) &&
    Number.isFinite(progress.trainingExposure)
  );
}

function isTrainingModulesResponse(response) {
  return (
    Array.isArray(response?.modules) &&
    response.modules.every(isTrainingModule)
  );
}

function isTrainingProgressResponse(response) {
  return isTrainingProgress(response?.progress);
}

function isCompletionResponse(response) {
  return (
    response?.completion &&
    Number.isInteger(response.completion.moduleId) &&
    typeof response.completion.completedAt === "string" &&
    isTrainingProgress(response.progress)
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

function TrainingErrorState({ error, onRetry, retryLabel = "Try again" }) {
  if (!error) {
    return null;
  }

  return (
    <div className="awareness-inline-error" role="alert">
      <p>{error.message}</p>

      {isSessionError(error) ? (
        <p>
          <Link to="/login">Sign in again</Link>
        </p>
      ) : (
        onRetry && (
          <button type="button" onClick={onRetry}>
            {retryLabel}
          </button>
        )
      )}
    </div>
  );
}

function TrainingPage() {
  const navigate = useNavigate();
  const completionStatusRef = useRef(null);

  const [modules, setModules] = useState([]);
  const [progress, setProgress] = useState(null);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [progressLoading, setProgressLoading] = useState(true);
  const [modulesError, setModulesError] = useState(null);
  const [progressError, setProgressError] = useState(null);
  const [pendingModuleId, setPendingModuleId] = useState(null);
  const [completionError, setCompletionError] = useState(null);
  const [completionMessage, setCompletionMessage] = useState("");

  const loadTraining = useCallback(async () => {
    setModulesLoading(true);
    setProgressLoading(true);
    setModulesError(null);
    setProgressError(null);
    setCompletionError(null);
    setCompletionMessage("");

    const [modulesResponse, progressResponse] = await Promise.allSettled([
      getTrainingModules(),
      getTrainingProgress()
    ]);

    if (modulesResponse.status === "fulfilled") {
      if (isTrainingModulesResponse(modulesResponse.value)) {
        setModules(modulesResponse.value.modules);
      } else {
        setModules([]);
        setModulesError({
          message:
            "The training modules could not be read in the expected format.",
          status: 500
        });
      }
    } else {
      setModulesError(
        getErrorDetails(
          modulesResponse.reason,
          "The training modules could not be loaded."
        )
      );
    }

    if (progressResponse.status === "fulfilled") {
      if (isTrainingProgressResponse(progressResponse.value)) {
        setProgress(progressResponse.value.progress);
      } else {
        setProgress(null);
        setProgressError({
          message:
            "The training progress could not be read in the expected format.",
          status: 500
        });
      }
    } else {
      setProgressError(
        getErrorDetails(
          progressResponse.reason,
          "The training progress could not be loaded."
        )
      );
    }

    setModulesLoading(false);
    setProgressLoading(false);
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadTraining();
    }

    loadOnMount();
  }, [loadTraining]);

  useEffect(() => {
    if (completionMessage) {
      completionStatusRef.current?.focus();
    }
  }, [completionMessage]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  async function handleComplete(module) {
    if (module.completed || pendingModuleId !== null) {
      return;
    }

    setPendingModuleId(module.moduleId);
    setCompletionError(null);
    setCompletionMessage("");

    try {
      const data = await completeTrainingModule(module.moduleId);

      if (
        !isCompletionResponse(data) ||
        data.completion.moduleId !== module.moduleId
      ) {
        throw new Error("The training completion response could not be read.");
      }

      setModules((currentModules) =>
        currentModules.map((currentModule) =>
          currentModule.moduleId === data.completion.moduleId
            ? {
                ...currentModule,
                completed: true,
                completedAt: data.completion.completedAt
              }
            : currentModule
        )
      );
      setProgress(data.progress);
      setProgressError(null);
      setCompletionMessage("Module completion status updated.");
    } catch (error) {
      setCompletionError({
        ...getErrorDetails(
          error,
          "The module could not be marked complete. Please try again."
        ),
        moduleId: module.moduleId
      });
    } finally {
      setPendingModuleId(null);
    }
  }

  const retryCompletion = completionError
    ? () => {
        const module = modules.find(
          (candidate) => candidate.moduleId === completionError.moduleId
        );

        if (module) {
          handleComplete(module);
        }
      }
    : null;

  return (
    <main className="awareness-page training-page">
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Training Exposure</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Training navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro">
        <h1 className="awareness-page-title">Training Exposure</h1>
        <p>
          Review PhishGuard&apos;s fixed cybersecurity training modules. Reading
          or opening a module does not record completion; use the explicit
          completion action when you are ready to record your participation.
        </p>
        <p className="training-intro-note">
          Training Exposure represents module completion, not proof of
          cybersecurity competence or learning effectiveness.
        </p>
      </section>

      <section
        className="training-progress-section"
        aria-labelledby="training-progress-heading"
        aria-busy={progressLoading}
      >
        <div className="section-heading">
          <div>
            <h2 id="training-progress-heading">Overall progress</h2>
            <p>
              Progress and Training Exposure are calculated by the PhishGuard
              backend.
            </p>
          </div>

          <button
            className="training-reload-button"
            type="button"
            onClick={loadTraining}
            disabled={pendingModuleId !== null}
          >
            Reload status
          </button>
        </div>

        {progressLoading ? (
          <div className="awareness-loading-state">
            <div className="awareness-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="awareness-status" role="status">
              Loading training progress...
            </p>
          </div>
        ) : progressError ? (
          <TrainingErrorState error={progressError} onRetry={loadTraining} />
        ) : progress ? (
          <div className="training-progress-grid">
            <div className="training-progress-stat">
              <span className="training-progress-label">
                Completed modules
              </span>
              <strong className="training-progress-value">
                {progress.completedModules}
              </strong>
            </div>

            <div className="training-progress-stat">
              <span className="training-progress-label">Total modules</span>
              <strong className="training-progress-value">
                {progress.totalModules}
              </strong>
            </div>

            <div className="training-progress-stat">
              <span className="training-progress-label">
                Training Exposure
              </span>
              <strong className="training-progress-value">
                {progress.trainingExposure}%
              </strong>
            </div>
          </div>
        ) : (
          <p className="awareness-status" role="status">
            Training progress is unavailable right now.
          </p>
        )}
      </section>

      <section
        className="training-modules-section"
        aria-labelledby="training-modules-heading"
        aria-busy={modulesLoading || pendingModuleId !== null}
      >
        <div className="section-heading">
          <div>
            <h2 id="training-modules-heading">Training modules</h2>
            <p>
              Read each module, then explicitly mark it complete when you are
              ready.
            </p>
          </div>
        </div>

        {completionMessage && (
          <p
            className="training-completion-status"
            role="status"
            aria-live="polite"
            ref={completionStatusRef}
            tabIndex="-1"
          >
            {completionMessage}
          </p>
        )}

        <TrainingErrorState
          error={completionError}
          onRetry={retryCompletion}
          retryLabel="Try again"
        />

        {modulesLoading ? (
          <div className="awareness-loading-state">
            <div className="awareness-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="awareness-status" role="status">
              Loading training modules...
            </p>
          </div>
        ) : modulesError ? (
          <TrainingErrorState error={modulesError} onRetry={loadTraining} />
        ) : modules.length === 0 ? (
          <p className="awareness-status" role="status">
            No training modules are available right now.
          </p>
        ) : (
          <div className="training-module-list">
            {modules.map((module) => {
              const isPending = pendingModuleId === module.moduleId;

              return (
                <article
                  className={`training-module ${
                    module.completed ? "training-module-completed" : ""
                  }`}
                  key={module.moduleId}
                >
                  <div className="training-module-header">
                    <div>
                      <h3>{module.title}</h3>
                      <p className="training-module-objective">
                        {module.learningObjective}
                      </p>
                    </div>

                    <span className="training-module-status">
                      {module.completed ? "Completed" : "Not completed"}
                    </span>
                  </div>

                  {module.completed && (
                    <p className="training-completion-date">
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

                  <div className="training-module-content">
                    {module.content.map((section, index) => (
                      <div
                        className="training-content-section"
                        key={`${module.moduleId}-${section.heading}-${index}`}
                      >
                        <h4>{section.heading}</h4>
                        <ul>
                          {section.points.map((point, pointIndex) => (
                            <li key={`${section.heading}-${pointIndex}`}>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {!module.completed && (
                    <div className="training-module-actions">
                      <p>
                        Completion is recorded only when you choose the action
                        below.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleComplete(module)}
                        disabled={pendingModuleId !== null}
                      >
                        {isPending
                          ? "Recording completion..."
                          : "Mark module complete"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default TrainingPage;
