import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset, toSafeErrorMessage } from "../services/api";

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";
const REQUEST_ERROR_MESSAGE =
  "We could not process your request. Please try again later.";

function ForgotPassword() {
  const [form, setForm] = useState({
    email: ""
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    // Prevents accidental duplicate submissions while a request is pending.
    if (loading) {
      return;
    }

    setMessage("");
    setError("");
    setLoading(true);

    requestPasswordReset(form.email)
      .then((data) => {
        // The API answers every syntactically valid request with one generic
        // message, so this page never reveals whether an account exists.
        setMessage(data?.message || GENERIC_SUCCESS_MESSAGE);
      })
      .catch((err) => {
        setError(toSafeErrorMessage(err, REQUEST_ERROR_MESSAGE));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <main>
      <h1>Reset your PhishGuard password</h1>

      <p>
        Enter the email address for your account. If a reset link can be sent
        it will arrive by email and expires after 15 minutes.
      </p>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            required
            maxLength="254"
            autoComplete="email"
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Sending reset link..." : "Send reset link"}
        </button>
      </form>

      {message && <p className="success-message">{message}</p>}
      {error && <p role="alert">{error}</p>}

      <p>
        Remembered your password? <Link to="/login">Back to login</Link>
      </p>
    </main>
  );
}

export default ForgotPassword;
