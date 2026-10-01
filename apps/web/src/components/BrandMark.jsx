/* An angular double-rim shield; compact sizes retain only the stronger rim. */
function BrandMark({ compact = false, className = "" }) {
  return (
    <svg
      className={`phishguard-mark ${className}`.trim()}
      viewBox="0 0 40 44"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 3 36 9v14l-5 9-11 9-11-9-5-9V9L20 3Z"
        stroke="currentColor"
        strokeWidth={compact ? "3.2" : "2.8"}
        strokeLinejoin="round"
      />
      {!compact && (
        <path
          d="M20 7.5 31.5 12v10l-3.9 7.2L20 35.5l-7.6-6.3L8.5 22V12L20 7.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeOpacity="0.6"
          strokeLinejoin="round"
        />
      )}
      <path
        d={compact
          ? "m12 16 8 12 8-12M12 16h16"
          : "m13 16.5 7 11 7-11M13 16.5h14"}
        stroke="currentColor"
        strokeWidth={compact ? "2.6" : "1.8"}
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx={compact ? "12" : "13"} cy={compact ? "16" : "16.5"} r={compact ? "3.2" : "2.6"} />
        <circle cx={compact ? "28" : "27"} cy={compact ? "16" : "16.5"} r={compact ? "3.2" : "2.6"} />
        <circle cx="20" cy={compact ? "28" : "27.5"} r={compact ? "3.2" : "2.6"} />
      </g>
    </svg>
  );
}

export default BrandMark;
