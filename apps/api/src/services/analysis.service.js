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
  let score = 0;

  // Suspicious keywords
  const suspiciousKeywords = [
    "login",
    "verify",
    "verification",
    "secure",
    "account",
    "update",
    "password",
    "signin",
    "confirm"
  ];

  const urlLower = url.toLowerCase();

  const matchedKeywords = suspiciousKeywords.filter((keyword) =>
    urlLower.includes(keyword)
  );

  if (matchedKeywords.length > 0) {
    indicators.push(
      `Contains suspicious keyword(s): ${matchedKeywords.join(", ")}`
    );
    score += Math.min(matchedKeywords.length * 5, 15);
  }

  // Excessive subdomains
  const hostnameParts = parsedUrl.hostname.split(".");

  if (hostnameParts.length >= 5) {
    indicators.push("URL contains an unusually large number of subdomains");
    score += 15;
  }

  // Punycode domain detection
  if (parsedUrl.hostname.includes("xn--")) {
    indicators.push("Hostname contains a punycode domain");
    score += 15;
  }

  // Suspicious port detection
  if (parsedUrl.port && !["80", "443"].includes(parsedUrl.port)) {
    indicators.push(`URL uses a non-standard port: ${parsedUrl.port}`);
    score += 15;
  }

  // URL encoding detection
  if (/%[0-9a-fA-F]{2}/.test(url)) {
    indicators.push("URL contains percent-encoded characters");
    score += 10;
  }

  // Long hostname detection
  if (parsedUrl.hostname.length > 50) {
    indicators.push("Hostname is unusually long");
    score += 10;
  }

  // HTTPS check
  if (parsedUrl.protocol !== "https:") {
    indicators.push("Connection does not use HTTPS");
    score += 20;
  }

  // IP address instead of domain name
  const hostname = parsedUrl.hostname;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    indicators.push("URL uses an IP address instead of a domain name");
    score += 25;
  }

  // Suspicious URL length
  if (url.length > 100) {
    indicators.push("URL is unusually long");
    score += 10;
  }

  // Suspicious characters
  if (url.includes("@")) {
    indicators.push("URL contains an @ character");
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
    indicators
  };
}

module.exports = {
  analyzeUrl
};