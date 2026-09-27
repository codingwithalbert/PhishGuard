const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createReviewReportMessage,
  completeReviewReport,
  createReport,
  createOwnReportMessage,
  claimReviewReport,
  assignReviewReport,
  updateReviewReportPriority,
  startReviewReport
} = require("../src/services/reporting.service");

function createObjectId() {
  return new mongoose.Types.ObjectId();
}

function createReportModel(reportData) {
  const calls = [];

  return {
    calls,
    findById(id) {
      calls.push({ method: "findById", id });
      return {
        select() {
          return {
            lean: async () =>
              reportData ? { _id: id, ...reportData } : null
          };
        }
      };
    },
    findOneAndUpdate(filter, update) {
      calls.push({ method: "findOneAndUpdate", filter, update });
      return {
        select() {
          return {
            populate() {
              return {
                lean: async () =>
                  reportData
                    ? {
                        _id: filter._id,
                        ...reportData,
                        ...update.$set,
                        createdAt: new Date(),
                        updatedAt: new Date()
                      }
                    : null
              };
            }
          };
        }
      };
    },
    findOne(filter) {
      calls.push({ method: "findOne", filter });
      return {
        select() {
          return {
            lean: async () =>
              reportData ? { _id: filter._id, ...reportData } : null
          };
        }
      };
    },
    async create(data) {
      calls.push({ method: "create", data });
      return {
        _id: createObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data
      };
    }
  };
}

function createMessageModel(messageData) {
  const createCalls = [];
  let storedMessage = null;

  return {
    createCalls,
    async create(data) {
      createCalls.push({ method: "create", data });
      storedMessage = {
        _id: createObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...messageData,
        ...data
      };
      return storedMessage;
    },
    findById(id) {
      return {
        select() {
          return {
            populate() {
              return {
                lean: async () => storedMessage
              };
            }
          };
        }
      };
    }
  };
}

function createUserModel(userData) {
  return {
    findById(id) {
      return {
        select() {
          return {
            lean: async () => (userData ? { _id: id, ...userData } : null)
          };
        }
      };
    }
  };
}

function createTicketAllocator() {
  return async () => `PG-2026-${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`;
}

function createPopulatedMessage() {
  return {
    _id: createObjectId(),
    report: createObjectId(),
    sender: createObjectId(),
    senderRole: "staff",
    message: "Staff message",
    createdAt: new Date(),
    updatedAt: new Date(),
    name: "Staff Name",
    role: "staff"
  };
}

function createNotificationSpy(result = { sent: true }) {
  const calls = [];

  return {
    calls,
    async notifyReportOwner(input) {
      calls.push(input);
      return result;
    }
  };
}

function createThrowingNotification() {
  const calls = [];

  return {
    calls,
    async notifyReportOwner(input) {
      calls.push(input);
      throw new Error("Unexpected notification failure");
    }
  };
}

test("successful IT message persistence triggers exactly one message notification after persistence", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy();

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Can you confirm where you received this link?"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result);
  assert.equal(messageModel.createCalls.length, 1);
  assert.equal(notification.calls.length, 1);
  assert.deepEqual(notification.calls[0], {
    reportId: reportId.toString(),
    notificationType: "message"
  });
});

test("notification occurs only after message persistence is confirmed", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const events = [];
  const messageModel = createMessageModel(null);

  const originalCreate = messageModel.create.bind(messageModel);
  messageModel.create = async (data) => {
    events.push("persistence:start");
    const result = await originalCreate(data);
    events.push("persistence:end");
    return result;
  };

  const notification = {
    calls: [],
    async notifyReportOwner(input) {
      events.push("notification");
      this.calls.push(input);
      return { sent: true };
    }
  };

  await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test message"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  const persistenceEndIndex = events.indexOf("persistence:end");
  const notificationIndex = events.indexOf("notification");

  assert.ok(persistenceEndIndex >= 0, "persistence should have occurred");
  assert.ok(notificationIndex >= 0, "notification should have occurred");
  assert.ok(
    persistenceEndIndex < notificationIndex,
    "persistence must complete before notification"
  );
});

test("successful completion persistence triggers exactly one completion notification after persistence", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const events = [];
  const notification = {
    calls: [],
    async notifyReportOwner(input) {
      events.push("notification");
      this.calls.push(input);
      return { sent: true };
    }
  };

  const reportModel = createReportModel({
    _id: reportId,
    status: "under_review",
    assignedTo: staffId
  });

  const originalFindOneAndUpdate = reportModel.findOneAndUpdate.bind(reportModel);
  reportModel.findOneAndUpdate = (filter, update) => {
    events.push("persistence:start");
    const query = originalFindOneAndUpdate(filter, update);
    const originalSelect = query.select.bind(query);
    query.select = (projection) => {
      const selectedQuery = originalSelect(projection);
      const originalPopulate = selectedQuery.populate.bind(selectedQuery);
      selectedQuery.populate = (path, fields) => {
        const populatedQuery = originalPopulate(path, fields);
        const originalLean = populatedQuery.lean.bind(populatedQuery);
        populatedQuery.lean = async () => {
          const result = await originalLean();
          events.push("persistence:end");
          return result;
        };
        return populatedQuery;
      };
      return selectedQuery;
    };
    return query;
  };

  const result = await completeReviewReport(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      assessment: "phishing"
    },
    {
      models: {
        Report: reportModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification)
    }
  );

  assert.ok(result);
  assert.equal(notification.calls.length, 1);
  assert.deepEqual(notification.calls[0], {
    reportId: reportId.toString(),
    notificationType: "completion"
  });

  const persistenceEndIndex = events.indexOf("persistence:end");
  const notificationIndex = events.indexOf("notification");

  assert.ok(persistenceEndIndex >= 0, "persistence should have occurred");
  assert.ok(notificationIndex >= 0, "notification should have occurred");
  assert.ok(
    persistenceEndIndex < notificationIndex,
    "completion persistence must complete before notification"
  );
});

test("notification success does not change the existing successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({ sent: true });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.ok(result.sender);
  assert.ok(result.createdAt);
  assert.equal(result.message, "Test");
  assert.equal(result.sender.role, "staff");
});

test("notification not_configured does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({
    sent: false,
    reason: "not_configured"
  });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
});

test("notification owner_not_found does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({
    sent: false,
    reason: "owner_not_found"
  });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
});

test("notification owner_inactive does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({
    sent: false,
    reason: "owner_inactive"
  });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
});

test("notification owner_email_invalid does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({
    sent: false,
    reason: "owner_email_invalid"
  });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
});

test("notification delivery_failed does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy({
    sent: false,
    reason: "delivery_failed"
  });

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
});

test("notifyReportOwner unexpectedly throwing does not change successful Reporting result", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createThrowingNotification();

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.equal(result.message, "Test");
  assert.equal(notification.calls.length, 1);
});

test("failed message persistence causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await assert.rejects(
    () =>
      createReviewReportMessage(
        {
          reportId: reportId.toString(),
          actorId: staffId.toString(),
          actorRole: "staff",
          message: "Test"
        },
        {
          models: {
            Report: createReportModel(null),
            ReportMessage: createMessageModel(null),
            User: createUserModel(null)
          },
          notifyReportOwner: notification.notifyReportOwner.bind(notification),
          ticketAllocator: createTicketAllocator()
        }
      ),
    (error) => {
      assert.equal(error.code, "REPORTING_NOT_FOUND");
      return true;
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("failed completion persistence causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await assert.rejects(
    () =>
      completeReviewReport(
        {
          reportId: reportId.toString(),
          actorId: staffId.toString(),
          actorRole: "staff",
          assessment: "phishing"
        },
        {
          models: {
            Report: createReportModel(null),
            User: createUserModel(null)
          },
          notifyReportOwner: notification.notifyReportOwner.bind(notification),
          ticketAllocator: createTicketAllocator()
        }
      ),
    (error) => {
      assert.equal(error.code, "REPORTING_NOT_FOUND");
      return true;
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("existing validation/authorization/state failure before persistence causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await assert.rejects(
    () =>
      createReviewReportMessage(
        {
          reportId: reportId.toString(),
          actorId: staffId.toString(),
          actorRole: "invalid_role",
          message: "Test"
        },
        {
          models: {
            Report: createReportModel({
              _id: reportId,
              status: "submitted",
              assignedTo: staffId
            }),
            ReportMessage: createMessageModel(null),
            User: createUserModel(null)
          },
          notifyReportOwner: notification.notifyReportOwner.bind(notification),
          ticketAllocator: createTicketAllocator()
        }
      ),
    (error) => {
      assert.equal(error.code, "REPORTING_INVALID_ACTOR");
      return true;
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("student report creation causes zero notification attempts", async () => {
  const notification = createNotificationSpy();

  await createReport(
    {
      userId: createObjectId().toString(),
      analysisId: createObjectId().toString(),
      reason: "suspected_phishing"
    },
    {
      models: {
        Analysis: {
          findOne: () => ({
            select: () => ({
              lean: async () => ({
                _id: createObjectId(),
                url: "https://example.com",
                risk: "low",
                score: 0,
                indicators: []
              })
            })
          })
        },
        Report: createReportModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator()
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("student own-report message causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const userId = createObjectId();
  const notification = createNotificationSpy();

  const result = await createOwnReportMessage(
    {
      userId: userId.toString(),
      reportId: reportId.toString(),
      message: "My own message",
      actorRole: "user"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: null
        }),
        ReportMessage: createMessageModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result);
  assert.equal(notification.calls.length, 0);
});

test("claim action causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await claimReviewReport(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString()
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: null
        })
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      runConditionalReportUpdate: async () => ({
        _id: reportId,
        ticketNumber: "PG-2026-000123",
        status: "submitted",
        assignedTo: staffId
      })
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("assignment/reassignment causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const adminId = createObjectId();
  const targetStaffId = createObjectId();
  const notification = createNotificationSpy();

  await assignReviewReport(
    {
      reportId: reportId.toString(),
      assignedTo: targetStaffId.toString()
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: null
        }),
        User: createUserModel({
          _id: targetStaffId,
          name: "Staff",
          email: "staff@example.com",
          role: "staff",
          isActive: true
        })
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      runConditionalReportUpdate: async () => ({
        _id: reportId,
        ticketNumber: "PG-2026-000123",
        status: "submitted",
        assignedTo: targetStaffId
      })
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("priority change causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await updateReviewReportPriority(
    {
      reportId: reportId.toString(),
      priority: "high"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        })
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      runConditionalReportUpdate: async () => ({
        _id: reportId,
        ticketNumber: "PG-2026-000123",
        status: "submitted",
        priority: "high"
      })
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("start-review action causes zero notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await startReviewReport(reportId.toString(), {
    models: {
      Report: createReportModel({
        _id: reportId,
        status: "submitted",
        assignedTo: staffId
      })
    },
    notifyReportOwner: notification.notifyReportOwner.bind(notification),
    ticketAllocator: createTicketAllocator(),
    runConditionalReportUpdate: async () => ({
      _id: reportId,
      ticketNumber: "PG-2026-000123",
      status: "under_review"
    })
  });

  assert.equal(notification.calls.length, 0);
});

test("two successful IT message creations cause two notification attempts", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy();

  const options = {
    models: {
      Report: createReportModel({
        _id: reportId,
        status: "submitted",
        assignedTo: staffId
      }),
      ReportMessage: messageModel,
      User: createUserModel(null)
    },
    notifyReportOwner: notification.notifyReportOwner.bind(notification),
    ticketAllocator: createTicketAllocator(),
    getPopulatedMessage: async () => createPopulatedMessage()
  };

  await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "First message"
    },
    options
  );

  await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Second message"
    },
    options
  );

  assert.equal(messageModel.createCalls.length, 2);
  assert.equal(notification.calls.length, 2);
});

test("successful completion causes one notification attempt", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await completeReviewReport(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      assessment: "phishing"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "under_review",
          assignedTo: staffId
        }),
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      runConditionalReportUpdate: async () => ({
        _id: reportId,
        ticketNumber: "PG-2026-000123",
        status: "completed",
        assessment: "phishing",
        reviewedBy: staffId,
        reviewedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    }
  );

  assert.equal(notification.calls.length, 1);
});

test("subsequent completion conflict causes no second notification attempt", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await assert.rejects(
    () =>
      completeReviewReport(
        {
          reportId: reportId.toString(),
          actorId: staffId.toString(),
          actorRole: "staff",
          assessment: "phishing"
        },
        {
          models: {
            Report: createReportModel({
              _id: reportId,
              status: "completed",
              assignedTo: staffId
            }),
            User: createUserModel(null)
          },
          notifyReportOwner: notification.notifyReportOwner.bind(notification),
          ticketAllocator: createTicketAllocator()
        }
      ),
    (error) => {
      assert.equal(error.code, "REPORTING_CONFLICT");
      return true;
    }
  );

  assert.equal(notification.calls.length, 0);
});

test("notifyReportOwner receives only reportId and notificationType", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy();

  await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Sensitive message content"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId,
          analysisSnapshot: {
            url: "https://suspicious.example.com",
            risk: "high",
            score: 90,
            indicators: ["suspicious"]
          },
          reason: "suspected_phishing",
          details: "Sensitive details",
          assessment: "phishing",
          reviewerNote: "Sensitive reviewer note"
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.equal(notification.calls.length, 1);
  const call = notification.calls[0];

  assert.deepEqual(Object.keys(call).sort(), [
    "notificationType",
    "reportId"
  ]);
  assert.equal(call.reportId, reportId.toString());
  assert.equal(call.notificationType, "message");
  assert.equal(call.recipient, undefined);
  assert.equal(call.email, undefined);
  assert.equal(call.to, undefined);
  assert.equal(call.subject, undefined);
  assert.equal(call.body, undefined);
  assert.equal(call.textContent, undefined);
});

test("existing Reporting successful return shape remains unchanged", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const messageModel = createMessageModel(null);
  const notification = createNotificationSpy();

  const result = await createReviewReportMessage(
    {
      reportId: reportId.toString(),
      actorId: staffId.toString(),
      actorRole: "staff",
      message: "Test message"
    },
    {
      models: {
        Report: createReportModel({
          _id: reportId,
          status: "submitted",
          assignedTo: staffId
        }),
        ReportMessage: messageModel,
        User: createUserModel(null)
      },
      notifyReportOwner: notification.notifyReportOwner.bind(notification),
      ticketAllocator: createTicketAllocator(),
      getPopulatedMessage: async () => createPopulatedMessage()
    }
  );

  assert.ok(result.id);
  assert.ok(result.message);
  assert.ok(result.sender);
  assert.ok(result.createdAt);
  assert.equal(typeof result.id, "string");
  assert.equal(typeof result.message, "string");
  assert.equal(result.sender.role, "staff");
});

test("existing Reporting errors/status semantics remain unchanged", async () => {
  const reportId = createObjectId();
  const staffId = createObjectId();
  const notification = createNotificationSpy();

  await assert.rejects(
    () =>
      createReviewReportMessage(
        {
          reportId: reportId.toString(),
          actorId: staffId.toString(),
          actorRole: "staff",
          message: "Test"
        },
        {
          models: {
            Report: createReportModel({
              _id: reportId,
              status: "completed",
              assignedTo: staffId
            }),
            ReportMessage: createMessageModel(null),
            User: createUserModel(null)
          },
          notifyReportOwner: notification.notifyReportOwner.bind(notification),
          ticketAllocator: createTicketAllocator()
        }
      ),
    (error) => {
      assert.equal(error.code, "REPORTING_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    }
  );

  assert.equal(notification.calls.length, 0);
});
