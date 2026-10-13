import { Link, useLocation } from "react-router-dom";
import {
  getAriaCurrent,
  getNavClassName,
  getVisibleGroups
} from "./navGroups";
import BrandMark from "./BrandMark";

/*
 * Desktop primary navigation. Persistent grouped sidebar with explicit
 * active state, role-gated entries, and logout pinned to the bottom.
 * Rendered hidden below the 1024px shell breakpoint (see shell.css).
 *
 * Phase 1A-1: four states are distinguished so a Dashboard subsection never
 * reads as an independent page.
 *
 * - current      the exact destination for this location
 * - parent       the current page while one of its subsections is selected
 * - subsection  a child destination of the current page
 * - idle         a destination that is not currently being viewed
 *
 * The class and aria-current helpers are shared with the mobile drawer.
 */
function Sidebar({ role, onLogout }) {
  const location = useLocation();
  const groups = getVisibleGroups(role);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          <BrandMark />
        </div>

        <div>
          <span className="sidebar-brand-name">PhishGuard</span>
          <span className="sidebar-brand-tagline">
            Phishing awareness &amp; response
          </span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>

            {group.items.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className={getNavClassName(
                  item,
                  location.pathname,
                  location.hash
                )}
                aria-current={getAriaCurrent(
                  item,
                  location.pathname,
                  location.hash
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
