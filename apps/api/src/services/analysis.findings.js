const SUSPICIOUS_KEYWORDS = Object.freeze([
  "login",
  "verify",
  "verification",
  "secure",
  "account",
  "update",
  "password",
  "signin",
  "confirm"
]);

const FINDING_DEFINITIONS = Object.freeze({
  suspicious_keyword: Object.freeze({
    title: "Suspicious keyword(s)",
    explanation:
      "Words related to login, verification, or account activity can appear in deceptive URLs, but they can also occur on legitimate websites."
  }),
  excessive_subdomains: Object.freeze({
    title: "Unusually many subdomains",
    explanation:
      "A long chain of subdomains can make the destination harder to recognize, although some legitimate services use layered domains."
  }),
  punycode: Object.freeze({
    title: "Punycode hostname",
    explanation:
      "Punycode supports legitimate internationalized domain names, but it can also make visually deceptive domain names possible."
  }),
  non_standard_port: Object.freeze({
    title: "Non-standard port",
    explanation:
      "A URL using a port other than the usual HTTP or HTTPS ports may identify a less familiar service; legitimate services can also use custom ports."
  }),
  percent_encoding: Object.freeze({
    title: "Percent-encoded characters",
    explanation:
      "Encoded characters can make a URL harder to visually interpret, but they can also have legitimate uses."
  }),
  long_hostname: Object.freeze({
    title: "Unusually long hostname",
    explanation:
      "An unusually long hostname can make the destination harder to read, but hostname length alone is not proof of misuse."
  }),
  no_https: Object.freeze({
    title: "Connection does not use HTTPS",
    explanation:
      "This URL does not use an HTTPS connection. HTTPS helps protect data in transit, but its presence alone does not prove that a website is trustworthy."
  }),
  ip_address: Object.freeze({
    title: "IP address used instead of a domain name",
    explanation:
      "Using an IP address can make the destination harder to recognize, although legitimate services can use IP addresses directly."
  }),
  long_url: Object.freeze({
    title: "Unusually long URL",
    explanation:
      "A very long URL can make important destination details harder to spot, but length alone is not proof of misuse."
  }),
  at_character: Object.freeze({
    title: "@ character in the URL",
    explanation:
      "An @ character can make the destination harder to interpret, but it can also have legitimate uses."
  })
});

const STATIC_INDICATOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    indicator:
      "URL contains an unusually large number of subdomains",
    type: "excessive_subdomains",
    scoreContribution: 15
  }),
  Object.freeze({
    indicator: "Hostname contains a punycode domain",
    type: "punycode",
    scoreContribution: 15
  }),
  Object.freeze({
    indicator: "URL contains percent-encoded characters",
    type: "percent_encoding",
    scoreContribution: 10
  }),
  Object.freeze({
    indicator: "Hostname is unusually long",
    type: "long_hostname",
    scoreContribution: 10
  }),
  Object.freeze({
    indicator: "Connection does not use HTTPS",
    type: "no_https",
    scoreContribution: 20
  }),
  Object.freeze({
    indicator: "URL uses an IP address instead of a domain name",
    type: "ip_address",
    scoreContribution: 25
  }),
  Object.freeze({
    indicator: "URL is unusually long",
    type: "long_url",
    scoreContribution: 10
  }),
  Object.freeze({
    indicator: "URL contains an @ character",
    type: "at_character",
    scoreContribution: 20
  })
]);

const STATIC_DEFINITION_BY_INDICATOR = new Map(
  STATIC_INDICATOR_DEFINITIONS.map((definition) => [
    definition.indicator,
    definition
  ])
);

const SUSPICIOUS_KEYWORD_INDICATOR_PREFIX =
  "Contains suspicious keyword(s): ";
const NON_STANDARD_PORT_INDICATOR_PATTERN =
  /^URL uses a non-standard port: (0|[1-9]\d{0,4})$/;

function createFinding(type, scoreContribution) {
  const definition = FINDING_DEFINITIONS[type];

  if (
    !Object.hasOwn(FINDING_DEFINITIONS, type) ||
    !definition ||
    !Number.isInteger(scoreContribution) ||
    scoreContribution < 0
  ) {
    return null;
  }

  return {
    type,
    title: definition.title,
    explanation: definition.explanation,
    scoreContribution
  };
}

function parseSuspiciousKeywordIndicator(indicator) {
  if (
    typeof indicator !== "string" ||
    !indicator.startsWith(SUSPICIOUS_KEYWORD_INDICATOR_PREFIX)
  ) {
    return null;
  }

  const keywordText = indicator.slice(
    SUSPICIOUS_KEYWORD_INDICATOR_PREFIX.length
  );

  if (!keywordText || keywordText.trim() !== keywordText) {
    return null;
  }

  const keywords = keywordText.split(", ");
  let previousKeywordIndex = -1;

  for (const keyword of keywords) {
    const keywordIndex = SUSPICIOUS_KEYWORDS.indexOf(keyword);

    if (keywordIndex <= previousKeywordIndex) {
      return null;
    }

    previousKeywordIndex = keywordIndex;
  }

  return Math.min(keywords.length * 5, 15);
}

function parseNonStandardPortIndicator(indicator) {
  if (
    typeof indicator !== "string" ||
    !NON_STANDARD_PORT_INDICATOR_PATTERN.test(indicator)
  ) {
    return null;
  }

  const portText = indicator.slice(
    "URL uses a non-standard port: ".length
  );
  const port = Number(portText);

  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    port === 80 ||
    port === 443
  ) {
    return null;
  }

  return 15;
}

function reconstructFindings(indicators) {
  if (!Array.isArray(indicators)) {
    return [];
  }

  const findings = [];

  for (const indicator of indicators) {
    const staticDefinition =
      STATIC_DEFINITION_BY_INDICATOR.get(indicator);

    if (staticDefinition) {
      const finding = createFinding(
        staticDefinition.type,
        staticDefinition.scoreContribution
      );

      if (finding) {
        findings.push(finding);
      }

      continue;
    }

    const suspiciousKeywordContribution =
      parseSuspiciousKeywordIndicator(indicator);

    if (suspiciousKeywordContribution !== null) {
      const finding = createFinding(
        "suspicious_keyword",
        suspiciousKeywordContribution
      );

      if (finding) {
        findings.push(finding);
      }

      continue;
    }

    const nonStandardPortContribution =
      parseNonStandardPortIndicator(indicator);

    if (nonStandardPortContribution !== null) {
      const finding = createFinding(
        "non_standard_port",
        nonStandardPortContribution
      );

      if (finding) {
        findings.push(finding);
      }
    }
  }

  return findings;
}

module.exports = {
  FINDING_DEFINITIONS,
  SUSPICIOUS_KEYWORDS,
  createFinding,
  reconstructFindings
};
