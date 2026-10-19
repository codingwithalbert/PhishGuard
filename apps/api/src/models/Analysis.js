const mongoose = require("mongoose");
const {
  MAX_ANALYSIS_URL_LENGTH
} = require("../services/analysis.constants");

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
      trim: true,
      // Backstop for the request-boundary check in `validateAnalyzeRequest`,
      // sharing the same constant so the two cannot drift. A document that
      // somehow reached this boundary oversized is refused rather than stored
      // or silently truncated: a truncated URL is a different URL, and the
      // stored evidence must remain the evidence that was actually analysed.
      maxlength: MAX_ANALYSIS_URL_LENGTH
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

// Query-supporting index for every owner-scoped read on this collection.
//
// This collection previously declared no index at all, so all three read paths
// - the owner history, the owner count, and the dashboard recents - performed a
// collection scan, with an in-memory sort on top for the two that order by
// creation time.
//
// The shape is deliberately the compound `{ user, createdAt, _id }`, matching
// the convention already used by `report_owner_history` in Report.js:
//
//   - `user: 1`        the equality filter present in all three reads
//   - `createdAt: -1`  the descending ordering of the history and the recents
//   - `_id: -1`        the deterministic tie-breaker the recents sort on
//
// The trailing `_id` is what lets this single index cover the dashboard read as
// well, so no second index is needed for the tie-breaker.
//
// An index is a query-planning structure only. It does not change validation,
// defaults, trimming, or any stored value, and it is not `unique`: multiple
// analyses per user are legitimate.
//
// Declaring an index here does not prove it exists in any running database.
// Whether MongoDB has actually built it, and whether a query planner chooses
// it, are runtime facts that can only be verified against a real database.
analysisSchema.index(
  { user: 1, createdAt: -1, _id: -1 },
  {
    name: "analysis_owner_history"
  }
);

const Analysis = mongoose.model("Analysis", analysisSchema);

module.exports = Analysis;