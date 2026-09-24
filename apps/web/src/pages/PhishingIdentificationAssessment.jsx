import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getLatestPhishingIdentificationAssessment,
  getPhishingIdentificationScenarios,
  submitPhishingIdentificationAssessment
} from "../services/api";

function isScenarioSet(scenarios) {
  return (
    Array.isArray(scenarios) &&
    scenarios.length === 10 &&
    scenarios.every(
      (scenario) =>
        Number.isInteger(scenario?.scenarioId) &&
        typeof scenario?.scenario === "string" &&
        typeof scenario?.question === "string" &&
        Array.isArray(scenario?.choices) &&
        scenario.choices.length === 4 &&
        scenario.choices.every(
          (choice) =>
            typeof choice?.value === "string" &&
            typeof choice?.text === "string"
        )
    )
  );
}

function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
    status: error?.status
  };
}

function formatCompletedAt(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Completion date unavailable"
    : date.toLocaleString();
}

function PhishingIdentificationAssessment() {
  const navigate = useNavigate();
  const scenarioRefs = useRef({});
  const resultHeadingRef = useRef(null);

  const [scenarios, setScenarios] = useState([]);
  const [answers, setAnswers] = useState({});
  const [latestResult, setLatestResult] = useState(null);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [latestLoading, setLatestLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scenariosError, setScenariosError] = useState(null);
  const [latestError, setLatestError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);

  const loadAssessment = useCallback(async () => {
    setScenariosLoading(true);
    setLatestLoading(true);
    setScenariosError(null);
    setLatestError(null);

    const [scenariosResponse, latestResponse] = await Promise.allSettled([
      getPhishingIdentificationScenarios(),
      getLatestPhishingIdentificationAssessment()
    ]);

    if (scenariosResponse.status === "fulfilled") {
      const loadedScenarios = scenariosResponse.value?.scenarios;

      if (isScenarioSet(loadedScenarios)) {
        setScenarios(loadedScenarios);
      } else {
        setScenarios([]);
        setScenariosError({
          message:
            "The phishing scenarios could not be loaded in the expected format.",
          status: 500
        });
      }
    } else {
      setScenarios([]);
      setScenariosError(
        getErrorDetails(
          scenariosResponse.reason,
          "The phishing scenarios could not be loaded."
        )
      );
    }

    if (latestResponse.status === "fulfilled") {
      const result = latestResponse.value?.assessment;

      if (result) {
        setLatestResult(result);
      } else {
        setLatestError({
          message: "The latest assessment result could not be read.",
          status: 500
        });
      }
    } else if (latestResponse.reason?.status !== 404) {
      setLatestError(
        getErrorDetails(
          latestResponse.reason,
          "The latest assessment result could not be loaded."
        )
      );
    } else {
      setLatestResult(null);
    }

    setScenariosLoading(false);
    setLatestLoading(false);
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadAssessment();
    }

    loadOnMount();
  }, [loadAssessment]);

  useEffect(() => {
    if (submittedResult) {
      resultHeadingRef.current?.focus();
    }
  }, [submittedResult]);

  const answeredCount = scenarios.reduce(
    (count, scenario) =>
      count + (answers[scenario.scenarioId] ? 1 : 0),
    0
  );
  const isComplete =
    scenarios.length === 10 && answeredCount === scenarios.length;
  const displayedResult = submittedResult || latestResult;

  function handleAnswerChange(scenarioId, selectedAnswer) {
    setFormError(null);
    setAnswers((current) => ({
      ...current,
      [scenarioId]: selectedAnswer
    }));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  function focusScenario(scenarioId) {
    scenarioRefs.current[scenarioId]?.querySelector("input")?.focus();
  }

  function handleStartAnotherAttempt() {
    setAnswers({});
    setSubmittedResult(null);
    setFormError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const unansweredScenario = scenarios.find(
      (scenario) => !answers[scenario.scenarioId]
    );

    if (unansweredScenario || !isComplete) {
      setFormError({
        message: "Answer all 10 scenarios before submitting.",
        status: 400
      });

      if (unansweredScenario) {
        focusScenario(unansweredScenario.scenarioId);
      }

      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      const submittedAnswers = scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        selectedAnswer: answers[scenario.scenarioId]
      }));

      const data = await submitPhishingIdentificationAssessment(
        submittedAnswers
      );

      if (!data?.assessment) {
        throw new Error("The assessment result could not be read.");
      }

      setLatestResult(data.assessment);
      setSubmittedResult(data.assessment);
    } catch (error) {
      setFormError(
        getErrorDetails(
          error,
          "The assessment could not be submitted. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="awareness-page phishing-assessment-page">
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Phishing Identification</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Phishing identification navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro">
        <h1 className="awareness-page-title">
          Phishing Identification Assessment
        </h1>
        <p>
          Review controlled educational scenarios to receive a
          backend-calculated Phishing Identification Score. This learning
          activity does not determine whether a real message or website is
          malicious.
        </p>
      </section>

      <section
        className={`awareness-result-section ${
          submittedResult ? "awareness-result-success" : ""
        }`}
        aria-labelledby="phishing-result-heading"
      >
        <h2
          id="phishing-result-heading"
          ref={resultHeadingRef}
          tabIndex="-1"
        >
          {submittedResult
            ? "Assessment submitted"
            : "Latest assessment result"}
        </h2>

        {latestLoading ? (
          <p className="awareness-status" role="status">
            Loading latest result...
          </p>
        ) : latestError ? (
          <div className="awareness-inline-error" role="alert">
            <p>{latestError.message}</p>
            {latestError.status === 401 && (
              <p>
                <Link to="/login">Sign in again</Link>
              </p>
            )}
          </div>
        ) : displayedResult ? (
          <>
            <p className="awareness-score-label">
              Backend-calculated Phishing Identification Score
            </p>
            <p className="awareness-score">
              {displayedResult.score}
              <span>/100</span>
            </p>
            <p>
              Completed {formatCompletedAt(displayedResult.completedAt)}
            </p>
            <p>
              {displayedResult.totalScenarios} scenarios completed
            </p>
            {submittedResult && (
              <>
                <p className="success-message" role="status">
                  Your assessment was submitted successfully.
                </p>
                <button
                  className="phishing-new-attempt"
                  type="button"
                  onClick={handleStartAnotherAttempt}
                >
                  Start another attempt
                </button>
              </>
            )}
          </>
        ) : (
          <div className="awareness-empty-state">
            <p>
              No completed phishing identification assessment yet. Complete
              the scenarios below to create your first result.
            </p>
          </div>
        )}
      </section>

      <section
        className="assessment-section"
        aria-labelledby="phishing-form-heading"
        aria-busy={scenariosLoading || submitting}
      >
        <div className="section-heading">
          <div>
            <h2 id="phishing-form-heading">Complete the scenarios</h2>
            <p>Select one answer for each scenario.</p>
          </div>

          {!scenariosLoading && !submittedResult && (
            <span className="assessment-progress" aria-live="polite">
              {answeredCount} of {scenarios.length} answered
            </span>
          )}
        </div>

        {scenariosLoading ? (
          <div className="awareness-loading-state">
            <div className="awareness-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="awareness-status" role="status">
              Loading phishing scenarios...
            </p>
          </div>
        ) : scenariosError ? (
          <div className="awareness-inline-error" role="alert">
            <p>{scenariosError.message}</p>
            {scenariosError.status === 401 && (
              <p>
                <Link to="/login">Sign in again</Link>
              </p>
            )}
            <button type="button" onClick={loadAssessment}>
              Try again
            </button>
          </div>
        ) : submittedResult ? (
          <p className="awareness-status">
            Your completed assessment is shown above. Start another attempt
            when you are ready to create a new result.
          </p>
        ) : (
          <form className="awareness-form" onSubmit={handleSubmit}>
            {formError && (
              <div className="awareness-inline-error" role="alert">
                <p>{formError.message}</p>
                {formError.status === 401 && (
                  <p>
                    <Link to="/login">Sign in again</Link>
                  </p>
                )}
              </div>
            )}

            <ol className="awareness-question-list">
              {scenarios.map((scenario) => {
                const selectedAnswer =
                  answers[scenario.scenarioId] || "";

                return (
                  <li
                    className="awareness-question"
                    key={scenario.scenarioId}
                    ref={(element) => {
                      scenarioRefs.current[scenario.scenarioId] = element;
                    }}
                  >
                    <fieldset>
                      <legend>
                        <span className="question-number">
                          Scenario {scenario.scenarioId}
                        </span>
                        <span className="phishing-scenario-copy">
                          {scenario.scenario}
                        </span>
                        <span className="phishing-question-prompt">
                          {scenario.question}
                        </span>
                      </legend>

                      <div className="awareness-choices">
                        {scenario.choices.map((choice) => {
                          const inputId = `phishing-scenario-${scenario.scenarioId}-${choice.value}`;

                          return (
                            <label
                              className={`awareness-choice ${
                                selectedAnswer === choice.value
                                  ? "awareness-choice-selected"
                                  : ""
                              }`}
                              htmlFor={inputId}
                              key={choice.value}
                            >
                              <input
                                id={inputId}
                                name={`phishing-scenario-${scenario.scenarioId}`}
                                type="radio"
                                value={choice.value}
                                checked={
                                  selectedAnswer === choice.value
                                }
                                onChange={() =>
                                  handleAnswerChange(
                                    scenario.scenarioId,
                                    choice.value
                                  )
                                }
                                disabled={submitting}
                              />
                              <span>
                                {choice.value}. {choice.text}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </li>
                );
              })}
            </ol>

            <div className="assessment-actions">
              <p>
                Your answers will be submitted as scenario IDs and selected
                answers only.
              </p>
              <button
                type="submit"
                disabled={!isComplete || submitting}
              >
                {submitting ? "Submitting..." : "Submit assessment"}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export default PhishingIdentificationAssessment;
