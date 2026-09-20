const express = require("express");

const {
  analyze,
  getAnalyses,
  updateAnalysis,
  deleteAnalysis
} = require("../controllers/analysis.controller");

const {
  validateAnalyzeRequest,
  validateAnalysisStatus,
  validateMongoId
} = require("../middleware/validate.middleware");

const {
  authenticate
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/", authenticate, validateAnalyzeRequest, analyze);
router.get("/", authenticate, getAnalyses);

router.patch(
  "/:id",
  authenticate,
  validateMongoId,
  validateAnalysisStatus,
  updateAnalysis
);

router.delete(
  "/:id",
  authenticate,
  validateMongoId,
  deleteAnalysis
);

module.exports = router;