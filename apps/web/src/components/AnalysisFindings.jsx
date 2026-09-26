function AnalysisFindings({ findings, emptyMessage }) {
  const safeFindings = Array.isArray(findings) ? findings : [];

  if (safeFindings.length === 0) {
    return <p className="findings-empty">{emptyMessage}</p>;
  }

  return (
    <ul className="findings-list">
      {safeFindings.map((finding, index) => (
        <li
          className="finding-item"
          key={`${finding.type || "finding"}-${index}`}
        >
          <div className="finding-item-heading">
            <h4>{finding.title}</h4>
            <span className="finding-contribution">
              Score contribution: {finding.scoreContribution}
            </span>
          </div>

          <p>{finding.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

export default AnalysisFindings;
