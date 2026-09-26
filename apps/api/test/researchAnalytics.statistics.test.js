const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeDescriptiveStatistics,
  computeMedian,
  computePearsonCorrelation,
  isFiniteNumber,
  roundTo
} = require("../src/services/researchAnalytics.statistics");

test("descriptive statistics report n, mean, minimum, and maximum", () => {
  const statistics = computeDescriptiveStatistics([40, 60, 80]);

  assert.deepEqual(statistics, {
    n: 3,
    mean: 60,
    median: 60,
    min: 40,
    max: 80
  });
});

test("mean is rounded to two decimal places", () => {
  const statistics = computeDescriptiveStatistics([10, 20, 31]);

  assert.equal(statistics.n, 3);
  assert.equal(statistics.mean, 20.33);
  assert.equal(statistics.min, 10);
  assert.equal(statistics.max, 31);
});

test("median is correct for odd and even sample sizes", () => {
  assert.equal(
    computeDescriptiveStatistics([10, 20, 90]).median,
    20
  );
  assert.equal(
    computeDescriptiveStatistics([10, 20, 30, 90]).median,
    25
  );
  assert.equal(
    computeDescriptiveStatistics([5]).median,
    5
  );
  assert.equal(
    computeDescriptiveStatistics([1, 2, 3, 4, 5, 6]).median,
    3.5
  );
  assert.equal(
    computeDescriptiveStatistics([1.111, 2.222, 3.333]).median,
    2.22
  );
  assert.equal(
    computeDescriptiveStatistics([1.111, 2.222, 3.333, 4.444])
      .median,
    2.78
  );
});

test("computeMedian is pure over a sorted sample", () => {
  assert.equal(computeMedian([1, 2, 3]), 2);
  assert.equal(computeMedian([1, 2, 3, 4]), 2.5);
});

test("an empty sample returns n 0 and null statistics", () => {
  for (const emptyInput of [
    [],
    null,
    undefined,
    "not-a-sample"
  ]) {
    assert.deepEqual(
      computeDescriptiveStatistics(emptyInput),
      {
        n: 0,
        mean: null,
        median: null,
        min: null,
        max: null
      }
    );
  }
});

test("missing and non-finite values are excluded from the sample", () => {
  const statistics = computeDescriptiveStatistics([
    50,
    null,
    undefined,
    70,
    NaN,
    Infinity,
    -Infinity,
    "80",
    90
  ]);

  assert.equal(statistics.n, 3);
  assert.equal(statistics.mean, 70);
  assert.equal(statistics.median, 70);
  assert.equal(statistics.min, 50);
  assert.equal(statistics.max, 90);
});

test("descriptive statistics never produce NaN or Infinity", () => {
  for (const statistics of [
    computeDescriptiveStatistics([]),
    computeDescriptiveStatistics([NaN]),
    computeDescriptiveStatistics([Infinity, -Infinity]),
    computeDescriptiveStatistics([0])
  ]) {
    for (const [field, value] of Object.entries(statistics)) {
      if (typeof value === "number") {
        assert.equal(
          Number.isFinite(value),
          true,
          `${field} must be finite`
        );
      }
    }
  }
});

test("zero is a legitimate observation, not missing data", () => {
  const statistics = computeDescriptiveStatistics([0, 0, 0]);

  assert.equal(statistics.n, 3);
  assert.equal(statistics.mean, 0);
  assert.equal(statistics.median, 0);
  assert.equal(statistics.min, 0);
  assert.equal(statistics.max, 0);
});

test("Pearson correlation matches known examples", () => {
  assert.deepEqual(
    computePearsonCorrelation([
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10]
    ]),
    { n: 5, r: 1 }
  );

  assert.deepEqual(
    computePearsonCorrelation([
      [1, 10],
      [2, 8],
      [3, 6],
      [4, 4],
      [5, 2]
    ]),
    { n: 5, r: -1 }
  );

  // Textbook example: r = 6 / sqrt(60) = 0.7745966692...
  assert.deepEqual(
    computePearsonCorrelation([
      [1, 2],
      [2, 4],
      [3, 5],
      [4, 4],
      [5, 5]
    ]),
    { n: 5, r: 0.775 }
  );

  // Textbook uncorrelated sample: r = -2 / 5 = -0.4.
  assert.deepEqual(
    computePearsonCorrelation([
      [1, 4],
      [2, 1],
      [3, 3],
      [4, 2]
    ]),
    { n: 4, r: -0.4 }
  );

  // Training Exposure levels against an awareness score.
  assert.deepEqual(
    computePearsonCorrelation([
      [0, 40],
      [33.33, 50],
      [66.67, 60],
      [100, 70]
    ]),
    { n: 4, r: 1 }
  );
});

test("Pearson correlation uses pairwise complete observations only", () => {
  const correlation = computePearsonCorrelation([
    [1, 2],
    [3, null],
    [null, 5],
    [4, 4],
    [null, null],
    [5, undefined]
  ]);

  assert.equal(correlation.n, 2);
  assert.equal(correlation.r, 1);
});

test("Pearson correlation is null for fewer than two pairs", () => {
  assert.deepEqual(computePearsonCorrelation([]), { n: 0, r: null });
  assert.deepEqual(computePearsonCorrelation([[1, 2]]), {
    n: 1,
    r: null
  });
  assert.deepEqual(computePearsonCorrelation([[1, 2], [3, null]]), {
    n: 1,
    r: null
  });
});

test("Pearson correlation is null for zero variance", () => {
  assert.deepEqual(
    computePearsonCorrelation([
      [1, 1],
      [1, 2],
      [1, 3]
    ]),
    { n: 3, r: null }
  );

  assert.deepEqual(
    computePearsonCorrelation([
      [1, 5],
      [2, 5],
      [3, 5]
    ]),
    { n: 3, r: null }
  );

  assert.deepEqual(
    computePearsonCorrelation([
      [7, 7],
      [7, 7]
    ]),
    { n: 2, r: null }
  );
});

test("Pearson correlation never returns NaN or Infinity", () => {
  const samples = [
    [],
    [[1, 2]],
    [[1, 1], [2, 1]],
    [[0, 0], [0, 0], [0, 0]],
    [
      [1, 2],
      [2, 4],
      [3, 6]
    ],
    [[1, 1e308], [2, -1e308]],
    [[1, 1], [1, 2], null, [2, 2]]
  ];

  for (const sample of samples) {
    const { n, r } = computePearsonCorrelation(sample);

    assert.equal(Number.isInteger(n) && n >= 0, true);

    if (r !== null) {
      assert.equal(Number.isFinite(r), true);
      assert.equal(r >= -1 && r <= 1, true);
    }
  }
});

test("rounding is symmetric and never negative zero", () => {
  assert.equal(roundTo(0.125, 2), 0.13);
  assert.equal(roundTo(-0.125, 2), -0.13);
  assert.equal(roundTo(20.333333, 2), 20.33);
  assert.equal(Object.is(roundTo(-0.001, 2), 0), true);
  assert.equal(Object.is(roundTo(-0.0001, 3), 0), true);
  assert.equal(roundTo(0.12345, 3), 0.123);
  assert.equal(roundTo(33.33, 2), 33.33);
  assert.equal(roundTo(100, 2), 100);
});

test("isFiniteNumber rejects non-numeric input", () => {
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isFiniteNumber(-1.5), true);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber(null), false);
  assert.equal(isFiniteNumber("50"), false);
});
