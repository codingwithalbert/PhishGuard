const {
  getDashboardSummaryForUser
} = require("../services/dashboard.service");

async function getSummary(req, res, next) {
  res.set("Cache-Control", "no-store");

  try {
    const summary = await getDashboardSummaryForUser(req.user.userId);

    return res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSummary
};
