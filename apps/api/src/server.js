require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const analysisRoutes = require("./routes/analysis.routes");
const authRoutes = require("./routes/auth.routes");
const awarenessRoutes = require("./routes/awareness.routes");
const phishingIdentificationRoutes = require("./routes/phishingIdentification.routes");
const errorHandler = require("./middleware/error.middleware");

const app = express();
const PORT = process.env.PORT || 5000;

function validateEnvironment() {
  const requiredVariables = [
    "MONGODB_URI",
    "JWT_SECRET"
  ];

  const missingVariables = requiredVariables.filter(
    (variable) => !process.env[variable]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingVariables.join(", ")}`
    );
  }
}

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/analyze", analysisRoutes);
app.use("/api/awareness", awarenessRoutes);
app.use("/api/phishing-identification", phishingIdentificationRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "phishguard-api"
  });
});

app.use(errorHandler);

async function startServer() {
  try {
    validateEnvironment();

    await connectDB();

    app.listen(PORT, () => {
      console.log(`PhishGuard API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();