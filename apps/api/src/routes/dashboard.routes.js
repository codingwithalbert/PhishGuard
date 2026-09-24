const express = require("express");

const {
  getSummary
} = require("../controllers/dashboard.controller");
const {
  authenticate
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/summary", authenticate, getSummary);

module.exports = router;
