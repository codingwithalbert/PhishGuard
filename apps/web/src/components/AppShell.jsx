import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";
import MobileNav from "./MobileNav";
import {
  clearStoredSession,
  getStoredUserRole
} from "../services/session";
import { logoutUser } from "../services/api";

/*
 * Authenticated application shell (Major UI/UX V1).
 *
 * Persistent grouped sidebar on wide screens, compact top header, mobile
 * drawer navigation, skip-to-main-content, and a single logout action.
 * Mounted once through a react-router layout route so individual pages
 * never duplicate it. All routes, guards, and page behavior stay exactly
 * as they were; this component only provides the shared chrome.
 */
function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const role = getStoredUserRole();

  // Close the drawer when the location changes outside the drawer's own
  // controls (for example browser back while the drawer is open). The
  // drawer's links and buttons close it through closeNav below. This is
  // the documented "storing information from previous renders" pattern.
  const [prevLocation, setPrevLocation] = useState(location);

  if (prevLocation !== location) {
    setPrevLocation(location);

    if (navOpen) {
      setNavOpen(false);
    }
  }

  /*
   * Phase 0B-3: route-change focus and fragment scrolling.
   *
   * BrowserRouter supplies no focus restoration and no fragment scrolling,
   * so both are handled here.
   *
   * Focus moves to the main region only when the pathname actually changes.
   * The main region (tabIndex={-1}) is focused rather than the page heading
   * so focus never lands inside a role="status" live region, which would
   * cause the loading message and the focused element to be announced
   * together. preventScroll keeps that operation free of scroll effects.
   *
   * A hash is resolved by scrolling its target into view. React Router does
   * not do this itself, so without it the Dashboard #scanner and #history
   * anchors never moved the viewport. The targets sit in the normal
   * document flow, so window scrolling is the correct target and the
   * existing scroll-margin-top keeps the section clear of the sticky
   * header. scrollIntoView() inherits the existing CSS scroll behavior,
   * which the reduced-motion override already turns off.
   *
   * The previous pathname is seeded with the mount pathname, so the first
   * render is treated as unchanged and never moves focus or scrolls.
   *
   * This runs after commit, when the newly mounted page exists. No
   * requestAnimationFrame or timer is used: the targets render
   * unconditionally, so no deferred lookup is required.
   */
  const previousPathnameRef = useRef(location.pathname);
  const currentPathname = location.pathname;
  const currentHash = location.hash;

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;

    // Record the current pathname on every run so the next comparison
    // reflects the location this effect is reacting to.
    previousPathnameRef.current = currentPathname;

    const pathnameChanged = previousPathname !== currentPathname;

    if (pathnameChanged) {
      // A real page change: hand focus to the page's main region and start
      // it at the top, unless a fragment below says otherwise.
      document.getElementById("main-content")?.focus({ preventScroll: true });

      if (!currentHash) {
        window.scrollTo(0, 0);
      }
    }

    // Resolve a requested fragment for both cross-page and same-page
    // navigation. A same-page hash leaves focus on the activated link, so
    // only the viewport moves here.
    if (currentHash) {
      const targetId = currentHash.replace(/^#/, "");

      if (targetId) {
        document.getElementById(targetId)?.scrollIntoView();
      }
    }
  }, [currentPathname, currentHash]);

  const openNav = useCallback(() => {
    setNavOpen(true);
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  /*
   * Server-side logout (Phase 0 security hardening).
   *
   * Ordering is correctness-critical. `logoutUser()` captures the bearer token
   * synchronously at invocation (apiTransport calls getAuthToken() before its
   * first await), so it must be invoked BEFORE `clearStoredSession()`. The
   * local session is then cleared and navigation happens immediately, so the
   * user is signed out client-side no matter what the server does.
   *
   * The revocation request is best-effort: its promise is never awaited and a
   * network failure, timeout, 429, or 5xx is swallowed. No message or state
   * ever claims server-side revocation for an unconfirmed request; server-side
   * revocation is a server truth, not a UI promise. A late 401/403 from this
   * detached request is safely ignored by the token-mismatch guard in
   * session.js (the stored token is already gone), so no redirect storm or
   * error surface is created.
   */
  function handleLogout() {
    const revocation = logoutUser();

    clearStoredSession();

    navigate("/login");

    revocation.catch(() => {});
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar role={role} onLogout={handleLogout} />

      <div className="app-shell-workspace">
        <TopHeader
          menuButtonRef={menuButtonRef}
          menuOpen={navOpen}
          onMenuToggle={openNav}
          role={role}
        />

        <MobileNav
          open={navOpen}
          onClose={closeNav}
          onNavigate={closeNav}
          onLogout={handleLogout}
          role={role}
        />

        <Outlet />
      </div>
    </div>
  );
}

export default AppShell;
