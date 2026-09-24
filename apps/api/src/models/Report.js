const mongoose = require("mongoose");

const REPORT_REASONS = [
  "suspected_phishing",
  "credential_request",
  "impersonation",
  "other"
];

const REPORT_STATUSES = ["submitted", "under_review", "completed"];
const REPORT_PRIORITIES = ["low", "normal", "high"];
const REPORT_ASSESSMENTS = [
  "pending",
  "phishing",
  "suspicious",
  "no_threat_identified"
];
const FINAL_REPORT_ASSESSMENTS = [
  "phishing",
  "suspicious",
  "no_threat_identified"
];

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

const analysisSnapshotSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },

    risk: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
      immutable: true
    },

    score: {
      type: Number,
      required: true,
      min: 0,
      immutable: true
    },

    indicators: {
      type: [String],
      required: true,
      default: [],
      immutable: true
    }
  },
  {
    _id: false,
    strict: true
  }
);

const reportSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      immutable: true,
      match: /^PG-\d{4}-\d{6}$/
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true
    },

    analysis: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Analysis",
      required: true,
      immutable: true
    },

    analysisSnapshot: {
      type: analysisSnapshotSchema,
      required: true,
      immutable: true
    },

    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
      immutable: true
    },

    details: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
      set: normalizeOptionalText,
      immutable: true
    },

    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: "submitted"
    },

    priority: {
      type: String,
      enum: REPORT_PRIORITIES,
      default: "normal"
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    assessment: {
      type: String,
      enum: REPORT_ASSESSMENTS,
      default: "pending"
    },

    reviewerNote: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
      set: normalizeOptionalText
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    reviewedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    collection: "reports",
    strict: true
  }
);

reportSchema.pre("validate", function validateReportWorkflow() {
  const isUnfinished = ["submitted", "under_review"].includes(this.status);

  if (isUnfinished && this.assessment !== "pending") {
    this.invalidate(
      "assessment",
      "Unfinished reports must have a pending assessment"
    );
    return;
  }

  if (this.status === "completed") {
    if (!FINAL_REPORT_ASSESSMENTS.includes(this.assessment)) {
      this.invalidate(
        "assessment",
        "Completed reports must have a final human assessment"
      );
      return;
    }

    if (!this.reviewedBy || !this.reviewedAt) {
      this.invalidate(
        "reviewedAt",
        "Completed reports must have reviewer metadata"
      );
    }
  }
});

reportSchema.index(
  { ticketNumber: 1 },
  {
    unique: true,
    name: "report_ticket_number_unique"
  }
);

reportSchema.index(
  { user: 1, analysis: 1 },
  {
    unique: true,
    name: "report_user_analysis_unique"
  }
);

reportSchema.index(
  { user: 1, createdAt: -1, _id: -1 },
  {
    name: "report_owner_history"
  }
);

reportSchema.index(
  { status: 1, priority: -1, createdAt: 1, _id: 1 },
  {
    name: "report_review_queue"
  }
);

reportSchema.index(
  { analysis: 1 },
  {
    name: "report_analysis_reference"
  }
);

const Report = mongoose.model("Report", reportSchema);

module.exports = Report;
