const {
  reconstructFindings
} = require("./analysis.findings");

function toObjectValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && typeof value.toObject === "function") {
    return value.toObject();
  }

  if (typeof value === "object" && typeof value.toJSON === "function") {
    return value.toJSON();
  }

  return value;
}

function readField(value, field) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (
    (typeof value === "object" || typeof value === "function") &&
    field in value
  ) {
    return value[field];
  }

  const objectValue = toObjectValue(value);

  if (objectValue !== value) {
    return objectValue?.[field];
  }

  return undefined;
}

function toId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    const nestedId = value._id ?? value.id;

    if (nestedId !== null && nestedId !== undefined && nestedId !== value) {
      return toId(nestedId);
    }

    if (typeof value.toHexString === "function") {
      return value.toHexString();
    }

    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return null;
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function asNullableText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

function asNullableTimestamp(value) {
  if (
    value instanceof Date ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }

  return null;
}

function toIndicators(value) {
  return Array.isArray(value) ? [...value] : [];
}

function toAnalysisSnapshotDto(snapshot) {
  const source = toObjectValue(snapshot);
  const indicators = toIndicators(readField(source, "indicators"));
  const score = readField(source, "score");

  return {
    url: asString(readField(source, "url")),
    risk: asString(readField(source, "risk")),
    score: Number.isFinite(score) ? score : null,
    indicators,
    findings: reconstructFindings(indicators)
  };
}

function toStudentUserReferenceDto(user) {
  if (user === null || user === undefined) {
    return null;
  }

  const name = asString(readField(user, "name"));
  const role = asString(readField(user, "role"));

  if (name === null || role === null) {
    return null;
  }

  return {
    name,
    role
  };
}

function toITUserReferenceDto(user) {
  if (user === null || user === undefined) {
    return null;
  }

  const id = toId(user);
  const name = asString(readField(user, "name"));
  const email = asString(readField(user, "email"));
  const role = asString(readField(user, "role"));

  if (
    id === null &&
    name === null &&
    email === null &&
    role === null
  ) {
    return null;
  }

  return {
    id,
    name,
    email,
    role
  };
}

function toMinimalReporterDto(user) {
  if (user === null || user === undefined) {
    return null;
  }

  const id = toId(user);
  const name = asString(readField(user, "name"));
  const email = asString(readField(user, "email"));

  if (id === null && name === null && email === null) {
    return null;
  }

  return {
    id,
    name,
    email
  };
}

function toMessageSenderDto(message, includeId) {
  const sender = readField(message, "sender");
  const storedRole = asString(readField(message, "senderRole"));
  const name = asString(readField(sender, "name"));
  const role =
    storedRole === null
      ? asString(readField(sender, "role"))
      : storedRole;

  if (includeId) {
    return {
      id: toId(sender),
      name,
      role
    };
  }

  return {
    name,
    role
  };
}

function toReportBaseDto(report) {
  const source = toObjectValue(report);
  const analysisReference =
    readField(source, "analysis") ??
    readField(source, "analysisId");

  return {
    id: toId(source),
    ticketNumber: asString(readField(source, "ticketNumber")),
    analysisId: toId(analysisReference),
    analysisSnapshot: toAnalysisSnapshotDto(
      readField(source, "analysisSnapshot")
    ),
    reason: asString(readField(source, "reason")),
    details: asNullableText(readField(source, "details")),
    status: asString(readField(source, "status")),
    priority: asString(readField(source, "priority")),
    assessment: asString(readField(source, "assessment")),
    reviewerNote: asNullableText(
      readField(source, "reviewerNote")
    ),
    reviewedAt: asNullableTimestamp(
      readField(source, "reviewedAt")
    ),
    createdAt: asNullableTimestamp(
      readField(source, "createdAt")
    ),
    updatedAt: asNullableTimestamp(
      readField(source, "updatedAt")
    )
  };
}

function toStudentReportDto(report) {
  const source = toObjectValue(report);

  return {
    ...toReportBaseDto(source),
    assignedTo: toStudentUserReferenceDto(
      readField(source, "assignedTo")
    ),
    reviewedBy: toStudentUserReferenceDto(
      readField(source, "reviewedBy")
    )
  };
}

function toITReviewReportDto(report) {
  const source = toObjectValue(report);
  const reporterReference =
    readField(source, "reporter") ?? readField(source, "user");

  return {
    ...toReportBaseDto(source),
    assignedTo: toITUserReferenceDto(
      readField(source, "assignedTo")
    ),
    reviewedBy: toITUserReferenceDto(
      readField(source, "reviewedBy")
    ),
    reporter: toMinimalReporterDto(reporterReference)
  };
}

function toReportMessageBaseDto(message) {
  const source = toObjectValue(message);

  return {
    id: toId(source),
    message: asString(readField(source, "message")),
    createdAt: asNullableTimestamp(
      readField(source, "createdAt")
    )
  };
}

function toStudentReportMessageDto(message) {
  return {
    ...toReportMessageBaseDto(message),
    sender: toMessageSenderDto(message, false)
  };
}

function toITReviewReportMessageDto(message) {
  return {
    ...toReportMessageBaseDto(message),
    sender: toMessageSenderDto(message, true)
  };
}

function toAssigneeCandidateDto(user) {
  return toITUserReferenceDto(user);
}

module.exports = {
  toAnalysisSnapshotDto,
  toStudentUserReferenceDto,
  toITUserReferenceDto,
  toMinimalReporterDto,
  toAssigneeCandidateDto,
  toStudentReportDto,
  toITReviewReportDto,
  toStudentReportMessageDto,
  toITReviewReportMessageDto
};
