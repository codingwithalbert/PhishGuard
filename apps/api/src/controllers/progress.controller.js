const {
  getProgressForUser
} = require("../services/progress.service");

async function getProgress(req, res, next) {
  res.set("Cache-Control", "no-store");

  try {
    const progress = await getProgressForUser(req.user.userId);

    return res.status(200).json({
      success: true,
      ...progress
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProgress
};
