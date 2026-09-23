const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    questionId: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      validate: {
        validator: (value) => Number.isInteger(value),
        message: "Question ID must be an integer"
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

const awarenessAssessmentSchema = new mongoose.Schema(
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
          new Set(answers.map((answer) => answer.questionId)).size === 10,
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

    totalQuestions: {
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
    collection: "awarenessAssessments"
  }
);

awarenessAssessmentSchema.index({ user: 1, completedAt: -1 });

const AwarenessAssessment = mongoose.model(
  "AwarenessAssessment",
  awarenessAssessmentSchema
);

module.exports = AwarenessAssessment;
