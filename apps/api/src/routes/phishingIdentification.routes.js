const express = require("express");

const {
  getScenarios,
  submitAssessment,
  getLatestAssessment
} = require("../controllers/phishingIdentification.controller");

const {
  authenticate
} = require("../middleware/auth.middleware");

const {
  validatePhishingIdentificationSubmission
} = require("../middleware/validate.middleware");

const router = express.Router();

router.get("/scenarios", authenticate, getScenarios);
router.post(
  "/submit",
  authenticate,
  validatePhishingIdentificationSubmission,
  submitAssessment
);
router.get("/latest", authenticate, getLatestAssessment);

module.exports = router;
