const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  analyzeUrl,
  toFullAnalysisRepresentation
} = require("../src/services/analysis.service");
const {
  reconstructFindings
} = require("../src/services/analysis.findings");
const Analysis = require("../src/models/Analysis");

function sumContributions(findings) {
  return findings.reduce(
    (total, finding) => total + finding.scoreContribution,
    0
  );
}

function assertFindingShape(finding, expectedType, expectedContribution) {
  assert.deepEqual(Object.keys(finding).sort(), [
    "explanation",
    "scoreContribution",
    "title",
    "type"
  ]);
  assert.equal(finding.type, expectedType);
  assert.equal(typeof finding.title, "string");
  assert.ok(finding.title.length > 0);
  assert.equal(typeof finding.explanation, "string");
  assert.ok(finding.explanation.length > 0);
  assert.equal(finding.scoreContribution, expectedContribution);
}

test("new analyses always return an array of findings", () => {
  const result = analyzeUrl("https://example.com");

  assert.equal(Array.isArray(result.findings), true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.score, 0);
  assert.equal(sumContributions(result.findings), result.score);
});

test("each existing heuristic produces its stable structured finding", () => {
  const cases = [
    {
      url: "https://example.com/login",
      type: "suspicious_keyword",
      scoreContribution: 5,
      indicator: "Contains suspicious keyword(s): login"
    },
    {
      url: "https://a.b.c.d.example.com",
      type: "excessive_subdomains",
      scoreContribution: 15,
      indicator: "URL contains an unusually large number of subdomains"
    },
    {
      url: "https://xn--example-9za.com",
      type: "punycode",
      scoreContribution: 15,
      indicator: "Hostname contains a punycode domain"
    },
    {
      url: "https://example.com:8080",
      type: "non_standard_port",
      scoreContribution: 15,
      indicator: "URL uses a non-standard port: 8080"
    },
    {
      url: "https://example.com/a%2Fb",
      type: "percent_encoding",
      scoreContribution: 10,
      indicator: "URL contains percent-encoded characters"
    },
    {
      url: `https://${"a".repeat(51)}.com`,
      type: "long_hostname",
      scoreContribution: 10,
      indicator: "Hostname is unusually long"
    },
    {
      url: "http://example.com",
      type: "no_https",
      scoreContribution: 20,
      indicator: "Connection does not use HTTPS"
    },
    {
      url: "https://192.168.1.10",
      type: "ip_address",
      scoreContribution: 25,
      indicator: "URL uses an IP address instead of a domain name"
    },
    {
      url: `https://example.com/${"a".repeat(101)}`,
      type: "long_url",
      scoreContribution: 10,
      indicator: "URL is unusually long"
    },
    {
      url: "https://example.com@evil.example",
      type: "at_character",
      scoreContribution: 20,
      indicator: "URL contains an @ character"
    }
  ];

  for (const testCase of cases) {
    const result = analyzeUrl(testCase.url);

    assert.equal(result.score, testCase.scoreContribution);
    assert.deepEqual(result.indicators, [testCase.indicator]);
    assert.equal(result.findings.length, 1);
    assertFindingShape(
      result.findings[0],
      testCase.type,
      testCase.scoreContribution
    );
    assert.equal(sumContributions(result.findings), result.score);
  }
});

test("new analysis finding contributions sum to the total score", () => {
  const result = analyzeUrl(
    "http://login.verify.account.security.example.com:8080/login%2Fverify"
  );

  assert.equal(result.score, 75);
  assert.equal(result.risk, "high");
  assert.equal(sumContributions(result.findings), result.score);
  assert.equal(result.findings.length, result.indicators.length);
});

test("suspicious keyword scoring retains its 15-point cap", () => {
  const result = analyzeUrl(
    "https://example.com/login/verify/verification/secure/account/update/password/signin/confirm"
  );

  assert.equal(result.score, 15);
  assert.equal(result.findings.length, 1);
  assertFindingShape(result.findings[0], "suspicious_keyword", 15);
  assert.equal(
    result.indicators[0],
    "Contains suspicious keyword(s): login, verify, verification, secure, account, update, password, signin, confirm"
  );
});

test("existing risk thresholds remain unchanged", () => {
  const lowRisk = analyzeUrl("http://example.com");
  const mediumRisk = analyzeUrl("https://192.168.1.10");
  const highRisk = analyzeUrl("http://192.168.1.1/login");

  assert.deepEqual(
    [lowRisk.score, lowRisk.risk],
    [20, "low"]
  );
  assert.deepEqual(
    [mediumRisk.score, mediumRisk.risk],
    [25, "medium"]
  );
  assert.deepEqual(
    [highRisk.score, highRisk.risk],
    [50, "high"]
  );
});

test("dynamic suspicious-keyword indicators reconstruct with their contribution", () => {
  const findings = reconstructFindings([
    "Contains suspicious keyword(s): login, verify"
  ]);

  assert.equal(findings.length, 1);
  assertFindingShape(findings[0], "suspicious_keyword", 10);

  const cappedFindings = reconstructFindings([
    "Contains suspicious keyword(s): login, verify, verification, secure, account, update, password, signin, confirm"
  ]);

  assertFindingShape(cappedFindings[0], "suspicious_keyword", 15);
});

test("dynamic non-standard-port indicators reconstruct with their contribution", () => {
  const findings = reconstructFindings([
    "URL uses a non-standard port: 8080"
  ]);

  assert.equal(findings.length, 1);
  assertFindingShape(findings[0], "non_standard_port", 15);
});

test("recognized historical indicators reconstruct without changing indicators", () => {
  const indicators = [
    "Contains suspicious keyword(s): login",
    "URL contains an unusually large number of subdomains",
    "Hostname contains a punycode domain",
    "URL uses a non-standard port: 8443",
    "URL contains percent-encoded characters",
    "Hostname is unusually long",
    "Connection does not use HTTPS",
    "URL uses an IP address instead of a domain name",
    "URL is unusually long",
    "URL contains an @ character"
  ];
  const findings = reconstructFindings(indicators);

  assert.deepEqual(
    findings.map((finding) => finding.type),
    [
      "suspicious_keyword",
      "excessive_subdomains",
      "punycode",
      "non_standard_port",
      "percent_encoding",
      "long_hostname",
      "no_https",
      "ip_address",
      "long_url",
      "at_character"
    ]
  );
  assert.equal(sumContributions(findings), 145);
});

test("unknown and malformed legacy indicators do not fabricate findings", () => {
  const findings = reconstructFindings([
    "Contains suspicious keyword(s): login, unknown",
    "Contains suspicious keyword(s): verification, login",
    "Contains suspicious keyword(s): login, ",
    "Contains suspicious keyword(s):login",
    "URL uses a non-standard port: 443",
    "URL uses a non-standard port: 65536",
    "URL uses a non-standard port: 08080",
    "An unknown legacy indicator",
    null,
    { type: "ip_address" }
  ]);

  assert.deepEqual(findings, []);
});

test("full analysis representation derives findings without persisting them", () => {
  const indicators = [
    "URL uses an IP address instead of a domain name",
    "Legacy indicator without a safe explanation"
  ];
  const document = new Analysis({
    user: new mongoose.Types.ObjectId(),
    url: "https://192.168.1.10",
    risk: "medium",
    score: 25,
    indicators
  });
  const representation = toFullAnalysisRepresentation(document);

  assert.equal(Object.hasOwn(document.toObject(), "findings"), false);
  assert.deepEqual(representation.indicators, indicators);
  assert.equal(representation.findings.length, 1);
  assertFindingShape(representation.findings[0], "ip_address", 25);
  assert.equal(
    Object.hasOwn(representation.findings[0], "user"),
    false
  );
  assert.equal(
    JSON.stringify(representation.findings).includes("user"),
    false
  );
});

test("full analysis representation handles missing or invalid indicators safely", () => {
  assert.deepEqual(toFullAnalysisRepresentation({}).findings, []);
  assert.deepEqual(
    toFullAnalysisRepresentation({ indicators: "not-an-array" }).findings,
    []
  );
});
