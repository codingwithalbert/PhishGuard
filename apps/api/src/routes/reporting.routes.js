const express = require("express");

const {
  authenticate
} = require("../middleware/auth.middleware");
const {
  authorizeRoles
} = require("../middleware/role.middleware");
const {
  validateReportAssignment,
  validateReportCompletion,
  validateReportId,
  validateReportMessage,
  validateReportPriority,
  validateReportSubmission,
  validateStartReview
} = require("../middleware/reporting.validate.middleware");
const defaultController = require("../controllers/reporting.controller");

function createReportingRouter(controller = defaultController) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    return next();
  });

  router.use(authenticate);

  // Keep all static review routes before the generic report parameter route.
  router.get(
    "/review",
    authorizeRoles("staff", "admin"),
    controller.getReviewQueue
  );

  router.get(
    "/review/assignees",
    authorizeRoles("admin"),
    controller.getAssignmentCandidates
  );

  router.get(
    "/review/:reportId/messages",
    authorizeRoles("staff", "admin"),
    validateReportId,
    controller.getReviewReportMessages
  );

  router.post(
    "/review/:reportId/messages",
    authorizeRoles("staff", "admin"),
    validateReportId,
    validateReportMessage,
    controller.createReviewReportMessage
  );

  router.get(
    "/review/:reportId",
    authorizeRoles("staff", "admin"),
    validateReportId,
    controller.getReviewReport
  );

  router.patch(
    "/review/:reportId/claim",
    authorizeRoles("staff", "admin"),
    validateReportId,
    controller.claimReviewReport
  );

  router.patch(
    "/review/:reportId/assignment",
    authorizeRoles("admin"),
    validateReportId,
    validateReportAssignment,
    controller.assignReviewReport
  );

  router.patch(
    "/review/:reportId/priority",
    authorizeRoles("staff", "admin"),
    validateReportId,
    validateReportPriority,
    controller.updateReviewReportPriority
  );

  router.patch(
    "/review/:reportId/start",
    authorizeRoles("staff", "admin"),
    validateReportId,
    validateStartReview,
    controller.startReviewReport
  );

  router.patch(
    "/review/:reportId/complete",
    authorizeRoles("staff", "admin"),
    validateReportId,
    validateReportCompletion,
    controller.completeReviewReport
  );

  router.post(
    "/",
    validateReportSubmission,
    controller.createReport
  );

  router.get(
    "/",
    controller.getOwnReports
  );

  router.get(
    "/:reportId/messages",
    validateReportId,
    controller.getOwnReportMessages
  );

  router.post(
    "/:reportId/messages",
    validateReportId,
    validateReportMessage,
    controller.createOwnReportMessage
  );

  router.get(
    "/:reportId",
    validateReportId,
    controller.getOwnReport
  );

  return router;
}

const router = createReportingRouter();

module.exports = router;
module.exports.createReportingRouter = createReportingRouter;
