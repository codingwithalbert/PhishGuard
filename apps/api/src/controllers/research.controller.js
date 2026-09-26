const researchAnalyticsService = require("../services/researchAnalytics.dataset");
const {
  RESEARCH_CSV_CONTENT_TYPE,
  RESEARCH_CSV_FILENAME,
  serializeResearchParticipantCsv
} = require("../services/researchCsv.service");

// Research Analytics V1 HTTP layer (spec 15, 17, and 18).
//
// The controller is intentionally thin: it applies the response conventions and
// forwards Stage 1 results. No statistic is recalculated here, the analytics
// response never includes the participant dataset, and failures are passed to
// the existing global error handler so no internal detail is exposed.
function createResearchController(
  service = researchAnalyticsService
) {
  async function getAnalytics(req, res, next) {
    res.set("Cache-Control", "no-store");

    try {
      const { summary } = await service.buildResearchAnalytics();

      return res.status(200).json({
        success: true,
        ...summary
      });
    } catch (error) {
      next(error);
    }
  }

  async function exportAnalyticsCsv(req, res, next) {
    res.set("Cache-Control", "no-store");

    try {
      const participants =
        await service.buildResearchParticipantDataset();
      const csv = serializeResearchParticipantCsv(participants);

      res.set("Content-Type", RESEARCH_CSV_CONTENT_TYPE);
      res.set(
        "Content-Disposition",
        `attachment; filename="${RESEARCH_CSV_FILENAME}"`
      );

      return res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  }

  return {
    exportAnalyticsCsv,
    getAnalytics
  };
}

const defaultController = createResearchController();

module.exports = {
  ...defaultController,
  createResearchController
};
