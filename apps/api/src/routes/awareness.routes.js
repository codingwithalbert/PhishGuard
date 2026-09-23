const express = require("express");

const {
  getQuestions,
  submitAssessment,
  getLatestAssessment
} = require("../controllers/awareness.controller");

const {
  authenticate
} = require("../middleware/auth.middleware");

const {
  validateAwarenessSubmission
} = require("../middleware/validate.middleware");

const router = express.Router();

router.get("/questions", authenticate, getQuestions);
router.post("/submit", authenticate, validateAwarenessSubmission, submitAssessment);
router.get("/latest", authenticate, getLatestAssessment);

module.exports = router;
