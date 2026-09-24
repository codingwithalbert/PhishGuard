const reportingService = require("../services/reporting.service");

const {
  ReportingServiceError
} = reportingService;

function handleReportingError(error, res, next) {
  if (error instanceof ReportingServiceError) {
    return res.status(error.status).json({
      success: false,
      error: error.message
    });
  }

  return next(error);
}

function createReportingController(service = reportingService) {
  async function createReport(req, res, next) {
    try {
      const report = await service.createReport({
        userId: req.user.userId,
        analysisId: req.body.analysisId,
        reason: req.body.reason,
        details: req.body.details
      });

      return res.status(201).json({
        success: true,
        message: "Report submitted successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getOwnReports(req, res, next) {
    try {
      const reports = await service.getOwnReports(
        req.user.userId
      );

      return res.status(200).json({
        success: true,
        count: reports.length,
        reports
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getOwnReport(req, res, next) {
    try {
      const report = await service.getOwnReport(
        req.user.userId,
        req.params.reportId
      );

      return res.status(200).json({
        success: true,
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getOwnReportMessages(req, res, next) {
    try {
      const messages = await service.getOwnReportMessages(
        req.user.userId,
        req.params.reportId
      );

      return res.status(200).json({
        success: true,
        count: messages.length,
        messages
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function createOwnReportMessage(req, res, next) {
    try {
      const reportMessage =
        await service.createOwnReportMessage({
          userId: req.user.userId,
          reportId: req.params.reportId,
          message: req.body.message,
          actorRole: req.user.role
        });

      return res.status(201).json({
        success: true,
        message: "Report message sent successfully",
        reportMessage
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getReviewQueue(req, res, next) {
    try {
      const reports = await service.getReviewQueue();

      return res.status(200).json({
        success: true,
        count: reports.length,
        reports
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getAssignmentCandidates(req, res, next) {
    try {
      const assignees =
        await service.getAssignmentCandidates();

      return res.status(200).json({
        success: true,
        assignees
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getReviewReport(req, res, next) {
    try {
      const report = await service.getReviewReport(
        req.params.reportId
      );

      return res.status(200).json({
        success: true,
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function getReviewReportMessages(req, res, next) {
    try {
      const messages = await service.getReviewReportMessages(
        req.params.reportId
      );

      return res.status(200).json({
        success: true,
        count: messages.length,
        messages
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function createReviewReportMessage(req, res, next) {
    try {
      const reportMessage =
        await service.createReviewReportMessage({
          reportId: req.params.reportId,
          actorId: req.user.userId,
          actorRole: req.user.role,
          message: req.body.message
        });

      return res.status(201).json({
        success: true,
        message: "Report message sent successfully",
        reportMessage
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function claimReviewReport(req, res, next) {
    try {
      const report = await service.claimReviewReport({
        reportId: req.params.reportId,
        actorId: req.user.userId
      });

      return res.status(200).json({
        success: true,
        message: "Report claimed successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function assignReviewReport(req, res, next) {
    try {
      const report = await service.assignReviewReport({
        reportId: req.params.reportId,
        assignedTo: req.body.assignedTo
      });

      return res.status(200).json({
        success: true,
        message: "Report assignment updated successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function updateReviewReportPriority(req, res, next) {
    try {
      const report = await service.updateReviewReportPriority({
        reportId: req.params.reportId,
        priority: req.body.priority
      });

      return res.status(200).json({
        success: true,
        message: "Report priority updated successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function startReviewReport(req, res, next) {
    try {
      const report = await service.startReviewReport(
        req.params.reportId
      );

      return res.status(200).json({
        success: true,
        message: "Report review started successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  async function completeReviewReport(req, res, next) {
    try {
      const report = await service.completeReviewReport({
        reportId: req.params.reportId,
        actorId: req.user.userId,
        actorRole: req.user.role,
        assessment: req.body.assessment,
        reviewerNote: req.body.reviewerNote
      });

      return res.status(200).json({
        success: true,
        message: "Report review completed successfully",
        report
      });
    } catch (error) {
      return handleReportingError(error, res, next);
    }
  }

  return {
    createReport,
    getOwnReports,
    getOwnReport,
    getOwnReportMessages,
    createOwnReportMessage,
    getReviewQueue,
    getAssignmentCandidates,
    getReviewReport,
    getReviewReportMessages,
    createReviewReportMessage,
    claimReviewReport,
    assignReviewReport,
    updateReviewReportPriority,
    startReviewReport,
    completeReviewReport
  };
}

const defaultController = createReportingController();

module.exports = {
  ...defaultController,
  createReportingController
};
