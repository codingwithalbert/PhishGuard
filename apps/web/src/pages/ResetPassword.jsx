import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resetPassword, toSafeErrorMessage } from "../services/api";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const SUCCESS_MESSAGE =
  "Password reset successfully. You can now log in with your new password.";
const REQUEST_ERROR_MESSAGE =
  "Something went wrong. Please request a new reset link and try again.";

function ResetPassword() {
  // The raw reset token comes only from the route parameter. It is never
  // stored, logged, displayed, or added to a URL.
  const { token } = useParams();

  const [form, setForm] = useState({
    password: "",
    confirmPassword: ""
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

    if (
      form.password.length < PASSWORD_MIN_LENGTH ||
      form.password.length > PASSWORD_MAX_LENGTH
    ) {
      setError(
        `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`
      );
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    // confirmPassword is client-only and is never sent.
    resetPassword(token, form.password)
      .then((data) => {
        setMessage(data?.message || SUCCESS_MESSAGE);
      })
      .catch((err) => {
        // An invalid, expired, superseded, or already-used link produces one
        // safe API message. Nothing is auto-redirected, so the user can request
        // a new link from this page.
        setError(toSafeErrorMessage(err, REQUEST_ERROR_MESSAGE));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <main>
      <h1>Choose a new PhishGuard password</h1>

      <p>
        Reset links expire after 15 minutes and can only be used once. You will
        sign in with your new password after the reset.
      </p>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
          <p className="auth-help-note">
            Use {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange}
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Updating password..." : "Update password"}
        </button>
      </form>

      {message && (
        <>
          <p className="success-message">{message}</p>

          <p>
            <Link to="/login">Return to login</Link>
          </p>
        </>
      )}

      {error && <p role="alert">{error}</p>}

      <p>
        Need a new link? <Link to="/forgot-password">Request a reset link</Link>
      </p>
    </main>
  );
}

export default ResetPassword;
