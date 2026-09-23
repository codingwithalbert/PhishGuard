const {
  completeTrainingModuleForUser,
  getTrainingModulesForUser,
  getTrainingProgressForUser
} = require("../services/training.service");

async function getModules(req, res, next) {
  try {
    const result = await getTrainingModulesForUser(req.user.userId);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getProgress(req, res, next) {
  try {
    const result = await getTrainingProgressForUser(req.user.userId);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function completeModule(req, res, next) {
  try {
    const result = await completeTrainingModuleForUser(
      req.user.userId,
      Number(req.params.moduleId)
    );

    return res.status(result.created ? 201 : 200).json({
      completion: result.completion,
      progress: result.progress
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getModules,
  getProgress,
  completeModule
};
