require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "phishguard-api"
  });
});

app.listen(PORT, () => {
  console.log(`PhishGuard API running on http://localhost:${PORT}`);
});
