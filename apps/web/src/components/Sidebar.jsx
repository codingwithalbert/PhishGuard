import { Link, useLocation } from "react-router-dom";
import { getVisibleGroups, isItemActive } from "./navGroups";
import BrandMark from "./BrandMark";

/*
 * Desktop primary navigation. Persistent grouped sidebar with explicit
 * active state, role-gated entries, and logout pinned to the bottom.
 * Rendered hidden below the 1024px shell breakpoint (see shell.css).
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

            {group.items.map((item) => {
              const active = isItemActive(
                item,
                location.pathname,
                location.hash
              );

              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={
                    active ? "nav-item nav-item-active" : "nav-item"
                  }
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
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
