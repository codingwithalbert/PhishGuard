import { useLocation } from "react-router-dom";

/*
 * Compact top header for the authenticated shell.
 *
 * Contextual orientation only: current page identity, compact role
 * context, and the mobile navigation trigger. It intentionally does not
 * duplicate the primary navigation that lives in the sidebar/drawer.
 */
function getPageTitle(pathname) {
  if (pathname === "/dashboard") {
    return "Dashboard";
  }

  if (pathname === "/awareness") {
    return "Awareness Assessment";
  }

  if (pathname === "/phishing-identification") {
    return "Phishing Identification";
  }

  if (pathname === "/training") {
    return "Training";
  }

  if (pathname === "/progress") {
    return "Progress";
  }

  if (pathname === "/reports") {
    return "Reports";
  }

  if (pathname.startsWith("/reports/new")) {
    return "Report to school IT";
  }

  if (pathname.startsWith("/reports")) {
    return "Report detail";
  }

  if (pathname.startsWith("/review")) {
    return "IT Review";
  }

  if (pathname === "/research") {
    return "Research Analytics";
  }

  if (pathname === "/profile") {
    return "Profile";
  }

  return "PhishGuard";
}

function TopHeader({ menuButtonRef, menuOpen, onMenuToggle, role }) {
  const location = useLocation();

  return (
    <header className="topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="topbar-menu-button"
        onClick={onMenuToggle}
        aria-expanded={menuOpen}
        aria-controls="mobile-nav"
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4.5h14M2 9h14M2 13.5h14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <span className="topbar-title">
        {getPageTitle(location.pathname)}
      </span>

      {role ? <span className="topbar-role">{role}</span> : null}
    </header>
  );
}

export default TopHeader;
