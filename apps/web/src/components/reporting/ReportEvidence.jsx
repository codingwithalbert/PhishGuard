import AnalysisFindings from "../AnalysisFindings";
import {
  getReportFindingsMessage,
  getValidFindings
} from "./reportingUi";

function getRiskClassName(risk) {
  if (risk === "low" || risk === "medium" || risk === "high") {
    return `risk risk-${risk}`;
  }

  return "risk";
}

function getIndicators(evidence) {
  if (!Array.isArray(evidence?.indicators)) {
    return [];
  }

  return evidence.indicators.filter(
    (indicator) => typeof indicator === "string"
  );
}

function ReportEvidence({ analysisSnapshot }) {
  const evidence =
    analysisSnapshot && typeof analysisSnapshot === "object"
      ? analysisSnapshot
      : {};
  const url = typeof evidence.url === "string" ? evidence.url : null;
  const risk = typeof evidence.risk === "string" ? evidence.risk : null;
  const score = Number.isFinite(evidence.score) ? evidence.score : null;
  const indicators = getIndicators(evidence);
  const findings = getValidFindings(evidence);

  return (
    <div className="report-evidence">
      <h3>PhishGuard automated analysis</h3>

      <div className="analysis-context">
        <p className="analysis-heuristic-note">
          This is the automated heuristic analysis captured with the Report. It
          is not a definitive determination that the URL is safe, phishing, or
          malicious.
        </p>
      </div>

      <div className="result-summary">
        <p className="result-url">
          <strong>URL:</strong> {url || "URL unavailable"}
        </p>

        <div className="result-metrics">
          <p>
            <strong>Automated risk:</strong>{" "}
            {risk ? (
              <span className={getRiskClassName(risk)}>
                {risk.toUpperCase()}
              </span>
            ) : (
              "Unavailable"
            )}
          </p>

          <p>
            <strong>Automated score:</strong>{" "}
            {score === null ? "Unavailable" : score}
          </p>
        </div>
      </div>

      <div className="analysis-findings">
        <h3>Automated findings</h3>
        <AnalysisFindings
          findings={findings}
          emptyMessage={getReportFindingsMessage(evidence)}
        />
      </div>

      <div className="analysis-indicators">
        <h3>Automated indicators</h3>

        {indicators.length > 0 ? (
          <ul>
            {indicators.map((indicator, index) => (
              <li key={`${indicator}-${index}`}>
                {indicator}
              </li>
            ))}
          </ul>
        ) : (
          <p>No suspicious indicators were returned.</p>
        )}
      </div>
    </div>
  );
}

export default ReportEvidence;
