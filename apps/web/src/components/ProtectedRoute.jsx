import { Navigate } from "react-router-dom";
import {
  getStoredToken,
  getStoredUserRole
} from "../services/session";

function ProtectedRoute({ children, allowedRoles }) {
  const token = getStoredToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    const role = getStoredUserRole();

    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}

export default ProtectedRoute;
