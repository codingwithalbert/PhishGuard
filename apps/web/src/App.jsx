import {
  BrowserRouter,
  Navigate,
  Route,
  Routes
} from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Progress from "./pages/Progress";
import Reports from "./pages/Reports";
import ReportCreate from "./pages/ReportCreate";
import ReportDetail from "./pages/ReportDetail";
import ReviewQueue from "./pages/ReviewQueue";
import ReviewReportDetail from "./pages/ReviewReportDetail";
import AwarenessAssessment from "./pages/AwarenessAssessment";
import PhishingIdentificationAssessment from "./pages/PhishingIdentificationAssessment";
import Training from "./pages/Training";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Password Reset V1: unauthenticated routes */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/reset-password/:token"
          element={<ResetPassword />}
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/progress"
          element={
            <ProtectedRoute>
              <Progress />
            </ProtectedRoute>
          }
        />

        <Route
          path="/awareness"
          element={
            <ProtectedRoute>
              <AwarenessAssessment />
            </ProtectedRoute>
          }
        />

        <Route
          path="/phishing-identification"
          element={
            <ProtectedRoute>
              <PhishingIdentificationAssessment />
            </ProtectedRoute>
          }
        />

        <Route
          path="/training"
          element={
            <ProtectedRoute>
              <Training />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports/new/:analysisId"
          element={
            <ProtectedRoute>
              <ReportCreate />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports/:reportId"
          element={
            <ProtectedRoute>
              <ReportDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="/review"
          element={
            <ProtectedRoute allowedRoles={["staff", "admin"]}>
              <ReviewQueue />
            </ProtectedRoute>
          }
        />

        <Route
          path="/review/:reportId"
          element={
            <ProtectedRoute allowedRoles={["staff", "admin"]}>
              <ReviewReportDetail />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;