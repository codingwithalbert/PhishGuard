const REPORT_REASON_OPTIONS = Object.freeze([
  { value: "suspected_phishing", label: "Suspected Phishing" },
  { value: "credential_request", label: "Credential Request" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Other" }
]);

const REPORT_REASON_LABELS = Object.freeze(
  Object.fromEntries(
    REPORT_REASON_OPTIONS.map(({ value, label }) => [value, label])
  )
);

const REPORT_STATUS_LABELS = Object.freeze({
  submitted: "Submitted",
  under_review: "Under Review",
  completed: "Completed"
});

const REPORT_PRIORITY_LABELS = Object.freeze({
  low: "Low",
  normal: "Normal",
  high: "High"
});

const REPORT_ASSESSMENT_LABELS = Object.freeze({
  pending: "Pending IT Review",
  phishing: "Phishing",
  suspicious: "Suspicious",
  no_threat_identified: "No Threat Identified"
});

function getValidFindings(analysis) {
  if (!Array.isArray(analysis?.findings)) {
    return [];
  }

  return analysis.findings.filter(
    (finding) =>
      finding &&
      typeof finding === "object" &&
      typeof finding.type === "string" &&
      typeof finding.title === "string" &&
      typeof finding.explanation === "string" &&
      Number.isFinite(finding.scoreContribution)
  );
}

function getReportFindingsMessage(evidence) {
  if (!Array.isArray(evidence?.findings)) {
    return "Structured findings are not available for this report snapshot.";
  }

  if (evidence.findings.length === 0) {
    return "No structured findings were returned for this report snapshot.";
  }

  return "No valid structured findings are available for this report snapshot.";
}

function formatReportingDate(value, fallback = "Date unavailable") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString();
}

function getReportReasonLabel(value) {
  return REPORT_REASON_LABELS[value] || "Unknown reason";
}

function getReportStatusLabel(value) {
  return REPORT_STATUS_LABELS[value] || "Unknown status";
}

function getReportPriorityLabel(value) {
  return REPORT_PRIORITY_LABELS[value] || "Unknown priority";
}

function getReportAssessmentLabel(value) {
  return REPORT_ASSESSMENT_LABELS[value] || "Unknown IT assessment";
}

export {
  REPORT_ASSESSMENT_LABELS,
  REPORT_PRIORITY_LABELS,
  REPORT_REASON_LABELS,
  REPORT_REASON_OPTIONS,
  REPORT_STATUS_LABELS,
  formatReportingDate,
  getReportAssessmentLabel,
  getReportFindingsMessage,
  getReportPriorityLabel,
  getReportReasonLabel,
  getReportStatusLabel,
  getValidFindings
};
