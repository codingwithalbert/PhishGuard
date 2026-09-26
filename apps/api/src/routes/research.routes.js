const express = require("express");

const defaultController = require("../controllers/research.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");

// Research Analytics V1 routes (spec 14 and 15).
//
// Admin only, enforced by the existing authentication and role middleware.
// Frontend visibility is never treated as the security boundary.
function createResearchRouter(controller = defaultController) {
  const router = express.Router();

  router.use(authenticate);
  router.use(authorizeRoles("admin"));

  router.get("/analytics", controller.getAnalytics);
  router.get("/export.csv", controller.exportAnalyticsCsv);

  return router;
}

const router = createResearchRouter();

module.exports = router;
module.exports.createResearchRouter = createResearchRouter;
