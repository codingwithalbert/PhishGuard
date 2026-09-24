const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  REPORTING_ERROR_CODES,
  ReportingServiceError,
  buildReviewQueuePipeline,
  createReport,
  getOwnReports,
  getOwnReport,
  getOwnReportMessages,
  createOwnReportMessage,
  getReviewQueue,
  getReviewReport,
  getReviewReportMessages,
  createReviewReportMessage,
  claimReviewReport,
  assignReviewReport,
  getAssignmentCandidates,
  updateReviewReportPriority,
  startReviewReport,
  completeReviewReport
} = require("../src/services/reporting.service");

function createObjectId() {
  return new mongoose.Types.ObjectId();
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return new mongoose.Types.ObjectId(value.toString());
  }

  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (typeof value === "object") {
    if (typeof value.toObject === "function") {
      return cloneValue(value.toObject());
    }

    const result = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = cloneValue(nestedValue);
    }

    return result;
  }

  return value;
}

function idValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    const nestedId = value._id ?? value.id;

    if (nestedId !== null && nestedId !== undefined && nestedId !== value) {
      return idValue(nestedId);
    }
  }

  if (typeof value.toHexString === "function") {
    return value.toHexString();
  }

  return String(value);
}

function valuesEqual(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    );
  }

  if (
    left === null ||
    right === null ||
    left === undefined ||
    right === undefined
  ) {
    return left === right;
  }

  if (typeof left === "object" || typeof right === "object") {
    return idValue(left) === idValue(right);
  }

  return left === right;
}

function matchesFilter(document, filter) {
  for (const [field, expected] of Object.entries(filter)) {
    const actual = field
      .split(".")
      .reduce((value, part) => value?.[part], document);

    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      Object.hasOwn(expected, "$in")
    ) {
      if (
        !expected.$in.some((candidate) =>
          valuesEqual(actual, candidate)
        )
      ) {
        return false;
      }

      continue;
    }

    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      Object.hasOwn(expected, "$ne")
    ) {
      if (valuesEqual(actual, expected.$ne)) {
        return false;
      }

      continue;
    }

    if (!valuesEqual(actual, expected)) {
      return false;
    }
  }

  return true;
}

function compareValues(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  const leftText = String(left);
  const rightText = String(right);

  return leftText.localeCompare(rightText);
}

function sortDocuments(documents, sortSpecification) {
  return [...documents].sort((left, right) => {
    for (const [field, direction] of Object.entries(sortSpecification)) {
      const comparison = compareValues(left[field], right[field]);

      if (comparison !== 0) {
        return comparison * direction;
      }
    }

    return idValue(left._id).localeCompare(idValue(right._id));
  });
}

function parseProjection(fields) {
  if (!fields) {
    return null;
  }

  if (typeof fields === "object") {
    return fields;
  }

  return Object.fromEntries(
    String(fields)
      .split(/\s+/)
      .filter(Boolean)
      .map((field) => [field, 1])
  );
}

function projectDocument(document, projection) {
  const normalizedProjection = parseProjection(projection);

  if (!normalizedProjection) {
    return cloneValue(document);
  }

  const projected = {};

  for (const [field, value] of Object.entries(document)) {
    if (
      normalizedProjection._id !== 0 &&
      (field === "_id" || normalizedProjection[field] === 1)
    ) {
      projected[field] = cloneValue(value);
    }
  }

  return projected;
}

function findUser(users, reference) {
  if (reference === null || reference === undefined) {
    return null;
  }

  return (
    users.find((user) => valuesEqual(user._id, reference)) || null
  );
}

function populateDocument(document, users, populations) {
  const populated = cloneValue(document);

  for (const [path, fields] of populations) {
    const reference = populated[path];
    const user = findUser(users, reference);

    populated[path] = user
      ? projectDocument(user, fields)
      : null;
  }

  return populated;
}

function makeQuery(executor) {
  let sortSpecification = null;
  let projection = null;
  const populations = [];

  const query = {
    sort(specification) {
      sortSpecification = specification;
      return query;
    },

    select(fields) {
      projection = fields;
      return query;
    },

    populate(path, fields) {
      populations.push([path, fields]);
      return query;
    },

    lean() {
      return query;
    },

    then(onFulfilled, onRejected) {
      return Promise.resolve()
        .then(() =>
          executor({
            sortSpecification,
            projection,
            populations
          })
        )
        .then(onFulfilled, onRejected);
    },

    catch(onRejected) {
      return query.then(undefined, onRejected);
    }
  };

  return query;
}

function applyUpdate(document, update) {
  if (update.$set) {
    Object.assign(document, cloneValue(update.$set));
  }

  if (update.$inc) {
    for (const [field, amount] of Object.entries(update.$inc)) {
      document[field] = (document[field] || 0) + amount;
    }
  }
}

function createMemoryModels({
  users = [],
  analyses = [],
  reports = [],
  messages = []
} = {}) {
  const state = {
    users: [...users],
    analyses: [...analyses],
    reports: [...reports],
    messages: [...messages]
  };

  let reportUpdateQueue = Promise.resolve();
  let reportCreateQueue = Promise.resolve();
  let messageCreateQueue = Promise.resolve();

  const Analysis = {
    collection: { name: "analyses" },

    findOne(filter) {
      return makeQuery(({ projection }) => {
        const document = state.analyses.find((candidate) =>
          matchesFilter(candidate, filter)
        );

        return document
          ? projectDocument(document, projection)
          : null;
      });
    }
  };

  const User = {
    collection: { name: "users" },

    find(filter = {}) {
      return makeQuery(({ sortSpecification, projection }) => {
        let results = state.users.filter((candidate) =>
          matchesFilter(candidate, filter)
        );

        if (sortSpecification) {
          results = sortDocuments(results, sortSpecification);
        }

        return results.map((candidate) =>
          projectDocument(candidate, projection)
        );
      });
    },

    findById(id) {
      return makeQuery(({ projection }) => {
        const user = findUser(state.users, id);
        return user ? projectDocument(user, projection) : null;
      });
    }
  };

  const ReportMessage = {
    collection: { name: "reportMessages" },

    find(filter = {}) {
      return makeQuery(
        ({ sortSpecification, projection, populations }) => {
          let results = state.messages.filter((candidate) =>
            matchesFilter(candidate, filter)
          );

          if (sortSpecification) {
            results = sortDocuments(results, sortSpecification);
          }

          results = results.map((candidate) =>
            populateDocument(candidate, state.users, populations)
          );

          return results.map((candidate) =>
            projectDocument(candidate, projection)
          );
        }
      );
    },

    findById(id) {
      return makeQuery(({ projection, populations }) => {
        const message = state.messages.find((candidate) =>
          valuesEqual(candidate._id, id)
        );

        if (!message) {
          return null;
        }

        return projectDocument(
          populateDocument(message, state.users, populations),
          projection
        );
      });
    },

    create(data) {
      const operation = messageCreateQueue.then(() => {
        const now = new Date();
        const message = {
          _id: createObjectId(),
          createdAt: now,
          updatedAt: now,
          ...cloneValue(data)
        };

        state.messages.push(message);

        return cloneValue(message);
      });

      messageCreateQueue = operation.catch(() => undefined);

      return operation;
    }
  };

  const Report = {
    collection: { name: "reports" },
    lastAggregatePipeline: null,

    find(filter = {}) {
      return makeQuery(
        ({ sortSpecification, projection, populations }) => {
          let results = state.reports.filter((candidate) =>
            matchesFilter(candidate, filter)
          );

          if (sortSpecification) {
            results = sortDocuments(results, sortSpecification);
          }

          results = results.map((candidate) =>
            populateDocument(candidate, state.users, populations)
          );

          return results.map((candidate) =>
            projectDocument(candidate, projection)
          );
        }
      );
    },

    findOne(filter) {
      return makeQuery(({ projection, populations }) => {
        const document = state.reports.find((candidate) =>
          matchesFilter(candidate, filter)
        );

        if (!document) {
          return null;
        }

        return projectDocument(
          populateDocument(document, state.users, populations),
          projection
        );
      });
    },

    findById(id) {
      return makeQuery(({ projection, populations }) => {
        const document = state.reports.find((candidate) =>
          valuesEqual(candidate._id, id)
        );

        if (!document) {
          return null;
        }

        return projectDocument(
          populateDocument(document, state.users, populations),
          projection
        );
      });
    },

    findOneAndUpdate(filter, update) {
      return makeQuery(({ projection, populations }) => {
        const operation = reportUpdateQueue.then(() => {
          const document = state.reports.find((candidate) =>
            matchesFilter(candidate, filter)
          );

          if (!document) {
            return null;
          }

          applyUpdate(document, update);
          document.updatedAt = new Date();

          return projectDocument(
            populateDocument(document, state.users, populations),
            projection
          );
        });

        reportUpdateQueue = operation.catch(() => undefined);

        return operation;
      });
    },

    create(data) {
      const operation = reportCreateQueue.then(() => {
        const duplicateReport = state.reports.find(
          (candidate) =>
            valuesEqual(candidate.user, data.user) &&
            valuesEqual(candidate.analysis, data.analysis)
        );

        if (duplicateReport) {
          const error = new Error("duplicate report");
          error.code = 11000;
          error.keyPattern = { user: 1, analysis: 1 };
          throw error;
        }

        const duplicateTicket = state.reports.find(
          (candidate) => candidate.ticketNumber === data.ticketNumber
        );

        if (duplicateTicket) {
          const error = new Error("duplicate ticket");
          error.code = 11000;
          error.keyPattern = { ticketNumber: 1 };
          throw error;
        }

        const now = new Date();
        const report = {
          _id: createObjectId(),
          createdAt: now,
          updatedAt: now,
          ...cloneValue(data)
        };

        state.reports.push(report);

        return cloneValue(report);
      });

      reportCreateQueue = operation.catch(() => undefined);

      return operation;
    },

    aggregate(pipeline) {
      Report.lastAggregatePipeline = pipeline;

      const priorityRank = { high: 0, normal: 1, low: 2 };
      const orderedReports = [...state.reports].sort((left, right) => {
        const workflowComparison =
          (left.status === "completed" ? 1 : 0) -
          (right.status === "completed" ? 1 : 0);

        if (workflowComparison !== 0) {
          return workflowComparison;
        }

        const priorityComparison =
          (priorityRank[left.priority] ?? 3) -
          (priorityRank[right.priority] ?? 3);

        if (priorityComparison !== 0) {
          return priorityComparison;
        }

        const createdComparison = compareValues(
          left.createdAt,
          right.createdAt
        );

        if (createdComparison !== 0) {
          return createdComparison;
        }

        return idValue(left._id).localeCompare(idValue(right._id));
      });

      return Promise.resolve(
        orderedReports.map((report) => {
          const populated = populateDocument(report, state.users, [
            ["user", "name email"],
            ["assignedTo", "name email role"],
            ["reviewedBy", "name email role"]
          ]);

          return {
            ...populated,
            reporter: populated.user,
            assignedTo: populated.assignedTo,
            reviewedBy: populated.reviewedBy,
            user: undefined
          };
        })
      );
    }
  };

  return {
    models: {
      Analysis,
      Report,
      ReportMessage,
      User
    },
    state
  };
}

function makeUser(overrides = {}) {
  return {
    _id: createObjectId(),
    name: "Test User",
    email: "test-user@test.invalid",
    password: "private-hash",
    role: "user",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeAnalysis(overrides = {}) {
  return {
    _id: createObjectId(),
    user: createObjectId(),
    url: "https://example.com/login",
    risk: "low",
    score: 5,
    indicators: ["Contains suspicious keyword(s): login"],
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeReport(overrides = {}) {
  const reportId = createObjectId();

  return {
    _id: reportId,
    ticketNumber: `PG-2026-${reportId.toString().slice(-6)}`,
    user: createObjectId(),
    analysis: createObjectId(),
    analysisSnapshot: {
      url: "https://example.com/login",
      risk: "low",
      score: 5,
      indicators: ["Contains suspicious keyword(s): login"]
    },
    reason: "suspected_phishing",
    details: null,
    status: "submitted",
    priority: "normal",
    assignedTo: null,
    assessment: "pending",
    reviewerNote: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeAllocator(startAt = 1) {
  let nextSequence = startAt;
  const calls = [];

  return {
    calls,
    allocateTicketNumber: async ({ createdAt }) => {
      calls.push(createdAt);
      const year = createdAt.getUTCFullYear();
      return `PG-${year}-${String(nextSequence++).padStart(6, "0")}`;
    }
  };
}

function serviceOptions(harness, allocator) {
  return {
    models: harness.models,
    allocateTicketNumber:
      allocator?.allocateTicketNumber ||
      makeAllocator().allocateTicketNumber
  };
}

async function assertServiceError(promise, code, status) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(error instanceof ReportingServiceError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      return true;
    }
  );
}

test("Report creation uses owned Analysis data and server-controlled initial state", async () => {
  const owner = makeUser({ name: "Owner" });
  const analysis = makeAnalysis({
    user: owner._id,
    risk: "medium",
    score: 25,
    indicators: ["URL uses an IP address instead of a domain name"]
  });
  const harness = createMemoryModels({
    users: [owner],
    analyses: [analysis]
  });
  const allocator = makeAllocator();
  const options = serviceOptions(harness, allocator);

  const result = await createReport(
    {
      userId: owner._id,
      analysisId: analysis._id,
      reason: "credential_request",
      details: "  Context from the reporter  ",
      analysisSnapshot: {
        url: "https://forged.example",
        risk: "high",
        score: 100,
        indicators: ["forged"]
      },
      priority: "high"
    },
    options
  );

  assert.equal(harness.state.reports.length, 1);
  const stored = harness.state.reports[0];
  assert.equal(stored.user.toString(), owner._id.toString());
  assert.equal(stored.analysis.toString(), analysis._id.toString());
  assert.deepEqual(stored.analysisSnapshot, {
    url: analysis.url,
    risk: analysis.risk,
    score: analysis.score,
    indicators: analysis.indicators
  });
  assert.equal(Object.hasOwn(stored.analysisSnapshot, "findings"), false);
  assert.equal(stored.status, "submitted");
  assert.equal(stored.priority, "normal");
  assert.equal(stored.assignedTo, null);
  assert.equal(stored.assessment, "pending");
  assert.equal(stored.reviewerNote, null);
  assert.equal(stored.reviewedBy, null);
  assert.equal(stored.reviewedAt, null);
  assert.equal(allocator.calls.length, 1);
  assert.equal(result.ticketNumber, "PG-2026-000001");
  assert.equal(result.details, "Context from the reporter");
  assert.equal(result.analysisSnapshot.findings[0].type, "ip_address");
});

test("Report creation accepts low, medium, and high source Analysis results", async () => {
  const owner = makeUser();
  const analyses = [
    makeAnalysis({ user: owner._id, risk: "low", score: 0, indicators: [] }),
    makeAnalysis({ user: owner._id, risk: "medium", score: 25 }),
    makeAnalysis({ user: owner._id, risk: "high", score: 50 })
  ];
  const harness = createMemoryModels({
    users: [owner],
    analyses
  });
  const options = serviceOptions(harness);

  for (const analysis of analyses) {
    await createReport(
      {
        userId: owner._id,
        analysisId: analysis._id,
        reason: "other"
      },
      options
    );
  }

  assert.equal(harness.state.reports.length, 3);
});

test("Report creation treats another user's Analysis as inaccessible", async () => {
  const owner = makeUser();
  const otherOwner = makeUser();
  const analysis = makeAnalysis({ user: otherOwner._id });
  const harness = createMemoryModels({
    users: [owner, otherOwner],
    analyses: [analysis]
  });
  const allocator = makeAllocator();

  await assertServiceError(
    createReport(
      {
        userId: owner._id,
        analysisId: analysis._id,
        reason: "other"
      },
      serviceOptions(harness, allocator)
    ),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );

  assert.equal(harness.state.reports.length, 0);
  assert.equal(allocator.calls.length, 0);
});

test("Report creation rejects duplicate user and Analysis Reports", async () => {
  const owner = makeUser();
  const analysis = makeAnalysis({ user: owner._id });
  const harness = createMemoryModels({
    users: [owner],
    analyses: [analysis]
  });
  const allocator = makeAllocator();
  const options = serviceOptions(harness, allocator);

  await createReport(
    {
      userId: owner._id,
      analysisId: analysis._id,
      reason: "other"
    },
    options
  );

  await assertServiceError(
    createReport(
      {
        userId: owner._id,
        analysisId: analysis._id,
        reason: "other"
      },
      options
    ),
    REPORTING_ERROR_CODES.DUPLICATE_REPORT,
    409
  );

  assert.equal(harness.state.reports.length, 1);
  assert.equal(allocator.calls.length, 1);
});

test("Report creation maps a duplicate-key race to a safe conflict", async () => {
  const owner = makeUser();
  const analysis = makeAnalysis({ user: owner._id });
  const harness = createMemoryModels({
    users: [owner],
    analyses: [analysis]
  });
  const originalReportModel = harness.models.Report;
  const raceReportModel = {
    ...originalReportModel,
    findOne(filter) {
      if (filter.user && filter.analysis) {
        return {
          select() {
            return this;
          },
          lean() {
            return Promise.resolve(null);
          }
        };
      }

      return originalReportModel.findOne(filter);
    }
  };
  const raceHarness = {
    ...harness,
    models: {
      ...harness.models,
      Report: raceReportModel
    }
  };

  await harness.models.Report.create({
    ticketNumber: "PG-2026-000099",
    user: owner._id,
    analysis: analysis._id,
    analysisSnapshot: analysis,
    reason: "other"
  });

  await assertServiceError(
    createReport(
      {
        userId: owner._id,
        analysisId: analysis._id,
        reason: "other"
      },
      serviceOptions(raceHarness)
    ),
    REPORTING_ERROR_CODES.DUPLICATE_REPORT,
    409
  );
});

test("distinct Analyses with the same URL remain independently reportable", async () => {
  const owner = makeUser();
  const firstAnalysis = makeAnalysis({
    user: owner._id,
    url: "https://same.example"
  });
  const secondAnalysis = makeAnalysis({
    user: owner._id,
    url: "https://same.example"
  });
  const harness = createMemoryModels({
    users: [owner],
    analyses: [firstAnalysis, secondAnalysis]
  });
  const options = serviceOptions(harness);

  await createReport(
    {
      userId: owner._id,
      analysisId: firstAnalysis._id,
      reason: "other"
    },
    options
  );
  await createReport(
    {
      userId: owner._id,
      analysisId: secondAnalysis._id,
      reason: "other"
    },
    options
  );

  assert.equal(harness.state.reports.length, 2);
  assert.equal(
    new Set(
      harness.state.reports.map((report) => report.ticketNumber)
    ).size,
    2
  );
});

test("own Report reads are owner-scoped and newest-first", async () => {
  const owner = makeUser();
  const otherOwner = makeUser();
  const older = makeReport({
    user: owner._id,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const newer = makeReport({
    user: owner._id,
    createdAt: new Date("2026-01-02T00:00:00.000Z")
  });
  const other = makeReport({
    user: otherOwner._id,
    createdAt: new Date("2026-01-03T00:00:00.000Z")
  });
  const harness = createMemoryModels({
    users: [owner, otherOwner],
    reports: [older, newer, other]
  });
  const options = serviceOptions(harness);

  const reports = await getOwnReports(owner._id, options);
  assert.deepEqual(
    reports.map((report) => report.id),
    [newer._id.toString(), older._id.toString()]
  );
  assert.equal(
    (await getOwnReport(owner._id, newer._id, options)).id,
    newer._id.toString()
  );

  await assertServiceError(
    getOwnReport(owner._id, other._id, options),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );

  const staff = makeUser({ role: "staff" });
  harness.state.users.push(staff);
  await assertServiceError(
    getOwnReport(staff._id, newer._id, serviceOptions(harness)),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );
});

test("own Report messages are chronological, server-derived, and ownership-scoped", async () => {
  const owner = makeUser();
  const otherOwner = makeUser();
  const report = makeReport({
    user: owner._id,
    status: "submitted"
  });
  const firstMessage = {
    _id: createObjectId(),
    report: report._id,
    sender: owner._id,
    senderRole: "user",
    message: "First context",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
  const secondMessage = {
    _id: createObjectId(),
    report: report._id,
    sender: owner._id,
    senderRole: "user",
    message: "Second context",
    createdAt: new Date("2026-01-02T00:00:00.000Z")
  };
  const harness = createMemoryModels({
    users: [owner, otherOwner],
    reports: [report],
    messages: [secondMessage, firstMessage]
  });
  const options = serviceOptions(harness);

  const listed = await getOwnReportMessages(
    owner._id,
    report._id,
    options
  );
  assert.deepEqual(
    listed.map((message) => message.id),
    [firstMessage._id.toString(), secondMessage._id.toString()]
  );
  assert.deepEqual(listed[0].sender, {
    name: owner.name,
    role: "user"
  });

  const created = await createOwnReportMessage(
    {
      userId: owner._id,
      reportId: report._id,
      message: "Additional context",
      actorRole: "user"
    },
    options
  );
  assert.equal(created.message, "Additional context");
  assert.equal(
    harness.state.messages.at(-1).sender.toString(),
    owner._id.toString()
  );
  assert.equal(harness.state.messages.at(-1).senderRole, "user");

  await assertServiceError(
    getOwnReportMessages(
      otherOwner._id,
      report._id,
      options
    ),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );
  await assertServiceError(
    createOwnReportMessage(
      {
        userId: otherOwner._id,
        reportId: report._id,
        message: "Not my report",
        actorRole: "user"
      },
      options
    ),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );
});

test("completed Reports reject new messages but remain readable", async () => {
  const owner = makeUser();
  const report = makeReport({
    user: owner._id,
    status: "completed",
    assessment: "phishing"
  });
  const existingMessage = {
    _id: createObjectId(),
    report: report._id,
    sender: owner._id,
    senderRole: "user",
    message: "Historical context",
    createdAt: new Date()
  };
  const harness = createMemoryModels({
    users: [owner],
    reports: [report],
    messages: [existingMessage]
  });
  const options = serviceOptions(harness);

  await assertServiceError(
    createOwnReportMessage(
      {
        userId: owner._id,
        reportId: report._id,
        message: "Too late",
        actorRole: "user"
      },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  const listed = await getOwnReportMessages(
    owner._id,
    report._id,
    options
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].message, "Historical context");
});

test("IT queue uses explicit numeric priority ranking and safe lookup output", async () => {
  const reporter = makeUser({ name: "Reporter" });
  const staff = makeUser({
    name: "Staff",
    role: "staff"
  });
  const high = makeReport({
    user: reporter._id,
    priority: "high",
    status: "submitted",
    createdAt: new Date("2026-01-05T00:00:00.000Z")
  });
  const normal = makeReport({
    user: reporter._id,
    priority: "normal",
    status: "under_review",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const low = makeReport({
    user: reporter._id,
    priority: "low",
    status: "submitted",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const normalTieA = makeReport({
    user: reporter._id,
    priority: "normal",
    status: "submitted",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const normalTieB = makeReport({
    user: reporter._id,
    priority: "normal",
    status: "under_review",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const completed = makeReport({
    user: reporter._id,
    priority: "normal",
    status: "completed",
    assessment: "suspicious",
    createdAt: new Date("2025-12-01T00:00:00.000Z")
  });
  const expectedNormalGroup = [
    normal,
    normalTieA,
    normalTieB
  ].sort((left, right) =>
    left._id.toString().localeCompare(right._id.toString())
  );
  const harness = createMemoryModels({
    users: [reporter, staff],
    reports: [low, completed, normalTieB, normal, normalTieA, high]
  });

  const queue = await getReviewQueue(serviceOptions(harness));
  assert.deepEqual(
    queue.map((report) => report.ticketNumber),
    [
      high.ticketNumber,
      ...expectedNormalGroup.map((report) => report.ticketNumber),
      low.ticketNumber,
      completed.ticketNumber
    ]
  );
  assert.deepEqual(queue[0].reporter, {
    id: reporter._id.toString(),
    name: reporter.name,
    email: reporter.email
  });
  assert.equal(JSON.stringify(queue).includes("private-hash"), false);
  assert.equal(JSON.stringify(queue).includes("isActive"), false);

  const pipeline = harness.models.Report.lastAggregatePipeline;
  const setStage = pipeline.find((stage) => stage.$set);
  const sortStage = pipeline.find((stage) => stage.$sort);
  const prioritySwitch = setStage.$set.reportingPriorityRank.$switch;
  assert.deepEqual(
    prioritySwitch.branches.map((branch) => branch.then),
    [0, 1, 2]
  );
  assert.deepEqual(sortStage.$sort, {
    reportingWorkflowRank: 1,
    reportingPriorityRank: 1,
    createdAt: 1,
    _id: 1
  });
  assert.equal(
    Object.hasOwn(harness.state.reports[0], "priorityRank"),
    false
  );
});

test("IT detail and IT messages work without assignment and reject completion", async () => {
  const reporter = makeUser();
  const staff = makeUser({ role: "staff" });
  const report = makeReport({
    user: reporter._id,
    status: "under_review",
    assignedTo: null
  });
  const harness = createMemoryModels({
    users: [reporter, staff],
    reports: [report]
  });
  const options = serviceOptions(harness);

  const detail = await getReviewReport(report._id, options);
  assert.equal(detail.ticketNumber, report.ticketNumber);
  assert.equal(detail.reporter.email, reporter.email);
  assert.equal(detail.assignedTo, null);

  const message = await createReviewReportMessage(
    {
      reportId: report._id,
      actorId: staff._id,
      actorRole: "staff",
      message: "Please provide more context."
    },
    options
  );
  assert.equal(message.sender.id, staff._id.toString());
  assert.equal(message.sender.role, "staff");

  const messages = await getReviewReportMessages(report._id, options);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "Please provide more context.");

  await assertServiceError(
    getReviewReport(createObjectId(), options),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );

  report.status = "completed";
  await assertServiceError(
    createReviewReportMessage(
      {
        reportId: report._id,
        actorId: staff._id,
        actorRole: "staff",
        message: "Too late"
      },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  const completedMessages = await getReviewReportMessages(
    report._id,
    options
  );
  assert.equal(completedMessages.length, 1);
  assert.equal(
    completedMessages[0].message,
    "Please provide more context."
  );
});

test("claim is self-service, preserves workflow fields, and is concurrency-safe", async () => {
  const reporter = makeUser();
  const staff = makeUser({ role: "staff" });
  const otherStaff = makeUser({ role: "staff" });
  const report = makeReport({
    user: reporter._id,
    status: "submitted",
    priority: "high"
  });
  const harness = createMemoryModels({
    users: [reporter, staff, otherStaff],
    reports: [report]
  });
  const options = serviceOptions(harness);

  const claimed = await claimReviewReport(
    { reportId: report._id, actorId: staff._id },
    options
  );
  assert.equal(claimed.assignedTo.id, staff._id.toString());
  assert.equal(claimed.status, "submitted");
  assert.equal(claimed.priority, "high");
  assert.equal(claimed.assessment, "pending");

  await assertServiceError(
    claimReviewReport(
      { reportId: report._id, actorId: otherStaff._id },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  report.status = "completed";
  report.assignedTo = null;
  await assertServiceError(
    claimReviewReport(
      { reportId: report._id, actorId: staff._id },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  const raceReport = makeReport({
    user: reporter._id,
    status: "submitted"
  });
  harness.state.reports.push(raceReport);
  const results = await Promise.allSettled([
    claimReviewReport(
      { reportId: raceReport._id, actorId: staff._id },
      options
    ),
    claimReviewReport(
      { reportId: raceReport._id, actorId: otherStaff._id },
      options
    )
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    REPORTING_ERROR_CODES.CONFLICT
  );
});

test("admin assignment validates active staff/admin targets and supports reassignment", async () => {
  const reporter = makeUser();
  const staff = makeUser({ role: "staff", name: "Staff" });
  const admin = makeUser({ role: "admin", name: "Admin" });
  const normal = makeUser({ role: "user", name: "Normal" });
  const inactive = makeUser({
    role: "staff",
    name: "Inactive",
    isActive: false
  });
  const report = makeReport({ user: reporter._id });
  const harness = createMemoryModels({
    users: [reporter, staff, admin, normal, inactive],
    reports: [report]
  });
  const options = serviceOptions(harness);

  const assignedToStaff = await assignReviewReport(
    { reportId: report._id, assignedTo: staff._id },
    options
  );
  assert.equal(assignedToStaff.assignedTo.id, staff._id.toString());

  const assignedToAdmin = await assignReviewReport(
    { reportId: report._id, assignedTo: admin._id },
    options
  );
  assert.equal(assignedToAdmin.assignedTo.id, admin._id.toString());

  await assertServiceError(
    assignReviewReport(
      { reportId: report._id, assignedTo: normal._id },
      options
    ),
    REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
    400
  );
  await assertServiceError(
    assignReviewReport(
      { reportId: report._id, assignedTo: inactive._id },
      options
    ),
    REPORTING_ERROR_CODES.INVALID_ASSIGNEE,
    400
  );
  await assertServiceError(
    assignReviewReport(
      { reportId: report._id, assignedTo: createObjectId() },
      options
    ),
    REPORTING_ERROR_CODES.NOT_FOUND,
    404
  );

  report.status = "completed";
  await assertServiceError(
    assignReviewReport(
      { reportId: report._id, assignedTo: staff._id },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );
});

test("assignment candidates are active staff/admin only and safely ordered", async () => {
  const staff = makeUser({
    name: "Zoe Staff",
    email: "zoe@test.invalid",
    role: "staff"
  });
  const admin = makeUser({
    name: "Alice Admin",
    email: "alice@test.invalid",
    role: "admin"
  });
  const normal = makeUser({ name: "Normal User", role: "user" });
  const inactive = makeUser({
    name: "Inactive Staff",
    role: "staff",
    isActive: false
  });
  const harness = createMemoryModels({
    users: [staff, admin, normal, inactive]
  });

  const candidates = await getAssignmentCandidates(
    serviceOptions(harness)
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ["Alice Admin", "Zoe Staff"]
  );
  assert.deepEqual(Object.keys(candidates[0]).sort(), [
    "email",
    "id",
    "name",
    "role"
  ]);
  assert.equal(JSON.stringify(candidates).includes("isActive"), false);
  assert.equal(JSON.stringify(candidates).includes("password"), false);
});

test("priority updates are unfinished-only and change no other field", async () => {
  const reporter = makeUser();
  const report = makeReport({
    user: reporter._id,
    priority: "normal",
    analysisSnapshot: {
      url: "https://example.com",
      risk: "high",
      score: 75,
      indicators: []
    }
  });
  const harness = createMemoryModels({
    users: [reporter],
    reports: [report]
  });
  const options = serviceOptions(harness);
  const before = { ...report };

  const updated = await updateReviewReportPriority(
    { reportId: report._id, priority: "high" },
    options
  );
  assert.equal(updated.priority, "high");
  assert.equal(updated.status, before.status);
  assert.equal(updated.assessment, before.assessment);
  assert.deepEqual(
    {
      url: updated.analysisSnapshot.url,
      risk: updated.analysisSnapshot.risk,
      score: updated.analysisSnapshot.score,
      indicators: updated.analysisSnapshot.indicators
    },
    {
      url: before.analysisSnapshot.url,
      risk: before.analysisSnapshot.risk,
      score: before.analysisSnapshot.score,
      indicators: before.analysisSnapshot.indicators
    }
  );

  report.status = "completed";
  await assertServiceError(
    updateReviewReportPriority(
      { reportId: report._id, priority: "low" },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );
});

test("Start Review performs only submitted to under_review", async () => {
  const reporter = makeUser();
  const report = makeReport({
    user: reporter._id,
    status: "submitted",
    priority: "high"
  });
  const harness = createMemoryModels({
    users: [reporter],
    reports: [report]
  });
  const options = serviceOptions(harness);

  const started = await startReviewReport(report._id, options);
  assert.equal(started.status, "under_review");
  assert.equal(started.assessment, "pending");
  assert.equal(started.priority, "high");
  assert.equal(started.assignedTo, null);

  await assertServiceError(
    startReviewReport(report._id, options),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  report.status = "completed";
  await assertServiceError(
    startReviewReport(report._id, options),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );
});

test("completion enforces assignment, reviewer role, metadata, and immutability", async () => {
  const reporter = makeUser();
  const staff = makeUser({ role: "staff" });
  const otherStaff = makeUser({ role: "staff" });
  const admin = makeUser({ role: "admin" });
  const unassigned = makeReport({ user: reporter._id });
  const staffReport = makeReport({
    user: reporter._id,
    assignedTo: staff._id
  });
  const adminReport = makeReport({
    user: reporter._id,
    assignedTo: otherStaff._id
  });
  const harness = createMemoryModels({
    users: [reporter, staff, otherStaff, admin],
    reports: [unassigned, staffReport, adminReport]
  });
  const options = serviceOptions(harness);

  await assertServiceError(
    completeReviewReport(
      {
        reportId: unassigned._id,
        actorId: staff._id,
        actorRole: "staff",
        assessment: "phishing"
      },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );

  const before = { ...staffReport };
  const completed = await completeReviewReport(
    {
      reportId: staffReport._id,
      actorId: staff._id,
      actorRole: "staff",
      assessment: "phishing",
      reviewerNote: "  Final note  "
    },
    options
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.assessment, "phishing");
  assert.equal(completed.reviewerNote, "Final note");
  assert.equal(completed.reviewedBy.id, staff._id.toString());
  assert.ok(completed.reviewedAt instanceof Date);
  assert.equal(completed.ticketNumber, before.ticketNumber);
  assert.equal(completed.analysisId, before.analysis._id.toString());
  assert.deepEqual(
    {
      url: completed.analysisSnapshot.url,
      risk: completed.analysisSnapshot.risk,
      score: completed.analysisSnapshot.score,
      indicators: completed.analysisSnapshot.indicators
    },
    {
      url: before.analysisSnapshot.url,
      risk: before.analysisSnapshot.risk,
      score: before.analysisSnapshot.score,
      indicators: before.analysisSnapshot.indicators
    }
  );
  assert.equal(completed.reason, before.reason);
  assert.equal(completed.details, before.details);
  assert.equal(completed.priority, before.priority);
  assert.equal(completed.assignedTo.id, staff._id.toString());

  await assertServiceError(
    completeReviewReport(
      {
        reportId: adminReport._id,
        actorId: staff._id,
        actorRole: "staff",
        assessment: "suspicious"
      },
      options
    ),
    REPORTING_ERROR_CODES.FORBIDDEN,
    403
  );

  const adminCompleted = await completeReviewReport(
    {
      reportId: adminReport._id,
      actorId: admin._id,
      actorRole: "admin",
      assessment: "suspicious"
    },
    options
  );
  assert.equal(adminCompleted.reviewedBy.id, admin._id.toString());
  assert.equal(adminCompleted.status, "completed");

  await assertServiceError(
    completeReviewReport(
      {
        reportId: staffReport._id,
        actorId: staff._id,
        actorRole: "staff",
        assessment: "phishing"
      },
      options
    ),
    REPORTING_ERROR_CODES.CONFLICT,
    409
  );
});

test("competing completion attempts allow exactly one final reviewer", async () => {
  const reporter = makeUser();
  const staff = makeUser({ role: "staff" });
  const report = makeReport({
    user: reporter._id,
    assignedTo: staff._id
  });
  const harness = createMemoryModels({
    users: [reporter, staff],
    reports: [report]
  });
  const options = serviceOptions(harness);

  const results = await Promise.allSettled([
    completeReviewReport(
      {
        reportId: report._id,
        actorId: staff._id,
        actorRole: "staff",
        assessment: "phishing"
      },
      options
    ),
    completeReviewReport(
      {
        reportId: report._id,
        actorId: staff._id,
        actorRole: "staff",
        assessment: "suspicious"
      },
      options
    )
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1
  );
  assert.equal(harness.state.reports[0].status, "completed");
  assert.equal(
    harness.state.reports[0].reviewedBy.toString(),
    staff._id.toString()
  );
  assert.ok(harness.state.reports[0].reviewedAt instanceof Date);
});

test("service results remain safe and reconstruct findings from snapshots", async () => {
  const reporter = makeUser({ name: "Reporter" });
  const assigned = makeUser({
    name: "Assigned",
    role: "staff"
  });
  const report = makeReport({
    user: reporter._id,
    assignedTo: assigned._id,
    analysisSnapshot: {
      url: "https://example.com/login",
      risk: "low",
      score: 5,
      indicators: ["Contains suspicious keyword(s): login"]
    }
  });
  const harness = createMemoryModels({
    users: [reporter, assigned],
    reports: [report]
  });

  const detail = await getReviewReport(
    report._id,
    serviceOptions(harness)
  );
  const serialized = JSON.stringify(detail);
  assert.equal(detail.analysisSnapshot.findings[0].type, "suspicious_keyword");
  assert.equal(serialized.includes("private-hash"), false);
  assert.equal(serialized.includes("isActive"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(
    Object.hasOwn(detail.analysisSnapshot, "findings"),
    true
  );
});
