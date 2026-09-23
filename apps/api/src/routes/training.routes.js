const express = require("express");

const {
  getModules,
  getProgress,
  completeModule
} = require("../controllers/training.controller");

const {
  authenticate
} = require("../middleware/auth.middleware");

const {
  validateTrainingCompletionRequest
} = require("../middleware/validate.middleware");

const router = express.Router();

router.get("/modules", authenticate, getModules);
router.get("/progress", authenticate, getProgress);
router.post(
  "/modules/:moduleId/complete",
  authenticate,
  validateTrainingCompletionRequest,
  completeModule
);

module.exports = router;
