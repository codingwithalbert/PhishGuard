const mongoose = require("mongoose");

const reportTicketCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },

    sequence: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: (value) => Number.isInteger(value),
        message: "Report ticket sequence must be an integer"
      }
    }
  },
  {
    timestamps: true,
    collection: "reportTicketCounters",
    strict: true,
    versionKey: false
  }
);

const ReportTicketCounter = mongoose.model(
  "ReportTicketCounter",
  reportTicketCounterSchema
);

module.exports = ReportTicketCounter;
