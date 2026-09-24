const express = require("express");

const {
  getProgress
} = require("../controllers/progress.controller");
const {
  authenticate
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/", authenticate, getProgress);

module.exports = router;
