const express = require("express");

const defaultController = require("../controllers/research.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");
const {
  validateAnalyticsQuery
} = require("../middleware/research.validate.middleware");

// Research Analytics V1 routes (spec 14 and 15).
//
// Admin only, enforced by the existing authentication and role middleware.
// Frontend visibility is never treated as the security boundary.
//
// Analytics Visualization V1 mounts `validateAnalyticsQuery` on `/analytics`
// only. It sits after both router-wide authorization layers, so it never runs
// for an unauthenticated or non-admin caller, and it is deliberately absent
// from `/export.csv` so the CSV route's query handling, output, and
// permissions are exactly what they were.
function createResearchRouter(controller = defaultController) {
  const router = express.Router();

  router.use(authenticate);
  router.use(authorizeRoles("admin"));

  router.get(
    "/analytics",
    validateAnalyticsQuery,
    controller.getAnalytics
  );
  router.get("/export.csv", controller.exportAnalyticsCsv);

  return router;
}

const router = createResearchRouter();

module.exports = router;
module.exports.createResearchRouter = createResearchRouter;
