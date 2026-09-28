/*
 * Shared public-auth layout for Login, Register, Forgot Password, and
 * Reset Password. Provides the PhishGuard brand identity and a consistent
 * centered structure so the four pages feel connected to the authenticated
 * application without duplicating markup.
 */
function AuthLayout({ title, description, children }) {
  return (
    <main className="auth-main">
      <div className="auth-brand">
        <div className="brand-mark" aria-hidden="true">
          PG
        </div>
        <span className="auth-brand-name">PhishGuard</span>
      </div>

      <h1>{title}</h1>
      {description ? (
        <p className="auth-description">{description}</p>
      ) : null}

      {children}
    </main>
  );
}

export default AuthLayout;
