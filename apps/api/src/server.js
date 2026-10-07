require("dotenv").config();

const connectDB = require("./config/db");
const { createApp } = require("./app");

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

// Bootstrap only. The Express application, including all HTTP middleware
// configuration, is created by `createApp()` in `app.js`, which is the single
// source of truth for that configuration. Environment validation and the
// database connection happen before `app.listen()` so the service never
// accepts a request it cannot serve.
async function startServer() {
  try {
    validateEnvironment();

    const app = createApp();

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