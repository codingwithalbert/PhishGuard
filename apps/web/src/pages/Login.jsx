import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import { loginUser, toSafeErrorMessage } from "../services/api";
import { storeSession } from "../services/session";

const LOGIN_ERROR_MESSAGE =
  "Sign in could not be completed. Please try again.";

/*
 * Informational context rows for the Login V2 "Desk Split" branding pane.
 * Rendered only as supplementary rows at the desktop auth breakpoint;
 * wording stays accurate to what the product implements.
 */
const LOGIN_CONTEXT = [
  {
    label: "Analyze suspicious URLs",
    description: "Review potential phishing indicators."
  },
  {
    label: "Build awareness",
    description: "Learn to recognize phishing attempts."
  },
  {
    label: "Report incidents",
    description: "Submit suspicious activity for review."
  }
];

function getLoginNotice(locationState) {
  return typeof locationState?.message === "string"
    ? locationState.message
    : "";
}

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState(() =>
    getLoginNotice(location.state)
  );

  const [form, setForm] = useState({
    email: "",
    password: ""
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setNotice("");
    setLoading(true);

    try {
      const data = await loginUser(form.email, form.password);

      storeSession(data.token, data.user);

      navigate("/dashboard");
    } catch (err) {
      setError(toSafeErrorMessage(err, LOGIN_ERROR_MESSAGE));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back."
      description="Sign in to continue to your PhishGuard workspace."
      context={LOGIN_CONTEXT}
    >
      <form onSubmit={handleSubmit}>
        <p className="auth-panel-label">Account access</p>

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

        <div className="auth-password-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            required
            maxLength="128"
            autoComplete="current-password"
          />
          <Link
            to="/forgot-password"
            className="auth-forgot-link"
          >
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>

        <p className="auth-footer-link">
          Don&apos;t have an account? <Link to="/register">Register</Link>
        </p>
      </form>

      {error && <p role="alert">{error}</p>}

      {notice && (
        <p className="success-message" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </AuthLayout>
  );
}

export default Login;
