import { useLocation } from "react-router-dom";
import { getPageTitle } from "./navGroups";
import BrandMark from "./BrandMark";

/*
 * Compact top header for the authenticated shell.
 *
 * Contextual orientation only: current page identity, compact role
 * context, and the mobile navigation trigger. It intentionally does not
 * duplicate the primary navigation that lives in the sidebar/drawer.
 *
 * Phase 1A-2-1: the route-to-title mapping moved to navGroups so the header
 * and the navigation cannot disagree about what a page is called. Ordinary
 * pages resolve from their navigation label; only routes that intentionally
 * read differently carry their own title.
 */
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

      <BrandMark compact className="topbar-brand-mark" />

      <span className="topbar-title">
        {getPageTitle(location.pathname)}
      </span>

      {role ? <span className="topbar-role">{role}</span> : null}
    </header>
  );
}

export default TopHeader;
