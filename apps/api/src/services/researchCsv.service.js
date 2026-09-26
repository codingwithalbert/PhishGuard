// Research Analytics V1 CSV serialization (spec 11, 12, and 13).
//
// This helper only formats the de-identified participant records that Stage 1
// already produced. It adds no columns, no derived values, and no spreadsheet
// formulas, and it never introduces an identifier that the dataset does not
// already carry.
const RESEARCH_CSV_COLUMNS = Object.freeze([
  "participantId",
  "awarenessScore",
  "awarenessCompletedAt",
  "phishingIdentificationScore",
  "phishingIdentificationCompletedAt",
  "completedTrainingModules",
  "trainingExposure"
]);
const RESEARCH_CSV_FILENAME = "phishguard-research-data.csv";
const RESEARCH_CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const CRLF = "\r\n";

function escapeCsvField(value) {
  const text = value === null || value === undefined ? "" : String(value);

  // A leading =, +, -, or @ would be interpreted as a formula by spreadsheet
  // software, so those values are neutralized.
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (
    neutralized.includes('"') ||
    neutralized.includes(",") ||
    neutralized.includes("\n") ||
    neutralized.includes("\r")
  ) {
    return `"${neutralized.split('"').join('""')}"`;
  }

  return neutralized;
}

function formatCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function toCsvRow(participant) {
  return RESEARCH_CSV_COLUMNS.map((column) =>
    escapeCsvField(formatCsvValue(participant?.[column]))
  ).join(",");
}

function serializeResearchParticipantCsv(participants = []) {
  const rows = [RESEARCH_CSV_COLUMNS.join(",")];

  for (const participant of participants) {
    rows.push(toCsvRow(participant));
  }

  return `${rows.join(CRLF)}${CRLF}`;
}

module.exports = {
  RESEARCH_CSV_COLUMNS,
  RESEARCH_CSV_CONTENT_TYPE,
  RESEARCH_CSV_FILENAME,
  escapeCsvField,
  formatCsvValue,
  serializeResearchParticipantCsv
};
