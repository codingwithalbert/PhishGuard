const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    scenarioId: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      validate: {
        validator: (value) => Number.isInteger(value),
        message: "Scenario ID must be an integer"
      }
    },

    selectedAnswer: {
      type: String,
      required: true,
      enum: ["A", "B", "C", "D"]
    }
  },
  {
    _id: false
  }
);

const phishingIdentificationAssessmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    answers: {
      type: [answerSchema],
      required: true,
      validate: {
        validator: (answers) =>
          Array.isArray(answers) &&
          answers.length === 10 &&
          new Set(answers.map((answer) => answer.scenarioId)).size === 10,
        message: "Exactly 10 unique answers are required"
      }
    },

    rawScore: {
      type: Number,
      required: true,
      min: 0,
      max: 10
    },

    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },

    totalScenarios: {
      type: Number,
      required: true,
      enum: [10]
    },

    completedAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: "phishingIdentificationAssessments"
  }
);

phishingIdentificationAssessmentSchema.index({ user: 1, completedAt: -1 });

const PhishingIdentificationAssessment = mongoose.model(
  "PhishingIdentificationAssessment",
  phishingIdentificationAssessmentSchema
);

module.exports = PhishingIdentificationAssessment;
