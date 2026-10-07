const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const analysisRoutes = require("./routes/analysis.routes");
const authRoutes = require("./routes/auth.routes");
const awarenessRoutes = require("./routes/awareness.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const phishingIdentificationRoutes = require("./routes/phishingIdentification.routes");
const progressRoutes = require("./routes/progress.routes");
const trainingRoutes = require("./routes/training.routes");
const reportingRoutes = require("./routes/reporting.routes");
const researchRoutes = require("./routes/research.routes");
const errorHandler = require("./middleware/error.middleware");

// The single source of truth for PhishGuard's HTTP middleware configuration.
//
// This module only builds and configures the Express application. It never
// connects to a database and never calls `app.listen()`; both belong to the
// bootstrap in `server.js`. Importing this file therefore has no side effects
// beyond compiling Mongoose models, which makes the real production
// middleware stack importable from an isolated test.
//
// `CLIENT_URL` is read inside `createApp()` on every call rather than at module
// load, so the CORS origin reflects the environment at the moment the app is
// built. A test can therefore set the variable, build an app, and restore the
// previous value without any module-cache manipulation.

const DEFAULT_CLIENT_URL = "http://localhost:5173";
const JSON_BODY_LIMIT = "1mb";

function createApp() {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: process.env.CLIENT_URL || DEFAULT_CLIENT_URL,
      credentials: true
    })
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use("/api/auth", authRoutes);
  app.use("/api/analyze", analysisRoutes);
  app.use("/api/awareness", awarenessRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/phishing-identification", phishingIdentificationRoutes);
  app.use("/api/progress", progressRoutes);
  app.use("/api/training", trainingRoutes);
  app.use("/api/reports", reportingRoutes);
  app.use("/api/research", researchRoutes);

  app.get("/api/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      service: "phishguard-api"
    });
  });

  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp
};