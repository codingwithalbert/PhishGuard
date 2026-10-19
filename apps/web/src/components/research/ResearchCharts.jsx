/*
 * Research Analytics V2 charts.
 *
 * Three lightweight inline-SVG charts. No charting dependency is used or added.
 *
 * Design rules applied throughout:
 *   - The plot is generated at the measured container width (with a readable
 *     minimum), so SVG user units stay close to CSS pixels instead of a fixed
 *     drawing being scaled down and taking its labels with it.
 *   - Value is never encoded by colour alone. Every bar is accompanied by its
 *     exact figure in text, and the axis carries tick labels.
 *   - An unavailable statistic never renders as a zero-length bar, which would
 *     claim "none" when the truth is "not measured". Unavailable states render
 *     as a dashed track plus the reason text.
 *   - Every chart is a labelled figure followed by a real HTML table, so the
 *     figures are readable by assistive technology and remain legible when the
 *     SVG reflows on a small screen.
 *   - No chart animation is used.
 */
import {
  METRIC_AVAILABILITY,
  describeCoefficientAvailability,
  describeMetricAvailability,
  formatScorePercent,
  formatShare,
  formatSignedCoefficient,
  normalizeExposureDistribution
} from "./researchChartUi";
import useChartWidth from "./useChartWidth";

const AXIS_FONT_SIZE = 12;
const VALUE_FONT_SIZE = 13;
const LABEL_FONT_SIZE = 12;
const REASON_FONT_SIZE = 11.5;

function ChartFrame({ titleId, title, subtitle, note, children }) {
  return (
    <figure className="research-chart" aria-labelledby={titleId}>
      <figcaption className="research-chart-head">
        <h3 id={titleId}>{title}</h3>
        {subtitle ? <p className="research-chart-subtitle">{subtitle}</p> : null}
      </figcaption>
      {children}
      {note ? <p className="research-chart-note">{note}</p> : null}
    </figure>
  );
}

// Every plot is wrapped in a keyboard-focusable scroll region. On a viewport
// narrower than the readable minimum the plot scrolls rather than shrinking its
// text below the legibility floor.
function ChartPlot({ label, children }) {
  const [plotRef, width] = useChartWidth();

  return (
    <div
      className="research-chart-scroll"
      ref={plotRef}
      role="group"
      tabIndex={0}
      aria-label={label}
    >
      {children(width)}
    </div>
  );
}

function ChartTable({ label, caption, headers, numericColumns, children }) {
  const numeric = new Set(
    numericColumns ?? headers.map((_, index) => index).slice(1)
  );

  return (
    <div
      className="research-table-scroll"
      role="group"
      tabIndex={0}
      aria-label={label}
    >
      <table className="research-stat-table">
        <caption className="research-table-caption">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={
                  index === 0
                    ? undefined
                    : numeric.has(index)
                      ? "research-cell-number"
                      : "research-cell-text"
                }
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function buildCountTicks(peak) {
  const ticks = new Set([0, peak]);

  if (peak >= 4) {
    ticks.add(Math.round(peak / 2));
  }

  return [...ticks].sort((left, right) => left - right);
}

/* ------------------------------------------------------------------ */
/* Chart A - Training Exposure Distribution                            */
/* ------------------------------------------------------------------ */

export function TrainingExposureDistributionChart({
  levels,
  distribution,
  cohortSize,
  withinSelectedCohort
}) {
  const titleId = "research-chart-distribution";
  const categories = normalizeExposureDistribution(levels, distribution);

  if (categories.length === 0) {
    return null;
  }

  // A floor of one keeps an all-zero cohort from collapsing the plot area.
  const peak = Math.max(1, ...categories.map((entry) => entry.count));
  const height = 236;
  const plotLeft = 46;
  const plotRight = 16;
  const plotTop = 30;
  const plotBottom = height - 54;

  const countText = categories
    .map(
      (entry) =>
        `${entry.label}: ${entry.count} participant${entry.count === 1 ? "" : "s"}`
    )
    .join(", ");

  return (
    <section className="research-panel research-chart-panel" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Training Exposure Distribution</h2>
      <p className="research-panel-note">
        {withinSelectedCohort
          ? "Distribution within the selected exposure cohort."
          : "Distribution across the whole eligible cohort."}{" "}
        Categories are the fixed canonical Training Exposure levels, and a level
        with no participants is still shown as a measured zero.
      </p>

      <ChartFrame
        titleId={titleId}
        title="Participants per Training Exposure level"
        subtitle={`${withinSelectedCohort ? "Selected cohort" : "All eligible participants"} · ${cohortSize} total`}
      >
        <ChartPlot label="Participant counts by Training Exposure level; scroll horizontally if needed">
          {(width) => {
            const left = plotLeft;
            const right = width - plotRight;
            const slotWidth = (right - left) / categories.length;
            const barWidth = Math.min(104, slotWidth * 0.52);
            const plotHeight = plotBottom - plotTop;
            const ticks = buildCountTicks(peak);

            return (
              <svg
                className="research-chart-svg"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`Bar chart of participant counts by Training Exposure level. ${countText}.`}
              >
                {ticks.map((tick) => {
                  const y = plotBottom - (tick / peak) * plotHeight;

                  return (
                    <g key={tick}>
                      <line
                        className={tick === 0 ? "research-chart-axis" : "research-chart-grid"}
                        x1={left}
                        y1={y}
                        x2={right}
                        y2={y}
                      />
                      <text
                        className="research-chart-tick"
                        x={left - 8}
                        y={y + 4}
                        textAnchor="end"
                        fontSize={AXIS_FONT_SIZE}
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {categories.map((entry, index) => {
                  const centerX = left + slotWidth * index + slotWidth / 2;
                  const barX = centerX - barWidth / 2;
                  const barHeight = (entry.count / peak) * plotHeight;
                  const barY = plotBottom - barHeight;

                  return (
                    <g key={entry.percent}>
                      {entry.count > 0 ? (
                        <rect
                          className="research-chart-bar"
                          x={barX}
                          y={barY}
                          width={barWidth}
                          height={Math.max(barHeight, 2)}
                          rx={3}
                        />
                      ) : (
                        <rect
                          className="research-chart-bar research-chart-bar-empty"
                          x={barX}
                          y={plotBottom - 2}
                          width={barWidth}
                          height={2}
                          rx={1}
                        />
                      )}
                      <text
                        className="research-chart-value"
                        x={centerX}
                        y={Math.max(15, barY - 7)}
                        textAnchor="middle"
                        fontSize={VALUE_FONT_SIZE}
                      >
                        {entry.count}
                      </text>
                      <text
                        className="research-chart-tick"
                        x={centerX}
                        y={plotBottom + 24}
                        textAnchor="middle"
                        fontSize={LABEL_FONT_SIZE}
                      >
                        {entry.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          }}
        </ChartPlot>

        <ChartTable
          label="Training Exposure distribution table; scroll horizontally if needed"
          caption="Training Exposure levels and participant counts"
          headers={["Training Exposure", "Participants", "Share of cohort"]}
          numericColumns={[1, 2]}
        >
          {categories.map((entry) => (
            <tr key={entry.percent}>
              <th scope="row">{entry.label}</th>
              <td className="research-cell-number">{entry.count}</td>
              <td className="research-cell-number">
                {formatShare(entry.count, cohortSize) ?? "Not available"}
              </td>
            </tr>
          ))}
        </ChartTable>
      </ChartFrame>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chart B - Assessment Score Comparison                               */
/* ------------------------------------------------------------------ */

function ScoreBar({
  label,
  centerX,
  barWidth,
  plotTop,
  plotBottom,
  statistics,
  availability
}) {
  const isAvailable = availability.state === METRIC_AVAILABILITY.available;
  const value = isAvailable ? Number(statistics.mean) : 0;
  const plotHeight = plotBottom - plotTop;
  const barHeight = isAvailable ? Math.max((value / 100) * plotHeight, 2) : 0;
  const barY = plotBottom - barHeight;
  const barX = centerX - barWidth / 2;

  const stateLabel =
    availability.state === METRIC_AVAILABILITY.suppressed
      ? "Suppressed"
      : availability.state === METRIC_AVAILABILITY.noObservations
        ? "No observations"
        : "Not available";

  return (
    <g>
      {isAvailable ? (
        <rect
          className="research-chart-bar"
          x={barX}
          y={barY}
          width={barWidth}
          height={barHeight}
          rx={3}
        />
      ) : (
        <rect
          className="research-chart-track"
          x={barX}
          y={plotTop}
          width={barWidth}
          height={plotHeight}
          rx={3}
        />
      )}
      <text
        className={isAvailable ? "research-chart-value" : "research-chart-reason"}
        x={centerX}
        y={isAvailable ? Math.max(15, barY - 7) : plotTop + 17}
        textAnchor="middle"
        fontSize={isAvailable ? VALUE_FONT_SIZE : REASON_FONT_SIZE}
      >
        {isAvailable ? formatScorePercent(statistics) : stateLabel}
      </text>
      <text
        className="research-chart-tick"
        x={centerX}
        y={plotBottom + 24}
        textAnchor="middle"
        fontSize={LABEL_FONT_SIZE}
      >
        {label}
      </text>
      <text
        className="research-chart-tick"
        x={centerX}
        y={plotBottom + 43}
        textAnchor="middle"
        fontSize={LABEL_FONT_SIZE}
      >
        n = {statistics.n}
      </text>
    </g>
  );
}

export function AssessmentScoreComparisonChart({ awareness, phishingIdentification, context }) {
  const titleId = "research-chart-scores";
  const height = 252;
  const plotTop = 28;
  const plotBottom = height - 64;
  const ticks = [0, 25, 50, 75, 100];

  const awarenessAvailability = describeMetricAvailability(awareness, context);
  const phishingAvailability = describeMetricAvailability(
    phishingIdentification,
    context
  );

  return (
    <section className="research-panel research-chart-panel" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Assessment Score Comparison</h2>
      <p className="research-panel-note">
        Mean of the latest completed attempt for each assessment. The two
        assessments are scored on the same 0–100% scale but are not a matched
        sample, so each mean is shown with its own valid observation count.
        Comparison is descriptive only and is not a measure of training
        effectiveness.
      </p>

      <ChartFrame
        titleId={titleId}
        title="Mean assessment score, 0 to 100 percent"
        subtitle={
          context?.filterApplied
            ? "Selected exposure cohort"
            : "All eligible participants"
        }
      >
        <ChartPlot label="Mean assessment scores with valid observation counts; scroll horizontally if needed">
          {(width) => {
            const left = 46;
            const right = width - 18;
            const plotWidth = right - left;
            const barWidth = Math.min(110, plotWidth * 0.22);
            const centers = [left + plotWidth * 0.3, left + plotWidth * 0.7];

            return (
              <svg
                className="research-chart-svg"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`Bar chart comparing mean assessment scores. Awareness Score ${formatScorePercent(awareness) ?? "not available"} with n equals ${awareness.n}; Phishing Identification Score ${formatScorePercent(phishingIdentification) ?? "not available"} with n equals ${phishingIdentification.n}.`}
              >
                {ticks.map((tick) => {
                  const y = plotBottom - (tick / 100) * (plotBottom - plotTop);

                  return (
                    <g key={tick}>
                      <line
                        className={tick === 0 ? "research-chart-axis" : "research-chart-grid"}
                        x1={left}
                        y1={y}
                        x2={right}
                        y2={y}
                      />
                      <text
                        className="research-chart-tick"
                        x={left - 8}
                        y={y + 4}
                        textAnchor="end"
                        fontSize={AXIS_FONT_SIZE}
                      >
                        {tick}%
                      </text>
                    </g>
                  );
                })}

                <ScoreBar
                  label="Awareness"
                  centerX={centers[0]}
                  barWidth={barWidth}
                  plotTop={plotTop}
                  plotBottom={plotBottom}
                  statistics={awareness}
                  availability={awarenessAvailability}
                />
                <ScoreBar
                  label="Phishing ID"
                  centerX={centers[1]}
                  barWidth={barWidth}
                  plotTop={plotTop}
                  plotBottom={plotBottom}
                  statistics={phishingIdentification}
                  availability={phishingAvailability}
                />
              </svg>
            );
          }}
        </ChartPlot>

        <ChartTable
          label="Assessment score comparison table; scroll horizontally if needed"
          caption="Mean assessment score and valid observation count"
          headers={["Assessment", "Mean", "Valid n", "Status"]}
          numericColumns={[1, 2]}
        >
          <tr>
            <th scope="row">Awareness Score</th>
            <td className="research-cell-number">
              {formatScorePercent(awareness) ?? "Not available"}
            </td>
            <td className="research-cell-number">{awareness.n}</td>
            <td className="research-cell-text">
              {awarenessAvailability.message ?? "Reported"}
            </td>
          </tr>
          <tr>
            <th scope="row">Phishing Identification Score</th>
            <td className="research-cell-number">
              {formatScorePercent(phishingIdentification) ?? "Not available"}
            </td>
            <td className="research-cell-number">
              {phishingIdentification.n}
            </td>
            <td className="research-cell-text">
              {phishingAvailability.message ?? "Reported"}
            </td>
          </tr>
        </ChartTable>
      </ChartFrame>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chart C - Pearson Correlations                                      */
/* ------------------------------------------------------------------ */

/*
 * Correlation labels are derived from the `variables` array the backend
 * reports, so the frontend never hard-codes the relationship identifiers or
 * their order. An unrecognised variable falls back to its own name rather than
 * being dropped.
 */
const VARIABLE_LABELS = Object.freeze({
  trainingExposure: "Training Exposure",
  awarenessScore: "Awareness Score",
  phishingIdentificationScore: "Phishing Identification Score"
});

const VARIABLE_SHORT_LABELS = Object.freeze({
  trainingExposure: "Exposure",
  awarenessScore: "Awareness",
  phishingIdentificationScore: "Phishing ID"
});

function formatVariablePair(variables, labels) {
  if (!Array.isArray(variables) || variables.length === 0) {
    return "Unknown relationship";
  }

  return variables
    .map((variable) => labels[variable] ?? variable)
    .join(" and ");
}

// The narrow layout has one full-width text line beneath each bar. Keep the
// reason readable at 320px while the table and aria-label retain the exact
// backend-derived wording.
function getCompactUnavailableReason(availability) {
  if (availability.state === METRIC_AVAILABILITY.suppressed) {
    return "Suppressed below minimum reporting size";
  }

  if (availability.state === METRIC_AVAILABILITY.noObservations) {
    return "No paired observations";
  }

  if (availability.state === METRIC_AVAILABILITY.undefined) {
    return availability.message?.includes("constant")
      ? "Exposure is constant in this cohort"
      : "Relationship not defined";
  }

  return "Not available";
}

export function PearsonCorrelationChart({ relationships, context }) {
  const titleId = "research-chart-correlations";
  const entries = Object.entries(relationships);

  const described = entries.map(([key, relationship]) => {
    const availability = describeCoefficientAvailability(relationship, context);

    return {
      key,
      relationship,
      availability,
      label: formatVariablePair(relationship?.variables, VARIABLE_LABELS),
      shortLabel: formatVariablePair(
        relationship?.variables,
        VARIABLE_SHORT_LABELS
      )
    };
  });

  const chartDescription = described
    .map(
      (entry) =>
        `${entry.label}: ${
          entry.availability.state === METRIC_AVAILABILITY.available
            ? formatSignedCoefficient(entry.relationship.r)
            : entry.availability.message
        }`
    )
    .join(". ");

  return (
    <section className="research-panel research-chart-panel" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Pearson Correlations</h2>
      <p className="research-panel-note">
        Pearson coefficients for the three research-variable pairs, each using
        only the participants who have values for both variables. The sign is
        printed for every row, so direction is never conveyed by colour or bar
        direction alone. These describe association only: they are not causal
        effects and no significance level is claimed.
      </p>

      <ChartFrame
        titleId={titleId}
        title="Observed Pearson correlation coefficients"
        subtitle={
          context?.filterApplied
            ? "Selected exposure cohort"
            : "All eligible participants"
        }
        note="Selecting a single exposure level makes Training Exposure constant, so the two exposure relationships are not defined within that cohort. They are shown as unavailable, never as zero."
      >
        <ChartPlot label="Pearson correlation coefficients from minus one to plus one; scroll horizontally if needed">
          {(width) => {
            const isNarrow = width < 700;
            const rowHeight = isNarrow ? 58 : 54;
            const headerHeight = 22;
            const height = headerHeight + rowHeight * described.length + 8;

            if (isNarrow) {
              const left = 10;
              const right = width - 10;
              const zeroX = left + (right - left) / 2;
              const halfWidth = (right - left) / 2;

              return (
                <svg
                  className="research-chart-svg"
                  viewBox={`0 0 ${width} ${height}`}
                  role="img"
                  aria-label={`Diverging bar chart of Pearson correlation coefficients from minus one to plus one. ${chartDescription}.`}
                >
                  <line
                    className="research-chart-axis"
                    x1={left}
                    y1={headerHeight - 4}
                    x2={right}
                    y2={headerHeight - 4}
                  />
                  <text
                    className="research-chart-tick"
                    x={left}
                    y={headerHeight - 8}
                    fontSize={REASON_FONT_SIZE}
                  >
                    −1
                  </text>
                  <text
                    className="research-chart-tick"
                    x={zeroX}
                    y={headerHeight - 8}
                    textAnchor="middle"
                    fontSize={REASON_FONT_SIZE}
                  >
                    0
                  </text>
                  <text
                    className="research-chart-tick"
                    x={right}
                    y={headerHeight - 8}
                    textAnchor="end"
                    fontSize={REASON_FONT_SIZE}
                  >
                    +1
                  </text>

                  <line
                    className="research-chart-zero"
                    x1={zeroX}
                    y1={headerHeight}
                    x2={zeroX}
                    y2={height - 10}
                  />

                  {described.map((entry, index) => {
                    const rowTop = headerHeight + index * rowHeight;
                    const available =
                      entry.availability.state === METRIC_AVAILABILITY.available;
                    const coefficient = entry.relationship.r;
                    const valueText = available
                      ? formatSignedCoefficient(coefficient)
                      : "Not available";
                    const barWidth = available
                      ? Math.max(Math.abs(coefficient) * halfWidth, 2)
                      : 0;
                    const barX =
                      coefficient > 0 ? zeroX : zeroX - barWidth;

                    return (
                      <g key={entry.key}>
                        <text
                          className="research-chart-row-label"
                          x={left}
                          y={rowTop + 17}
                          fontSize={LABEL_FONT_SIZE}
                        >
                          {entry.shortLabel}
                        </text>
                        <text
                          className={
                            available
                              ? "research-chart-value"
                              : "research-chart-reason"
                          }
                          x={right}
                          y={rowTop + 17}
                          textAnchor="end"
                          fontSize={VALUE_FONT_SIZE}
                        >
                          {valueText} · n {entry.relationship.n}
                        </text>

                        <line
                          className="research-chart-grid"
                          x1={left}
                          y1={rowTop + 28}
                          x2={right}
                          y2={rowTop + 28}
                        />

                        {available ? (
                          <rect
                            className="research-chart-bar"
                            x={coefficient === 0 ? zeroX - 1 : barX}
                            y={rowTop + 23}
                            width={coefficient === 0 ? 2 : barWidth}
                            height={10}
                            rx={2}
                          />
                        ) : (
                          <rect
                            className="research-chart-track"
                            x={left}
                            y={rowTop + 23}
                            width={right - left}
                            height={10}
                            rx={2}
                          />
                        )}

                        {!available ? (
                          <text
                            className="research-chart-reason"
                            x={left}
                            y={rowTop + 51}
                            fontSize={REASON_FONT_SIZE}
                          >
                            {getCompactUnavailableReason(entry.availability)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              );
            }

            const labelWidth = Math.min(260, Math.max(190, Math.round(width * 0.24)));
            const valueWidth = 60;
            const countWidth = 58;
            const plotLeft = 8 + labelWidth + 14;
            const countX = width - countWidth - 2;
            const valueX = countX - valueWidth - 12;
            const plotRight = valueX - 14;
            const zeroX = plotLeft + (plotRight - plotLeft) / 2;
            const halfWidth = (plotRight - plotLeft) / 2;

            return (
              <svg
                className="research-chart-svg"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`Diverging bar chart of Pearson correlation coefficients from minus one to plus one. ${chartDescription}.`}
              >
                <line
                  className="research-chart-axis"
                  x1={plotLeft}
                  y1={headerHeight - 4}
                  x2={plotRight}
                  y2={headerHeight - 4}
                />
                <text
                  className="research-chart-tick"
                  x={plotLeft}
                  y={headerHeight - 8}
                  fontSize={REASON_FONT_SIZE}
                >
                  −1
                </text>
                <text
                  className="research-chart-tick"
                  x={zeroX}
                  y={headerHeight - 8}
                  textAnchor="middle"
                  fontSize={REASON_FONT_SIZE}
                >
                  0
                </text>
                <text
                  className="research-chart-tick"
                  x={plotRight}
                  y={headerHeight - 8}
                  textAnchor="end"
                  fontSize={REASON_FONT_SIZE}
                >
                  +1
                </text>
                <text
                  className="research-chart-tick"
                  x={valueX}
                  y={headerHeight - 8}
                  fontSize={REASON_FONT_SIZE}
                >
                  r
                </text>
                <text
                  className="research-chart-tick"
                  x={countX}
                  y={headerHeight - 8}
                  fontSize={REASON_FONT_SIZE}
                >
                  n
                </text>

                <line
                  className="research-chart-zero"
                  x1={zeroX}
                  y1={headerHeight}
                  x2={zeroX}
                  y2={height - 10}
                />

                {described.map((entry, index) => {
                  const rowTop = headerHeight + index * rowHeight;
                  const available =
                    entry.availability.state === METRIC_AVAILABILITY.available;
                  const coefficient = entry.relationship.r;
                  const barWidth = available
                    ? Math.max(Math.abs(coefficient) * halfWidth, 2)
                    : 0;
                  const barX = coefficient > 0 ? zeroX : zeroX - barWidth;

                  return (
                    <g key={entry.key}>
                      <text
                        className="research-chart-row-label"
                        x={8}
                        y={rowTop + 18}
                        fontSize={LABEL_FONT_SIZE}
                      >
                        {entry.shortLabel}
                      </text>

                      {available ? (
                        <>
                          <rect
                            className="research-chart-bar"
                            x={coefficient === 0 ? zeroX - 1 : barX}
                            y={rowTop + 26}
                            width={coefficient === 0 ? 2 : barWidth}
                            height={12}
                            rx={3}
                          />
                          <text
                            className="research-chart-value"
                            x={valueX}
                            y={rowTop + 19}
                            fontSize={VALUE_FONT_SIZE}
                          >
                            {formatSignedCoefficient(coefficient)}
                          </text>
                        </>
                      ) : (
                        <rect
                          className="research-chart-track"
                          x={plotLeft}
                          y={rowTop + 26}
                          width={plotRight - plotLeft}
                          height={12}
                          rx={3}
                        />
                      )}

                      <text
                        className="research-chart-tick"
                        x={countX}
                        y={rowTop + 19}
                        fontSize={REASON_FONT_SIZE}
                      >
                        {entry.relationship.n}
                      </text>

                      {!available ? (
                        <text
                          className="research-chart-reason"
                          x={plotLeft}
                          y={rowTop + 51}
                          fontSize={REASON_FONT_SIZE}
                        >
                          {entry.availability.message}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            );
          }}
        </ChartPlot>

        <ChartTable
          label="Pearson correlation table; scroll horizontally if needed"
          caption="Pearson correlation coefficients and paired observation counts"
          headers={["Variables compared", "Paired n", "Pearson r", "Status"]}
          numericColumns={[1, 2]}
        >
          {described.map((entry) => (
            <tr key={entry.key}>
              <th scope="row">{entry.label}</th>
              <td className="research-cell-number">{entry.relationship.n}</td>
              <td className="research-cell-number">
                {entry.availability.state === METRIC_AVAILABILITY.available
                  ? formatSignedCoefficient(entry.relationship.r)
                  : "Not available"}
              </td>
              <td className="research-cell-text">
                {entry.availability.message ?? "Reported"}
              </td>
            </tr>
          ))}
        </ChartTable>
      </ChartFrame>
    </section>
  );
}
