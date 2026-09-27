const {
  sendTransactionalEmail,
  resolveMailConfig,
  isValidRecipientEmail
} = require("./mail.service");
const Report = require("../models/Report");
const User = require("../models/User");

// Report Email Notifications V1 (Stage 2 - domain service).
//
// This service is HTTP-independent. It resolves the report owner server-side,
// builds safe notification templates, and delegates delivery to the generic
// transactional mail primitive. It never throws: all outcomes are sanitized.

const SUPPORTED_NOTIFICATION_TYPES = new Set(["message", "completion"]);

const NOTIFICATION_SUBJECTS = Object.freeze({
  message: "New message on your PhishGuard report",
  completion: "Your PhishGuard report has been completed"
});

// Request-independent safe structured logger.
// Logs only approved fields: reportId, notificationType, and fixed reason.
function logNotificationEvent({ event, reportId, notificationType, reason }) {
  const entry = {
    event,
    reportId: reportId ? String(reportId) : null,
    notificationType: notificationType || null,
    ...(reason ? { reason } : {})
  };

  console.log("[REPORT_NOTIFICATION]", JSON.stringify(entry));
}

function buildNotificationBody({ ticketNumber, notificationType, clientUrl }) {
  if (notificationType === "message") {
    return [
      "Hello,",
      "",
      `A PhishGuard staff member has sent a new message on your report ${ticketNumber}.`,
      "",
      "Sign in to PhishGuard to view the message and respond if needed.",
      "",
      clientUrl,
      "",
      "Automated message from PhishGuard. Please do not reply."
    ].join("\n");
  }

  return [
    "Hello,",
    "",
    `Your PhishGuard report ${ticketNumber} has been completed by the IT team.`,
    "",
    "Sign in to PhishGuard to view the completed report.",
    "",
    clientUrl,
    "",
    "Automated message from PhishGuard. Please do not reply."
  ].join("\n");
}

function createReportNotificationService({
  sendMail = sendTransactionalEmail,
  resolveConfig = resolveMailConfig,
  reportModel = Report,
  userModel = User,
  env = process.env
} = {}) {
  return async function notifyReportOwner({ reportId, notificationType } = {}) {
    try {
      if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
        return { sent: false, reason: "delivery_failed" };
      }

      let mailConfig;
      try {
        mailConfig = resolveConfig(env);
      } catch {
        logNotificationEvent({
          event: "REPORT_NOTIFICATION_FAILED",
          reportId,
          notificationType,
          reason: "not_configured"
        });
        return { sent: false, reason: "not_configured" };
      }

      const report = await reportModel
        .findById(reportId)
        .select("ticketNumber user")
        .lean();

      if (!report) {
        logNotificationEvent({
          event: "REPORT_NOTIFICATION_FAILED",
          reportId,
          notificationType,
          reason: "owner_not_found"
        });
        return { sent: false, reason: "owner_not_found" };
      }

      const owner = await userModel
        .findById(report.user)
        .select("email isActive")
        .lean();

      if (!owner) {
        logNotificationEvent({
          event: "REPORT_NOTIFICATION_FAILED",
          reportId,
          notificationType,
          reason: "owner_not_found"
        });
        return { sent: false, reason: "owner_not_found" };
      }

      if (!owner.isActive) {
        logNotificationEvent({
          event: "REPORT_NOTIFICATION_FAILED",
          reportId,
          notificationType,
          reason: "owner_inactive"
        });
        return { sent: false, reason: "owner_inactive" };
      }

      if (!isValidRecipientEmail(owner.email)) {
        logNotificationEvent({
          event: "REPORT_NOTIFICATION_FAILED",
          reportId,
          notificationType,
          reason: "owner_email_invalid"
        });
        return { sent: false, reason: "owner_email_invalid" };
      }

      const subject = NOTIFICATION_SUBJECTS[notificationType];
      const textContent = buildNotificationBody({
        ticketNumber: report.ticketNumber,
        notificationType,
        clientUrl: env.CLIENT_URL
      });

      await sendMail({
        recipient: owner.email,
        subject,
        textContent,
        config: mailConfig
      });

      logNotificationEvent({
        event: "REPORT_NOTIFICATION_SENT",
        reportId,
        notificationType
      });

      return { sent: true };
    } catch {
      logNotificationEvent({
        event: "REPORT_NOTIFICATION_FAILED",
        reportId,
        notificationType,
        reason: "delivery_failed"
      });
      return { sent: false, reason: "delivery_failed" };
    }
  };
}

const notifyReportOwner = createReportNotificationService();

module.exports = {
  createReportNotificationService,
  notifyReportOwner
};
