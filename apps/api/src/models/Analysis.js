const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    url: {
      type: String,
      required: true,
      trim: true
    },

    risk: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true
    },

    score: {
      type: Number,
      required: true,
      min: 0
    },

    indicators: {
      type: [String],
      default: []
    },

    status: {
      type: String,
      enum: ["active", "reviewed", "archived"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

const Analysis = mongoose.model("Analysis", analysisSchema);

module.exports = Analysis;