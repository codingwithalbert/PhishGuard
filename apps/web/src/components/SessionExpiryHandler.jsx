import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  isTokenRemovalStorageEvent,
  SESSION_EXPIRED_EVENT,
  SESSION_EXPIRED_MESSAGE
} from "../services/session";

function isPublicAuthPath(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/reset-password/")
  );
}

function SessionExpiryHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    function navigateToLogin(state) {
      const currentLocation = locationRef.current;

      if (currentLocation.pathname === "/login") {
        return;
      }

      navigate("/login", {
        replace: true,
        state
      });
    }

    function handleSessionExpired(event) {
      const message =
        typeof event.detail?.message === "string"
          ? event.detail.message
          : SESSION_EXPIRED_MESSAGE;

      navigateToLogin({ message });
    }

    function handleStorage(event) {
      if (!isTokenRemovalStorageEvent(event)) {
        return;
      }

      if (isPublicAuthPath(locationRef.current.pathname)) {
        return;
      }

      navigateToLogin(undefined);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener("storage", handleStorage);
    };
  }, [navigate]);

  return null;
}

export default SessionExpiryHandler;
