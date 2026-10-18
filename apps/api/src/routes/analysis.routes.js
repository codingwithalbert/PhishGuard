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

const {
  analyzeLimiter,
  requireAuthenticatedIdentity
} = require("../middleware/rateLimit.middleware");

const router = express.Router();

// Authenticated-user abuse protection, following the same order the reporting
// router already uses: `authenticate` first, then the identity guard, then the
// limiter, then validation. A blocked request therefore performs no validation,
// no heuristic evaluation, and no database write.
//
// The bucket is keyed on the server-authoritative `req.user.userId`, so it
// cannot be evaded by changing the submitted URL or by opening another tab: the
// same account always shares one budget, and two different accounts never share
// one. Reads are deliberately not limited; only analysis writes are.
router.post(
  "/",
  authenticate,
  requireAuthenticatedIdentity,
  analyzeLimiter,
  validateAnalyzeRequest,
  analyze
);

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