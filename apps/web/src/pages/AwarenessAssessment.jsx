import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getAwarenessQuestions,
  getLatestAwarenessAssessment,
  submitAwarenessAssessment
} from "../services/api";

function isQuestionSet(questions) {
  return (
    Array.isArray(questions) &&
    questions.length === 10 &&
    questions.every(
      (question) =>
        Number.isInteger(question?.questionId) &&
        typeof question?.text === "string" &&
        Array.isArray(question?.choices) &&
        question.choices.length === 4 &&
        question.choices.every(
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

function AwarenessAssessment() {
  const navigate = useNavigate();
  const questionRefs = useRef({});
  const resultHeadingRef = useRef(null);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [latestResult, setLatestResult] = useState(null);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [latestLoading, setLatestLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [questionsError, setQuestionsError] = useState(null);
  const [latestError, setLatestError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);

  const loadAssessment = useCallback(async () => {
    setQuestionsLoading(true);
    setLatestLoading(true);
    setQuestionsError(null);
    setLatestError(null);

    const [questionsResponse, latestResponse] = await Promise.allSettled([
      getAwarenessQuestions(),
      getLatestAwarenessAssessment()
    ]);

    if (questionsResponse.status === "fulfilled") {
      const loadedQuestions = questionsResponse.value?.questions;

      if (isQuestionSet(loadedQuestions)) {
        setQuestions(loadedQuestions);
      } else {
        setQuestions([]);
        setQuestionsError({
          message:
            "The assessment questions could not be loaded in the expected format.",
          status: 500
        });
      }
    } else {
      setQuestions([]);
      setQuestionsError(
        getErrorDetails(
          questionsResponse.reason,
          "The assessment questions could not be loaded."
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

    setQuestionsLoading(false);
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

  const answeredCount = questions.reduce(
    (count, question) =>
      count + (answers[question.questionId] ? 1 : 0),
    0
  );
  const isComplete =
    questions.length === 10 && answeredCount === questions.length;
  const displayedResult = submittedResult || latestResult;

  function handleAnswerChange(questionId, selectedAnswer) {
    setFormError(null);
    setAnswers((current) => ({
      ...current,
      [questionId]: selectedAnswer
    }));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  function focusQuestion(questionId) {
    questionRefs.current[questionId]?.querySelector("input")?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const unansweredQuestion = questions.find(
      (question) => !answers[question.questionId]
    );

    if (unansweredQuestion || !isComplete) {
      setFormError({
        message: "Answer all 10 questions before submitting.",
        status: 400
      });

      if (unansweredQuestion) {
        focusQuestion(unansweredQuestion.questionId);
      }

      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      const submittedAnswers = questions.map((question) => ({
        questionId: question.questionId,
        selectedAnswer: answers[question.questionId]
      }));

      const data = await submitAwarenessAssessment(submittedAnswers);

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
    <main className="awareness-page">
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Cybersecurity Awareness</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Awareness navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro">
        <h1 className="awareness-page-title">Awareness Assessment</h1>
        <p>
          Complete this educational assessment to receive a backend-calculated
          Awareness Score. Your selected answers are evaluated by PhishGuard
          after submission.
        </p>
      </section>

      <section
        className={`awareness-result-section ${
          submittedResult ? "awareness-result-success" : ""
        }`}
        aria-labelledby="awareness-result-heading"
      >
        <h2
          id="awareness-result-heading"
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
              Backend-calculated Awareness Score
            </p>
            <p className="awareness-score">
              {displayedResult.score}
              <span>/100</span>
            </p>
            <p>
              Completed {formatCompletedAt(displayedResult.completedAt)}
            </p>
            <p>
              {displayedResult.totalQuestions} questions completed
            </p>
            {submittedResult && (
              <p className="success-message" role="status">
                Your assessment was submitted successfully.
              </p>
            )}
          </>
        ) : (
          <div className="awareness-empty-state">
            <p>
              No completed assessment yet. Complete the assessment below to
              create your first result.
            </p>
          </div>
        )}
      </section>

      <section
        className="assessment-section"
        aria-labelledby="assessment-form-heading"
        aria-busy={questionsLoading || submitting}
      >
        <div className="section-heading">
          <div>
            <h2 id="assessment-form-heading">Complete the assessment</h2>
            <p>Select one answer for each question.</p>
          </div>

          {!questionsLoading && !submittedResult && (
            <span className="assessment-progress" aria-live="polite">
              {answeredCount} of {questions.length} answered
            </span>
          )}
        </div>

        {questionsLoading ? (
          <div className="awareness-loading-state">
            <div className="awareness-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="awareness-status" role="status">
              Loading assessment questions...
            </p>
          </div>
        ) : questionsError ? (
          <div className="awareness-inline-error" role="alert">
            <p>{questionsError.message}</p>
            {questionsError.status === 401 && (
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
            Your completed assessment is shown above. Return to the dashboard
            or open this page again to begin another assessment.
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
              {questions.map((question) => {
                const selectedAnswer =
                  answers[question.questionId] || "";

                return (
                  <li
                    className="awareness-question"
                    key={question.questionId}
                    ref={(element) => {
                      questionRefs.current[question.questionId] = element;
                    }}
                  >
                    <fieldset>
                      <legend>
                        <span className="question-number">
                          Question {question.questionId}
                        </span>
                        <span>{question.text}</span>
                      </legend>

                      <div className="awareness-choices">
                        {question.choices.map((choice) => {
                          const inputId = `awareness-question-${question.questionId}-${choice.value}`;

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
                                name={`awareness-question-${question.questionId}`}
                                type="radio"
                                value={choice.value}
                                checked={
                                  selectedAnswer === choice.value
                                }
                                onChange={() =>
                                  handleAnswerChange(
                                    question.questionId,
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
                Your answers will be submitted as question IDs and selected
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

export default AwarenessAssessment;
