/*
 * Shared public-auth layout for Login, Register, Forgot Password, and
 * Reset Password. Provides the PhishGuard brand identity and a consistent
 * centered structure so the four pages feel connected to the authenticated
 * application without duplicating markup.
 */
import BrandMark from "./BrandMark";
import CyberScene from "./CyberScene";
import useEntranceMotion from "../hooks/useEntranceMotion";

function AuthLayout({ title, description, children }) {
  const entranceRef = useEntranceMotion({
    selector: ":scope > .auth-brand, :scope > h1, :scope > .auth-description, :scope > form",
    activationKey: title,
    duration: 0.35,
    stagger: 0.045,
    offset: 10
  });

  return (
    <div className="auth-layout">
      <main className="auth-main" ref={entranceRef}>
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

        {children}
      </main>
      <CyberScene />
    </div>
  );
}

export default AuthLayout;
