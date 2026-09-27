import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { getVisibleGroups, isItemActive } from "./navGroups";

/*
 * Mobile/small-screen drawer navigation.
 *
 * Approved drawer model: hamburger trigger in the top header, grouped
 * role-gated navigation, logout inside the drawer, scrim behind it,
 * Escape-to-close, focus moved into the drawer on open and returned to
 * the trigger on close, and the drawer closes after navigation.
 */
function MobileNav({ open, onClose, onNavigate, onLogout, role }) {
  const closeButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const location = useLocation();

  // onClose is a stable useCallback in AppShell, so this effect only
  // re-runs when the open state itself changes.
  useEffect(() => {
    if (!open) {
      return;
    }

    closeButtonRef.current?.focus();

    const focusableSelectors = [
      "a[href]",
      "button:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      // Keep keyboard focus cycling inside the modal drawer so it cannot
      // move into the page behind the aria-modal dialog.
      if (event.key !== "Tab") {
        return;
      }

      const drawer = drawerRef.current;

      if (!drawer) {
        return;
      }

      const focusableElements = Array.from(
        drawer.querySelectorAll(focusableSelectors)
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      const focusIsInside = drawer.contains(activeElement);

      if (event.shiftKey) {
        if (!focusIsInside || activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else if (!focusIsInside || activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const groups = getVisibleGroups(role);

  return (
    <>
      <div
        className="mobile-nav-scrim"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="mobile-nav-drawer"
        id="mobile-nav"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="mobile-nav-header">
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true">
              PG
            </div>
            <span className="sidebar-brand-name">PhishGuard</span>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="mobile-nav-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l10 10M14 4L4 14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="mobile-nav-body" aria-label="Mobile">
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
                    onClick={onNavigate}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="mobile-nav-footer">
          <button
            type="button"
            className="sidebar-logout"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}

export default MobileNav;
