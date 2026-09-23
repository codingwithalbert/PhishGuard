const mongoose = require("mongoose");

const trainingCompletionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    moduleId: {
      type: Number,
      required: true,
      enum: [1, 2, 3],
      min: 1,
      max: 3,
      validate: {
        validator: (value) => Number.isInteger(value),
        message: "Module ID must be an integer"
      }
    },

    completedAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: "trainingCompletions"
  }
);

trainingCompletionSchema.index(
  { user: 1, moduleId: 1 },
  { unique: true }
);

const TrainingCompletion = mongoose.model(
  "TrainingCompletion",
  trainingCompletionSchema
);

module.exports = TrainingCompletion;
