/*
 * Shared public-auth layout for Login, Register, Forgot Password, and
 * Reset Password. Phase A of the Login V2 redesign ("Desk Split") replaces
 * the decorative auth scene with a calm two-pane composition: the brand,
 * page title, and optional product context on the left, and the single
 * form surface on the right. The layout collapses to one column and hides
 * the context rows below the desktop auth breakpoint (styles/brand.css).
 *
 * `context` is an optional array of informational { label, description }
 * pairs rendered in the intro pane; rows are never interactive.
 */
import BrandMark from "./BrandMark";
import useEntranceMotion from "../hooks/useEntranceMotion";

function AuthLayout({ title, description, context, children }) {
  const entranceRef = useEntranceMotion({
    selector:
      ":scope > .auth-intro .auth-brand, :scope > .auth-intro > h1, :scope > .auth-intro > .auth-description, :scope > .auth-intro > .auth-context, :scope > main.auth-main",
    activationKey: title,
    duration: 0.35,
    stagger: 0.045,
    offset: 10
  });

  return (
    <div className="auth-layout" ref={entranceRef}>
      <div className="auth-intro">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <BrandMark />
          </div>
          <span className="auth-brand-name">PhishGuard</span>
        </div>

        <h1>{title}</h1>
        {description ? (
          <p className="auth-description">{description}</p>
        ) : null}

        {Array.isArray(context) && context.length ? (
          <ul className="auth-context">
            {context.map((row) => (
              <li key={row.label}>
                <span className="auth-context-label">{row.label}</span>
                <span className="auth-context-description">
                  {row.description}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <main className="auth-main">{children}</main>
    </div>
  );
}

export default AuthLayout;
