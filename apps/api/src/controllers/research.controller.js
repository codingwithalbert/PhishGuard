const researchAnalyticsService = require("../services/researchAnalytics.dataset");
const {
  getTrainingExposureLabelForLevel
} = require("../services/researchAnalytics.dataset");
const {
  EXPOSURE_LEVEL_ALL
} = require("../middleware/research.validate.middleware");
const {
  RESEARCH_CSV_CONTENT_TYPE,
  RESEARCH_CSV_FILENAME,
  serializeResearchParticipantCsv
} = require("../services/researchCsv.service");

// Analytics Visualization V1 (spec sections 4 and 5).
const ALL_EXPOSURE_LABEL = "All";
const EXPOSURE_FILTER_SCOPE = "in_app_eligible_users";

const UNSUPPLIED_EXPOSURE_FILTER = Object.freeze({
  supplied: false,
  level: null,
  queryValue: null
});

// Spec section 4: the envelope is present if and only if `exposureLevel` was
// explicitly supplied. An omitted parameter returns the original response
// shape exactly, so the default response is unchanged for every existing
// client and test.
//
// Spec section 5.1 and note N2: `statisticsSuppressed` and `minimumStatisticN`
// are reported only for a selected level. `all` carries no minimum and is
// never suppressed, so the two concepts cannot be confused by a client.
function buildFilterEnvelope(exposureFilter, { statisticsSuppressed, minimumStatisticN }) {
  const applied = exposureFilter.level !== null;

  const envelope = {
    exposureLevel: exposureFilter.queryValue,
    label: applied
      ? getTrainingExposureLabelForLevel(exposureFilter.level)
      : ALL_EXPOSURE_LABEL,
    applied,
    scope: EXPOSURE_FILTER_SCOPE
  };

  if (applied) {
    envelope.statisticsSuppressed = statisticsSuppressed;
    envelope.minimumStatisticN = minimumStatisticN;
  }

  return envelope;
}

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
      // The validator normalizes the query. When it did not run, or when no
      // parameter was supplied, the filter is absent and the unfiltered
      // response shape is preserved exactly.
      const exposureFilter =
        req.researchExposureFilter || UNSUPPLIED_EXPOSURE_FILTER;

      const { summary, statisticsSuppressed, minimumStatisticN } =
        await service.buildResearchAnalytics({
          exposureLevel: exposureFilter.level
        });

      const response = {
        success: true,
        ...summary
      };

      if (exposureFilter.supplied) {
        response.filter = buildFilterEnvelope(exposureFilter, {
          statisticsSuppressed,
          minimumStatisticN
        });
      }

      return res.status(200).json(response);
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
