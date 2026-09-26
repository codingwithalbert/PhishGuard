const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const errorHandler = require("../src/middleware/error.middleware");
const authRoutes = require("../src/routes/auth.routes");
const researchRoutes = require("../src/routes/research.routes");
const {
  createResearchController
} = require("../src/controllers/research.controller");
const {
  RESEARCH_CSV_COLUMNS,
  RESEARCH_CSV_CONTENT_TYPE,
  RESEARCH_CSV_FILENAME,
  escapeCsvField,
  formatCsvValue,
  serializeResearchParticipantCsv
} = require("../src/services/researchCsv.service");
const {
  buildResearchAnalyticsSummary
} = require("../src/services/researchAnalytics.dataset");

const { createResearchRouter } = researchRoutes;

const previousJwtSecret = process.env.JWT_SECRET;
const testJwtSecret = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = testJwtSecret;

const ADMIN_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const STAFF_ID = new mongoose.Types.ObjectId();
const FORBIDDEN_EMAIL = "research.identity@example.invalid";
const FORBIDDEN_NAME = "Research Identity";

const analyticsState = {
  serviceError: null,
  datasetError: null
};

const participants = [
  {
    participantId: "PG-R0001",
    awarenessScore: 80,
    awarenessCompletedAt: new Date("2026-03-01T10:00:00.000Z"),
    phishingIdentificationScore: 70,
    phishingIdentificationCompletedAt: new Date(
      "2026-03-02T11:30:00.000Z"
    ),
    completedTrainingModules: 3,
    trainingExposure: 100
  },
  {
    participantId: "PG-R0002",
    awarenessScore: null,
    awarenessCompletedAt: null,
    phishingIdentificationScore: null,
    phishingIdentificationCompletedAt: null,
    completedTrainingModules: 0,
    trainingExposure: 0
  },
  {
    participantId: "PG-R0003",
    awarenessScore: 40,
    awarenessCompletedAt: new Date("2026-03-03T00:00:00.000Z"),
    phishingIdentificationScore: 50,
    phishingIdentificationCompletedAt: new Date(
      "2026-03-03T01:00:00.000Z"
    ),
    completedTrainingModules: 1,
    trainingExposure: 33.33
  }
];

const researchService = {
  async buildResearchAnalytics() {
    if (analyticsState.serviceError) {
      const error = analyticsState.serviceError;
      analyticsState.serviceError = null;
      throw error;
    }

    return {
      participants,
      summary: buildResearchAnalyticsSummary(participants)
    };
  },

  async buildResearchParticipantDataset() {
    if (analyticsState.datasetError) {
      const error = analyticsState.datasetError;
      analyticsState.datasetError = null;
      throw error;
    }

    return participants;
  }
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api/research",
  createResearchRouter(createResearchController(researchService))
);
app.use("/api/auth", authRoutes);
app.use(errorHandler);

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
});

function makeToken(id, role) {
  return jwt.sign({ userId: String(id), role }, testJwtSecret, {
    expiresIn: "1h"
  });
}

function authHeaders(id, role) {
  return { Authorization: `Bearer ${makeToken(id, role)}` };
}

async function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers
  });
}

function assertNoStore(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

function assertNoIdentityLeak(text) {
  for (const forbidden of [
    FORBIDDEN_EMAIL,
    FORBIDDEN_NAME,
    "password",
    "passwordReset",
    "http://",
    "https://",
    "ObjectId",
    String(ADMIN_ID),
    String(USER_ID),
    String(STAFF_ID)
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `Response must not contain ${forbidden}`
    );
  }

  // No generated pseudonymous participant identifier may appear in analytics.
  assert.equal(/PG-R\d+/.test(text), false);
}

const RESEARCH_PATHS = [
  "/api/research/analytics",
  "/api/research/export.csv"
];

test("unauthenticated research requests are rejected", async () => {
  for (const path of RESEARCH_PATHS) {
    const response = await get(path);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Authentication required"
    });
  }
});

test("an invalid token is rejected before any research data is used", async () => {
  for (const path of RESEARCH_PATHS) {
    const response = await get(path, {
      Authorization: "Bearer not-a-valid-token"
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Invalid or expired token"
    });
  }
});

test("user and staff roles cannot reach either research endpoint", async () => {
  for (const path of RESEARCH_PATHS) {
    for (const [id, role] of [
      [USER_ID, "user"],
      [STAFF_ID, "staff"]
    ]) {
      const response = await get(path, authHeaders(id, role));

      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        success: false,
        error:
          "You do not have permission to access this resource"
      });
    }
  }
});

test("an admin can read the aggregate analytics response", async () => {
  const response = await get(
    "/api/research/analytics",
    authHeaders(ADMIN_ID, "admin")
  );

  const body = await response.text();
  const data = JSON.parse(body);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.equal(data.success, true);

  assert.equal(
    data.cohort.totalEligibleParticipants,
    participants.length
  );
  assert.equal(data.cohort.participantsWithAwareness, 2);
  assert.equal(data.cohort.participantsWithPhishingIdentification, 2);
  assert.equal(data.cohort.participantsWithTrainingExposure, 2);
  assert.equal(data.cohort.participantsWithFullTrainingExposure, 1);
  assert.equal(data.cohort.participantsWithAllVariables, 2);

  assert.equal(data.awareness.n, 2);
  assert.equal(data.awareness.mean, 60);
  assert.equal(data.phishingIdentification.n, 2);
  assert.equal(data.phishingIdentification.mean, 60);

  assert.deepEqual(data.trainingExposureDistribution, [
    { trainingExposure: 0, count: 1 },
    { trainingExposure: 33.33, count: 1 },
    { trainingExposure: 66.67, count: 0 },
    { trainingExposure: 100, count: 1 }
  ]);

  assert.equal(
    data.relationships.awarenessPhishingIdentification.n,
    2
  );
  assert.equal(typeof data.methodology, "object");

  // The participant dataset must never be part of the analytics response.
  assert.equal(
    Object.prototype.hasOwnProperty.call(data, "participants"),
    false
  );
  assertNoIdentityLeak(body);
});

test("an admin can download the de-identified CSV export", async () => {
  const response = await get(
    "/api/research/export.csv",
    authHeaders(ADMIN_ID, "admin")
  );

  const body = await response.text();
  const lines = body.split("\r\n").filter((line) => line.length > 0);

  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.equal(
    response.headers.get("content-type"),
    RESEARCH_CSV_CONTENT_TYPE
  );
  assert.equal(
    response.headers.get("content-type"),
    "text/csv; charset=utf-8"
  );
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="${RESEARCH_CSV_FILENAME}"`
  );
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="phishguard-research-data.csv"'
  );

  assert.deepEqual(
    lines[0].split(","),
    RESEARCH_CSV_COLUMNS
  );
  assert.deepEqual(lines[0].split(","), [
    "participantId",
    "awarenessScore",
    "awarenessCompletedAt",
    "phishingIdentificationScore",
    "phishingIdentificationCompletedAt",
    "completedTrainingModules",
    "trainingExposure"
  ]);
  assert.equal(lines.length, 4);

  assert.deepEqual(lines[1].split(","), [
    "PG-R0001",
    "80",
    "2026-03-01T10:00:00.000Z",
    "70",
    "2026-03-02T11:30:00.000Z",
    "3",
    "100"
  ]);

  // Missing assessments are empty fields, never "null" or a fabricated zero.
  assert.deepEqual(lines[2].split(","), [
    "PG-R0002",
    "",
    "",
    "",
    "",
    "0",
    "0"
  ]);

  assert.deepEqual(lines[3].split(","), [
    "PG-R0003",
    "40",
    "2026-03-03T00:00:00.000Z",
    "50",
    "2026-03-03T01:00:00.000Z",
    "1",
    "33.33"
  ]);

  assert.equal(body.includes("null"), false);
  assert.equal(body.includes("undefined"), false);
  assert.equal(body.includes("NaN"), false);

  for (const forbidden of [
    FORBIDDEN_EMAIL,
    FORBIDDEN_NAME,
    "password",
    "passwordReset",
    "role",
    "http://",
    "https://",
    "analysis",
    "report",
    String(ADMIN_ID),
    String(USER_ID)
  ]) {
    assert.equal(
      body.includes(forbidden),
      false,
      `CSV must not contain ${forbidden}`
    );
  }

  assert.equal(body.includes("="), false);
  assert.equal(body.includes("'"), false);
});

test("service failures are handled by the existing error handling", async () => {
  analyticsState.serviceError = new Error(
    "MongoDB connection failure with internal detail"
  );

  const analyticsResponse = await get(
    "/api/research/analytics",
    authHeaders(ADMIN_ID, "admin")
  );

  const analyticsBody = await analyticsResponse.text();

  assert.equal(analyticsResponse.status, 500);
  assert.deepEqual(JSON.parse(analyticsBody), {
    success: false,
    error: "Internal server error"
  });
  assert.equal(
    analyticsBody.includes("internal detail"),
    false
  );
  assert.equal(
    analyticsBody.includes("MongoDB"),
    false
  );

  analyticsState.datasetError = new Error(
    "training completions query failed with internal detail"
  );

  const csvResponse = await get(
    "/api/research/export.csv",
    authHeaders(ADMIN_ID, "admin")
  );

  const csvBody = await csvResponse.text();

  assert.equal(csvResponse.status, 500);
  assert.deepEqual(JSON.parse(csvBody), {
    success: false,
    error: "Internal server error"
  });
  assert.equal(
    csvBody.includes("internal detail"),
    false
  );
  assert.equal(
    csvResponse.headers.get("content-disposition"),
    null
  );
});

test("the research router mounts authentication and admin authorization first", () => {
  const { authenticate } = require("../src/middleware/auth.middleware");
  const { authorizeRoles } = require("../src/middleware/role.middleware");

  const router = createResearchRouter(createResearchController());
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map((entry) => entry.handle)
    }));

  assert.deepEqual(
    routes.map((route) => `${route.methods.join(",")} ${route.path}`),
    ["get /analytics", "get /export.csv"]
  );

  const sharedLayers = router.stack
    .filter((layer) => !layer.route)
    .map((layer) => layer.handle);

  assert.equal(sharedLayers[0], authenticate);
  assert.equal(typeof authorizeRoles, "function");
  assert.equal(typeof sharedLayers[1], "function");

  // The mounted authorization layer is the admin-only gate.
  function runLayer(layer, user) {
    let nextCalled = false;
    let response = null;

    layer(
      { user },
      {
        status(code) {
          return {
            json(data) {
              response = { status: code, data };
            }
          };
        }
      },
      () => {
        nextCalled = true;
      }
    );

    return { nextCalled, response };
  }

  assert.equal(runLayer(sharedLayers[1], { role: "admin" }).nextCalled, true);
  assert.equal(runLayer(sharedLayers[1], { role: "user" }).response.status, 403);
  assert.equal(runLayer(sharedLayers[1], { role: "staff" }).response.status, 403);
  assert.equal(runLayer(sharedLayers[1], null).response.status, 401);

  // The shared authorization layer runs before any route handler.
  for (const route of routes) {
    assert.equal(route.handlers.length, 1);
  }
});

test("CSV serialization escapes fields and keeps zero values", () => {
  assert.equal(formatCsvValue(null), "");
  assert.equal(formatCsvValue(undefined), "");
  assert.equal(formatCsvValue(0), "0");
  assert.equal(formatCsvValue(33.33), "33.33");
  assert.equal(
    formatCsvValue(new Date("2026-03-01T10:00:00.000Z")),
    "2026-03-01T10:00:00.000Z"
  );
  assert.equal(formatCsvValue(new Date("invalid")), "");
  assert.equal(formatCsvValue(NaN), "");
  assert.equal(formatCsvValue("plain"), "plain");

  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField("line\nbreak"), '"line\nbreak"');
  assert.equal(escapeCsvField("=cmd|calc"), "'=cmd|calc");
  assert.equal(escapeCsvField("+1"), "'+1");
  assert.equal(escapeCsvField("-1"), "'-1");
  assert.equal(escapeCsvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCsvField(null), "");
});

test("CSV serialization escapes participant values safely", () => {
  const csv = serializeResearchParticipantCsv([
    {
      participantId: "PG-R0001",
      awarenessScore: 100,
      awarenessCompletedAt: new Date("2026-03-01T10:00:00.000Z"),
      phishingIdentificationScore: 90,
      phishingIdentificationCompletedAt: new Date(
        "2026-03-01T10:00:00.000Z"
      ),
      completedTrainingModules: 3,
      trainingExposure: 100,
      ignoredExtraField: "must not appear"
    }
  ]);

  const [header, row] = csv
    .split("\r\n")
    .filter((line) => line.length > 0);

  assert.equal(header, RESEARCH_CSV_COLUMNS.join(","));
  assert.equal(row.split(",").length, RESEARCH_CSV_COLUMNS.length);
  assert.equal(csv.includes("ignoredExtraField"), false);
  assert.equal(csv.includes("must not appear"), false);
  assert.equal(csv.endsWith("\r\n"), true);
});

test("an empty dataset produces a header-only CSV", () => {
  const csv = serializeResearchParticipantCsv([]);

  assert.equal(
    csv,
    `${RESEARCH_CSV_COLUMNS.join(",")}\r\n`
  );
});
