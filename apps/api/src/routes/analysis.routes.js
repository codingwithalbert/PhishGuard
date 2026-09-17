const express = require("express");
const { analyze } = require("../controllers/analysis.controller");
const {
  validateAnalyzeRequest
} = require("../middleware/validate.middleware");

const router = express.Router();

router.post("/", validateAnalyzeRequest, analyze);

module.exports = router;