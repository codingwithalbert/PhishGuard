const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
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

// Coarse database readiness, mapped from the Mongoose connection state through a
// CLOSED set of words.
//
// `readyState` is an integer; the driver's own string for it is deliberately not
// used, so no driver-supplied text can reach a response unfiltered. Only these
// four words are ever published: no host, port, URI, credential, driver version,
// or connection diagnostic is exposed.
function describeDatabaseReadiness(readyState) {
  const states = mongoose.Connection.STATES;

  if (readyState === states.connected) {
    return { ready: true, state: "connected" };
  }

  if (readyState === states.connecting) {
    return { ready: false, state: "connecting" };
  }

  if (readyState === states.disconnecting) {
    return { ready: false, state: "disconnecting" };
  }

  if (readyState === states.disconnected) {
    return { ready: false, state: "disconnected" };
  }

  return { ready: false, state: "unavailable" };
}

function createApp() {
  const app = express();

  // Trust exactly the one Render edge hop that terminates TLS and forwards
  // requests to this service. Bounded to a single hop (never `true`) so
  // `req.ip` - the key of the public authentication rate limiters - resolves
  // to the client address that trusted hop observed, while attacker-prepended
  // leftmost X-Forwarded-For entries are ignored and cannot bypass limits.
  app.set("trust proxy", 1);

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

  // Readiness is deliberately a SEPARATE route from liveness.
  //
  // `/api/health` answers "is this process sane" and always returns 200 while
  // the process is up. It must never fail because the database is briefly
  // unavailable: a platform that restarts an unhealthy container turns a
  // transient database blip into a restart loop, which is worse than the outage
  // that caused it.
  //
  // `/api/ready` answers "should traffic be routed here", and is the endpoint a
  // load balancer or platform should probe for traffic eligibility.
  app.get("/api/ready", (req, res) => {
    // Never cached: readiness is a live signal, and a cached 200 would keep a
    // stopped instance in rotation.
    res.set("Cache-Control", "no-store");

    const state = describeDatabaseReadiness(mongoose.connection.readyState);

    return res.status(state.ready ? 200 : 503).json({
      status: state.ready ? "ready" : "not_ready",
      service: "phishguard-api",
      database: state.state
    });
  });

  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  describeDatabaseReadiness
};