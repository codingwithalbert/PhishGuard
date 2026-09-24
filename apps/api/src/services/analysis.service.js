const Analysis = require("../models/Analysis");
const {
  SUSPICIOUS_KEYWORDS,
  createFinding,
  reconstructFindings
} = require("./analysis.findings");

const DASHBOARD_RECENT_ANALYSIS_LIMIT = 5;

function analyzeUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      error: "Invalid URL"
    };
  }

  const indicators = [];
  const findings = [];
  let score = 0;

  function recordIndicator(indicator, type, scoreContribution) {
    indicators.push(indicator);

    const finding = createFinding(type, scoreContribution);

    if (finding) {
      findings.push(finding);
    }
  }

  // Suspicious keywords
  const suspiciousKeywords = SUSPICIOUS_KEYWORDS;

  const urlLower = url.toLowerCase();

  const matchedKeywords = suspiciousKeywords.filter((keyword) =>
    urlLower.includes(keyword)
  );

  if (matchedKeywords.length > 0) {
    recordIndicator(
      `Contains suspicious keyword(s): ${matchedKeywords.join(", ")}`,
      "suspicious_keyword",
      Math.min(matchedKeywords.length * 5, 15)
    );
    score += Math.min(matchedKeywords.length * 5, 15);
  }

  // Excessive subdomains
  const hostnameParts = parsedUrl.hostname.split(".");

  if (hostnameParts.length >= 5) {
    recordIndicator(
      "URL contains an unusually large number of subdomains",
      "excessive_subdomains",
      15
    );
    score += 15;
  }

  // Punycode domain detection
  if (parsedUrl.hostname.includes("xn--")) {
    recordIndicator(
      "Hostname contains a punycode domain",
      "punycode",
      15
    );
    score += 15;
  }

  // Suspicious port detection
  if (parsedUrl.port && !["80", "443"].includes(parsedUrl.port)) {
    recordIndicator(
      `URL uses a non-standard port: ${parsedUrl.port}`,
      "non_standard_port",
      15
    );
    score += 15;
  }

  // URL encoding detection
  if (/%[0-9a-fA-F]{2}/.test(url)) {
    recordIndicator(
      "URL contains percent-encoded characters",
      "percent_encoding",
      10
    );
    score += 10;
  }

  // Long hostname detection
  if (parsedUrl.hostname.length > 50) {
    recordIndicator(
      "Hostname is unusually long",
      "long_hostname",
      10
    );
    score += 10;
  }

  // HTTPS check
  if (parsedUrl.protocol !== "https:") {
    recordIndicator(
      "Connection does not use HTTPS",
      "no_https",
      20
    );
    score += 20;
  }

  // IP address instead of domain name
  const hostname = parsedUrl.hostname;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    recordIndicator(
      "URL uses an IP address instead of a domain name",
      "ip_address",
      25
    );
    score += 25;
  }

  // Suspicious URL length
  if (url.length > 100) {
    recordIndicator(
      "URL is unusually long",
      "long_url",
      10
    );
    score += 10;
  }

  // Suspicious characters
  if (url.includes("@")) {
    recordIndicator(
      "URL contains an @ character",
      "at_character",
      20
    );
    score += 20;
  }

  // Determine risk level
  let risk = "low";

  if (score >= 50) {
    risk = "high";
  } else if (score >= 25) {
    risk = "medium";
  }

  return {
    success: true,
    url,
    risk,
    score,
    indicators,
    findings
  };
}

function toFullAnalysisRepresentation(analysis) {
  // Findings are derived for responses so explanation text is not persisted.
  const representation =
    analysis && typeof analysis.toObject === "function"
      ? analysis.toObject()
      : analysis && typeof analysis.toJSON === "function"
        ? analysis.toJSON()
        : { ...analysis };

  return {
    ...representation,
    findings: reconstructFindings(representation.indicators)
  };
}

function getOwnedAnalysisFilter(userId) {
  return { user: userId };
}

async function getAnalysesForUser(userId) {
  return Analysis.find(getOwnedAnalysisFilter(userId)).sort({
    createdAt: -1
  });
}

async function countAnalysesForUser(userId) {
  return Analysis.countDocuments(getOwnedAnalysisFilter(userId));
}

function toRecentAnalysisResult(analysis) {
  return {
    id: analysis._id,
    url: analysis.url,
    risk: analysis.risk,
    score: analysis.score,
    status: analysis.status,
    createdAt: analysis.createdAt
  };
}

async function getRecentAnalysesForUser(userId) {
  const analyses = await Analysis.find(getOwnedAnalysisFilter(userId))
    .select({
      _id: 1,
      url: 1,
      risk: 1,
      score: 1,
      status: 1,
      createdAt: 1
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(DASHBOARD_RECENT_ANALYSIS_LIMIT)
    .lean();

  return analyses.map(toRecentAnalysisResult);
}

module.exports = {
  analyzeUrl,
  countAnalysesForUser,
  getAnalysesForUser,
  getRecentAnalysesForUser,
  toFullAnalysisRepresentation
};
