import { useCallback, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";
import MobileNav from "./MobileNav";

function getStoredUserRole() {
  try {
    const storedUser = localStorage.getItem("user");

    if (!storedUser) {
      return null;
    }

    const parsedUser = JSON.parse(storedUser);

    return typeof parsedUser?.role === "string"
      ? parsedUser.role
      : null;
  } catch {
    return null;
  }
}

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

  const openNav = useCallback(() => {
    setNavOpen(true);
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/login");
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
