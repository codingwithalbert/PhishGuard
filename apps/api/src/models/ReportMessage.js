const mongoose = require("mongoose");

function normalizeMessage(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

const reportMessageSchema = new mongoose.Schema(
  {
    report: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Report",
      required: true,
      immutable: true
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true
    },

    senderRole: {
      type: String,
      enum: ["user", "staff", "admin"],
      required: true,
      immutable: true
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
      set: normalizeMessage,
      immutable: true,
      validate: {
        validator: (value) =>
          typeof value === "string" && value.length > 0,
        message: "Message cannot be empty"
      }
    }
  },
  {
    timestamps: true,
    collection: "reportMessages",
    strict: true
  }
);

reportMessageSchema.index(
  { report: 1, createdAt: 1, _id: 1 },
  {
    name: "report_message_thread_order"
  }
);

const ReportMessage = mongoose.model(
  "ReportMessage",
  reportMessageSchema
);

module.exports = ReportMessage;
