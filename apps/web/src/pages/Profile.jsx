import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReportingNavLinks from "../components/reporting/ReportingNavLinks";
import {
  changePassword,
  getCurrentProfile,
  updateProfileName
} from "../services/api";

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const PROFILE_LOAD_ERROR_MESSAGE =
  "Your account information could not be loaded. Please try again.";
const PROFILE_UPDATE_ERROR_MESSAGE =
  "Your profile could not be updated. Please try again.";
const CHANGE_PASSWORD_ERROR_MESSAGE =
  "Your password could not be changed. Please try again.";

const ROLES = ["user", "staff", "admin"];

function isSafeProfileUser(user) {
  return (
    user !== null &&
    typeof user === "object" &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    ROLES.includes(user.role) &&
    user.id !== undefined &&
    user.id !== null
  );
}

function isProfileResponse(data) {
  return data?.success === true && isSafeProfileUser(data.user);
}

function isChangePasswordResponse(data) {
  return (
    data?.success === true &&
    typeof data.message === "string" &&
    data.message.length > 0
  );
}

// The change-password helper flags only the frozen-contract rejection (401 with
// "Current password is incorrect"), which is a form error rather than an expired
// session. Every other status, including any other 401 and all 403 responses,
// keeps the existing session-error behaviour used across the app.
function isSessionError(error) {
  if (error?.isCurrentPasswordRejection) {
    return false;
  }

  return error?.status === 401 || error?.status === 403;
}

// Copies only the fields the page renders and classifies. The
// `isCurrentPasswordRejection` boolean is carried over explicitly because
// isSessionError() needs it: dropping it would reclassify the frozen-contract
// 401 as a session error. No other property of the original error is copied.
function getErrorDetails(error, fallback) {
  return {
    message: error?.message || fallback,
    status: error?.status,
    isCurrentPasswordRejection: error?.isCurrentPasswordRejection === true
  };
}

// Replaces the stored snapshot with only the safe profile fields the session
// already relies on. No password, token, or other account data is stored.
function updateStoredUserSnapshot(user) {
  try {
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      })
    );
  } catch {
    // A storage failure must not break the profile update itself.
  }
}

function ProfileLoadingState() {
  return (
    <section
      className="profile-panel profile-loading-panel"
      aria-label="Loading account information"
      aria-busy="true"
    >
      <div className="awareness-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <p className="awareness-status" role="status" aria-live="polite">
        Loading your account information...
      </p>
    </section>
  );
}

function ProfileErrorState({ error, onRetry }) {
  return (
    <section className="profile-panel profile-error-panel" role="alert">
      <h2>Account information is unavailable</h2>
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

function AccountDetails({ profile }) {
  return (
    <section
      className="profile-panel profile-details"
      aria-labelledby="profile-details-heading"
    >
      <h2 id="profile-details-heading">Account details</h2>
      <p className="profile-panel-note">
        These values are supplied by the backend. Email and role cannot be
        changed from this page.
      </p>

      <dl className="profile-details-list">
        <div>
          <dt>Name</dt>
          <dd>{profile.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            {profile.email}{" "}
            <span className="profile-readonly-tag">Read-only</span>
          </dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>
            {profile.role}{" "}
            <span className="profile-readonly-tag">Read-only</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EditProfileForm({ profile, onUpdated }) {
  const [name, setName] = useState(profile.name);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setMessage("");
    setError(null);

    const trimmedName = name.trim();

    if (
      trimmedName.length < NAME_MIN_LENGTH ||
      trimmedName.length > NAME_MAX_LENGTH
    ) {
      setError({
        message: `Name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters`
      });
      return;
    }

    setSaving(true);

    updateProfileName(trimmedName)
      .then((data) => {
        if (!isProfileResponse(data)) {
          const formatError = new Error(
            "The profile response could not be read in the expected format."
          );

          formatError.status = 500;
          throw formatError;
        }

        setName(data.user.name);
        setMessage("Profile updated successfully.");
        onUpdated(data.user);
      })
      .catch((requestError) => {
        setError(
          getErrorDetails(
            requestError,
            PROFILE_UPDATE_ERROR_MESSAGE
          )
        );
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <section
      className="profile-panel profile-form-panel"
      aria-labelledby="profile-edit-heading"
    >
      <h2 id="profile-edit-heading">Edit profile</h2>
      <p className="profile-panel-note">
        Your display name is the only field you can change here.
      </p>

      <form onSubmit={handleSubmit} aria-describedby="profile-edit-note">
        <p className="profile-form-note" id="profile-edit-note">
          Use {NAME_MIN_LENGTH} to {NAME_MAX_LENGTH} characters.
        </p>

        <div>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={NAME_MIN_LENGTH}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="name"
          />
        </div>

        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save name"}
        </button>
      </form>

      {message && (
        <p className="success-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

      {error && (
        <div className="profile-form-error" role="alert">
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ChangePasswordForm() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: ""
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setMessage("");
    setError(null);

    if (
      form.newPassword.length < PASSWORD_MIN_LENGTH ||
      form.newPassword.length > PASSWORD_MAX_LENGTH
    ) {
      setError({
        message: `New password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`
      });
      return;
    }

    if (form.newPassword !== form.confirmNewPassword) {
      setError({ message: "New passwords do not match." });
      return;
    }

    setSaving(true);

    // Only the current and new password are sent. The confirmation field stays
    // in the browser, and the current session is left untouched on success.
    changePassword(form.currentPassword, form.newPassword)
      .then((data) => {
        if (!isChangePasswordResponse(data)) {
          const formatError = new Error(
            "The password change response could not be read in the expected format."
          );

          formatError.status = 500;
          throw formatError;
        }

        setForm({
          currentPassword: "",
          newPassword: "",
          confirmNewPassword: ""
        });
        setMessage(data.message);
      })
      .catch((requestError) => {
        setError(
          getErrorDetails(
            requestError,
            CHANGE_PASSWORD_ERROR_MESSAGE
          )
        );
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <section
      className="profile-panel profile-form-panel"
      aria-labelledby="profile-password-heading"
    >
      <h2 id="profile-password-heading">Change password</h2>
      <p className="profile-panel-note">
        Your password keeps working for this and any other signed-in device
        until those sessions expire.
      </p>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="currentPassword">Current password</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            value={form.currentPassword}
            onChange={handleChange}
            required
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="current-password"
          />
        </div>

        <div>
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            value={form.newPassword}
            onChange={handleChange}
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label htmlFor="confirmNewPassword">
            Confirm new password
          </label>
          <input
            id="confirmNewPassword"
            name="confirmNewPassword"
            type="password"
            value={form.confirmNewPassword}
            onChange={handleChange}
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" disabled={saving}>
          {saving ? "Updating..." : "Change password"}
        </button>
      </form>

      {message && (
        <p className="success-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

      {error && (
        <div className="profile-form-error" role="alert">
          <p>{error.message}</p>

          {isSessionError(error) ? (
            <p>
              <Link to="/login">Sign in again</Link>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ProfilePage() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getCurrentProfile();

      if (!isProfileResponse(data)) {
        const formatError = new Error(
          "The account information could not be read in the expected format."
        );

        formatError.status = 500;
        throw formatError;
      }

      setProfile(data.user);
    } catch (requestError) {
      setProfile(null);
      setError(
        getErrorDetails(requestError, PROFILE_LOAD_ERROR_MESSAGE)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadOnMount() {
      await loadProfile();
    }

    loadOnMount();
  }, [loadProfile]);

  function handleProfileUpdated(updatedUser) {
    setProfile(updatedUser);
    updateStoredUserSnapshot(updatedUser);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
  }

  return (
    <main className="awareness-page profile-page" aria-busy={loading}>
      <header className="dashboard-header awareness-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PG
          </div>

          <div>
            <h1>PhishGuard</h1>
            <p>Profile</p>
          </div>
        </div>

        <nav
          className="dashboard-nav"
          aria-label="Profile navigation"
        >
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/progress">Progress</Link>
          <ReportingNavLinks />
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="awareness-intro profile-intro">
        <h1 className="awareness-page-title">Profile</h1>
        <p>
          Review your account details, update your display name, or change your
          password. Account information is always read from the server.
        </p>
        <p className="profile-intro-note">
          You can only manage your own account. Email address and role are
          read-only.
        </p>
      </section>

      {loading ? (
        <ProfileLoadingState />
      ) : error ? (
        <ProfileErrorState error={error} onRetry={loadProfile} />
      ) : profile ? (
        <>
          <AccountDetails profile={profile} />
          <EditProfileForm
            key={profile.id ?? profile.name}
            profile={profile}
            onUpdated={handleProfileUpdated}
          />
          <ChangePasswordForm />
        </>
      ) : null}
    </main>
  );
}

export default ProfilePage;
