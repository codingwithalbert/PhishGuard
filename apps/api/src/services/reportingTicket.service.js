const ReportTicketCounter = require("../models/ReportTicketCounter");

const COUNTER_ID = "report-ticket-sequence";
const MAX_TICKET_SEQUENCE = 999999;
const MAX_COUNTER_ALLOCATION_ATTEMPTS = 5;
const TICKET_NUMBER_PATTERN = /^PG-\d{4}-\d{6}$/;

class TicketNumberOverflowError extends Error {
  constructor() {
    super(
      "Report ticket sequence exceeds the supported six-digit range"
    );
    this.name = "TicketNumberOverflowError";
    this.code = "REPORT_TICKET_SEQUENCE_EXHAUSTED";
  }
}

function getUtcYear(createdAt = new Date()) {
  const date =
    createdAt instanceof Date ? createdAt : new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Report creation date must be valid");
  }

  const year = date.getUTCFullYear();

  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(
      "Report creation year must be between 0000 and 9999"
    );
  }

  return year;
}

function formatTicketNumber(
  sequence,
  createdAt = new Date()
) {
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_TICKET_SEQUENCE
  ) {
    throw new TicketNumberOverflowError();
  }

  const year = getUtcYear(createdAt);
  const yearText = String(year).padStart(4, "0");
  const sequenceText = String(sequence).padStart(6, "0");

  return `PG-${yearText}-${sequenceText}`;
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function getCounterSequence(counter) {
  return counter?.sequence;
}

async function allocateTicketNumber({
  counterModel = ReportTicketCounter,
  createdAt = new Date(),
  maxAttempts = MAX_COUNTER_ALLOCATION_ATTEMPTS
} = {}) {
  if (
    !counterModel ||
    typeof counterModel.findOneAndUpdate !== "function"
  ) {
    throw new TypeError(
      "A counter model with findOneAndUpdate is required"
    );
  }

  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1
  ) {
    throw new RangeError(
      "maxAttempts must be a positive integer"
    );
  }

  let lastDuplicateKeyError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const counter = await counterModel.findOneAndUpdate(
        { _id: COUNTER_ID },
        { $inc: { sequence: 1 } },
        {
          returnDocument: "after",
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true
        }
      );

      return formatTicketNumber(
        getCounterSequence(counter),
        createdAt
      );
    } catch (error) {
      if (
        isDuplicateKeyError(error) &&
        attempt < maxAttempts - 1
      ) {
        lastDuplicateKeyError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastDuplicateKeyError;
}

module.exports = {
  COUNTER_ID,
  MAX_COUNTER_ALLOCATION_ATTEMPTS,
  MAX_TICKET_SEQUENCE,
  TICKET_NUMBER_PATTERN,
  TicketNumberOverflowError,
  allocateTicketNumber,
  formatTicketNumber
};
