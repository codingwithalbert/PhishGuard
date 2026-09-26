import { Link } from "react-router-dom";

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

function ReportingNavLinks() {
  const role = getStoredUserRole();
  const canViewReview =
    role === "staff" || role === "admin";

  return (
    <>
      <Link to="/reports">Reports</Link>
      {canViewReview && <Link to="/review">IT Review</Link>}
    </>
  );
}

export default ReportingNavLinks;
