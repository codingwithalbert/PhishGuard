const test = require("node:test");
const assert = require("node:assert/strict");

const Analysis = require("../src/models/Analysis");

// Analysis collection index declaration.
//
// WHY THIS EXISTS: `Analysis` was the only one of the eight collections that
// declared no index at all, while its three read paths all filter on `user`:
// the owner history, the owner count, and the dashboard recents. Every one of
// them therefore performed a collection scan, with an in-memory sort on top for
// the two that order by `createdAt`.
//
// SCOPE OF THIS TEST, STATED PRECISELY:
//
// An offline schema test proves that the index is DECLARED on the schema with
// the exact fields, directions, and name. It proves nothing about MongoDB. It
// does not demonstrate that:
//
//   - the index exists in any running database;
//   - it was actually built;
//   - a query planner chose it;
//   - any query got faster.
//
// Those are runtime facts, verifiable only against a real database, which this
// project has never done. Do not cite this test as evidence of any of them.
//
// The `autoIndex` setting is deliberately NOT inspected or asserted here.
// `config/db.js` leaves it at the Mongoose default, and changing that setting is
// outside the approved scope of this task.

const INDEX_NAME = "analysis_owner_history";

function findNamedIndex(schema, name) {
  return schema.indexes().find(([, options]) => options?.name === name);
}

test("Analysis declares the owner-history compound index", () => {
  const indexes = Analysis.schema.indexes();

  const ownerHistoryIndex = indexes.find(
    ([fields]) =>
      fields.user === 1 &&
      fields.createdAt === -1 &&
      fields._id === -1
  );

  assert.ok(
    ownerHistoryIndex,
    "Analysis must declare { user: 1, createdAt: -1, _id: -1 }; the collection "
      + "otherwise has no index at all and every owner read is a collection scan"
  );
});

test("the owner-history index carries the exact approved name", () => {
  const index = findNamedIndex(Analysis.schema, INDEX_NAME);

  assert.ok(index, `an index named "${INDEX_NAME}" must be declared`);
});

test("the owner-history index has exactly the approved fields, in order", () => {
  const index = findNamedIndex(Analysis.schema, INDEX_NAME);

  const [fields, options] = index;

  // Field order matters for an index: it determines which prefix can serve a
  // given query. Asserting the order prevents an accidental reordering that
  // would still "look" correct to a field-presence check.
  assert.deepEqual(Object.keys(fields), ["user", "createdAt", "_id"]);
  assert.equal(fields.user, 1);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);

  // The index must not be unique. Multiple analyses per user are legitimate.
  assert.notEqual(options.unique, true);
});

test("the owner-history index serves the owner history query shape", () => {
  // Mirrors `getAnalysesForUser` in analysis.service.js:
  //   Analysis.find({ user: userId }).sort({ createdAt: -1 })
  //
  // The index prefix is `user`, which is the equality filter, and the remaining
  // fields cover the descending `createdAt` ordering.
  const [fields] = findNamedIndex(Analysis.schema, INDEX_NAME);

  assert.equal(fields.user, 1, "the equality filter on user must be the prefix");
  assert.equal(fields.createdAt, -1, "the sort direction must match");
});

test("the owner-history index serves the dashboard recents query shape", () => {
  // Mirrors `getRecentAnalysesForUser` in analysis.service.js:
  //   Analysis.find({ user: userId })
  //     .select({...})
  //     .sort({ createdAt: -1, _id: -1 })
  //     .limit(DASHBOARD_RECENT_ANALYSIS_LIMIT)
  //
  // The trailing `_id: -1` is what makes this single index cover the dashboard
  // read as well, rather than needing a second index for the tie-breaker.
  const [fields] = findNamedIndex(Analysis.schema, INDEX_NAME);

  assert.equal(fields.user, 1);
  assert.equal(fields.createdAt, -1);
  assert.equal(fields._id, -1);
});

test("the owner-history index serves the owner count query shape", () => {
  // Mirrors `countAnalysesForUser`:
  //   Analysis.countDocuments({ user: userId })
  //
  // A count filters on `user` alone, so the index prefix alone covers it.
  const [fields] = findNamedIndex(Analysis.schema, INDEX_NAME);

  assert.equal(fields.user, 1);
});

test("Analysis declares the owner-history index and nothing else", () => {
  // Guards against an unrelated index being added alongside this one in the
  // same change. Any future addition must be a deliberate, separately reviewed
  // decision, so this assertion is expected to be updated when that happens.
  const indexes = Analysis.schema.indexes();

  assert.equal(
    indexes.length,
    1,
    `Analysis is expected to declare exactly one index, found: ${JSON.stringify(
      indexes.map(([fields, options]) => ({
        fields: Object.keys(fields),
        name: options?.name
      }))
    )}`
  );
});

test("adding the index changes no document behaviour", () => {
  // An index is a query-planning structure. It must not alter validation,
  // defaults, trimming, or any stored value, so a document that validated
  // before must validate identically now.
  const document = new Analysis({
    user: new (require("mongoose").Types.ObjectId)(),
    url: "https://example.test/login",
    risk: "medium",
    score: 30,
    indicators: ["Contains suspicious keyword(s): login"]
  });

  assert.equal(document.validateSync(), undefined);
  assert.equal(document.url, "https://example.test/login");
  assert.equal(document.status, "active");
  assert.deepEqual(document.indicators, [
    "Contains suspicious keyword(s): login"
  ]);
});

test("Analysis still targets the expected collection", () => {
  assert.equal(Analysis.collection.collectionName, "analyses");
});