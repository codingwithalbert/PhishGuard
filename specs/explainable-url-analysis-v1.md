# Explainable URL Analysis V1 Specification

## 1. Purpose

Explainable URL Analysis V1 improves the transparency and usefulness of
PhishGuard's existing URL Analyzer.

The analyzer already evaluates lexical and structural URL characteristics and
returns a risk level, numerical score, and detected indicators.

V1 must explain why each detected indicator matters and how it contributed to
the score.

This feature does not turn PhishGuard into a malware scanner, reputation
service, or definitive phishing detector.

## 2. Core Principle

PhishGuard performs heuristic analysis of URL characteristics.

Results must never claim that a URL is definitively safe, malicious, phishing,
or trustworthy.

The UI must communicate that the result is a heuristic assessment based only
on characteristics detected in the submitted URL.

A low-risk result is not proof that a URL is safe.
A high-risk result is not proof that a URL is malicious.

## 3. Existing Detection Behavior

Preserve all existing URL-analysis checks:

1. Suspicious keywords
2. Excessive subdomains
3. Punycode hostname
4. Non-standard port
5. Percent-encoded characters
6. Unusually long hostname
7. Connection not using HTTPS
8. IP address used instead of a domain name
9. Unusually long URL
10. `@` character in the URL

Do not remove or redesign these checks in V1.

## 4. Scoring Compatibility

Preserve all current scoring weights and risk thresholds exactly.

Risk thresholds remain:

- score below 25 = low
- score 25 through 49 = medium
- score 50 or greater = high

Suspicious-keyword scoring must retain its current capped behavior.

Do not redesign the scoring algorithm in this feature. Existing historical
scores must remain comparable with new scores.

## 5. Existing Indicators

The existing `indicators` field is persisted as `[String]`.

Keep this format unchanged.

Do not migrate indicators to structured objects and do not require a database
migration.

Existing analyses and API consumers using `indicators` must continue working.

## 6. Structured Findings

Add a server-authoritative explainability representation named `findings`.

Each recognized finding contains:

- `type`
- `title`
- `explanation`
- `scoreContribution`

Example:

    {
      "type": "ip_address",
      "title": "IP address used instead of a domain name",
      "explanation": "Using an IP address can make the destination harder to recognize.",
      "scoreContribution": 25
    }

`findings` supplements the existing `indicators` field. It does not replace it.

`findings` must always be an array.

If no recognized findings exist, return `findings: []`.

Do not return `null` for the findings collection.

## 7. Stable Finding Types

Use stable identifiers for the existing detection categories:

- `suspicious_keyword`
- `excessive_subdomains`
- `punycode`
- `non_standard_port`
- `percent_encoding`
- `long_hostname`
- `no_https`
- `ip_address`
- `long_url`
- `at_character`

These identifiers are implementation-facing values. The UI must use clear
user-facing titles.

## 8. Finding Explanations

Each finding must explain why the detected characteristic may deserve
attention.

Explanations must be:

- concise
- understandable to non-technical users
- accurate
- non-alarmist
- directly related to the triggered heuristic

Where appropriate, explanations should acknowledge legitimate uses.

Examples:

- Authentication-related words can appear in phishing URLs, but also occur on
  legitimate websites.
- Punycode supports legitimate internationalized domain names, but can also
  make visually deceptive domain names possible.
- A URL without HTTPS does not use an HTTPS connection, but the presence of
  HTTPS alone does not prove that a website is trustworthy.
- Encoded characters can make a URL harder to visually interpret, but can also
  have legitimate uses.

A finding must never state that its presence proves phishing.

## 9. Score Contributions

Every structured finding must expose the contribution actually produced by
the existing backend scoring algorithm.

Do not calculate authoritative contributions in the frontend.

Multiple suspicious keywords must follow the existing capped contribution.

For a newly analyzed URL, the sum of all finding contributions must equal the
analysis score.

## 10. New Analysis Response

Successful URL-analysis responses must preserve the existing analysis fields:

- `id`
- `url`
- `risk`
- `score`
- `indicators`
- `status`
- `createdAt`

Add `findings` without removing or changing the meaning of existing fields.

The backend remains authoritative for findings, scoring, and risk.

Any endpoint that returns a full analysis record, including the response after
updating an analysis status, should expose `findings` consistently when the
stored indicators can be recognized.

Changing an analysis status must not cause structured findings to disappear
from the returned representation.

## 11. Historical Analysis Compatibility

Existing MongoDB records contain string indicators.

When returning historical analyses, the backend should reconstruct structured
findings from recognized stored indicators where this can be done safely.

Reconstruction must support dynamic existing indicators, including:

- suspicious-keyword indicator strings
- non-standard-port indicator strings

Unknown or malformed legacy indicators must not result in fabricated
explanations.

The original stored indicator must remain available even when no structured
finding can safely be reconstructed.

The original stored indicator must remain available even when no structured
finding can safely be reconstructed.

Unknown legacy indicators must remain in `indicators` but must not generate a
placeholder or guessed structured finding.

An analysis may therefore contain more `indicators` than `findings`.

No database migration is required.

No database migration is required.

## 12. Persistence

Do not persist repeated explanation text solely for presentation.

Keep finding definitions and explanation text in server-owned application
code.

Do not create:

- a findings collection
- a findings model
- duplicated explanation records

The existing Analysis record remains the persisted historical record.

## 13. Overall Result Explanation

The frontend must clearly present:

- analyzed URL
- risk level
- numerical score
- detected findings
- heuristic limitation

Suggested meaning:

### Low

Few or no characteristics covered by PhishGuard's current heuristic checks
were detected.

### Medium

Some characteristics detected by PhishGuard warrant additional caution.

### High

Multiple or strongly weighted characteristics detected by PhishGuard warrant
additional caution.

These descriptions must not claim certainty about the destination.

## 14. Zero-Finding Results

A result with:

- score `0`
- risk `low`
- no findings

is a valid completed analysis.

The frontend may state that no suspicious characteristics covered by the
current heuristic checks were detected.

It must not state that the URL is safe or trustworthy.

## 15. Defensive Guidance

The result interface may provide concise defensive guidance such as:

- Verify the destination independently when uncertain.
- Avoid entering credentials or sensitive information when a destination
  appears suspicious.
- Use a known official website or trusted bookmark when possible.

After Reporting is implemented, a report action may be added separately.

Do not make unsupported claims about the analyzed destination.

## 16. Frontend Presentation

Improve the existing URL-analysis result presentation enough to support
Explainable URL Analysis V1.

The result should clearly show:

- analyzed URL
- risk level
- score
- heuristic disclaimer
- findings
- explanation for each finding
- score contribution for each finding
- defensive guidance

This is not the major application-wide UI/UX redesign.

Keep the refinement compatible with the current PhishGuard visual system.

## 17. Analysis History

Preserve all existing Analysis History functionality:

- view owned analyses
- update permitted analysis status
- delete owned analyses

Historical records may display structured findings reconstructed by the
backend.

Legacy records must remain usable.

## 18. Ownership and Security

Preserve existing authentication, authorization, validation, and ownership
rules.

Users must only access or modify analyses allowed by the existing ownership
model.

Do not expose internal user identifiers through findings.

Explainability must not weaken existing security controls.

## 19. Backend Authority

The backend is authoritative for:

- triggered heuristics
- indicator generation
- structured findings
- score contributions
- total score
- risk classification

The frontend must not recreate these rules.

Do not add external threat-intelligence services for V1.

Do not add new environment variables.

Do not add packages unless separately approved.

## 20. Non-Goals

Explainable URL Analysis V1 does not add:

- live website crawling
- page-content analysis
- malware scanning
- domain reputation lookup
- DNS history
- WHOIS lookup
- certificate reputation analysis
- external threat feeds
- machine-learning classification
- AI-generated risk classification
- definitive safe/malicious verdicts
- suspicious-URL Reporting

Reporting is a separate future feature.

## 21. Backend Testing

Tests must verify at minimum:

- all existing scoring behavior remains unchanged
- existing risk thresholds remain unchanged
- existing string indicators remain compatible
- structured findings correspond to triggered heuristics
- finding contributions match actual scoring
- finding contributions sum to the total score
- multiple suspicious keywords respect the existing cap
- score 0 produces no findings
- dynamic suspicious-keyword indicators are handled correctly
- dynamic non-standard-port indicators are handled correctly
- recognized legacy indicators reconstruct correctly
- unknown/malformed legacy indicators do not fabricate findings

All existing analysis tests must continue passing.

## 22. Frontend Verification

Verify that:

- score 0 remains a valid completed result
- low-, medium-, and high-risk results render correctly
- detected findings are understandable
- score contributions come from backend data
- heuristic limitations are visible
- historical analyses remain usable
- unknown legacy indicators do not break rendering
- Analysis History status updates still work
- Analysis History deletion still works

## 23. Final Verification

Before Explainable URL Analysis V1 is complete:

- API tests pass
- frontend lint passes
- frontend production build passes
- `git diff --check` passes
- existing scoring remains unchanged
- existing API compatibility is preserved
- existing MongoDB records remain compatible
- ownership boundaries remain intact
- no database migration is required
- no unrelated features are changed
- no new package is introduced without approval
- no new environment variable is introduced