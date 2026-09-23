import {
  BrowserRouter,
  Navigate,
  Route,
  Routes
} from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import AwarenessAssessment from "./pages/AwarenessAssessment";
import PhishingIdentificationAssessment from "./pages/PhishingIdentificationAssessment";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
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

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;