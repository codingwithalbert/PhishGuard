/*
 * Analytics Visualization V1 charts.
 *
 * Three lightweight inline-SVG charts. No charting dependency is used or added.
 *
 * Design rules applied throughout:
 *   - Value is never encoded by color alone. Every bar is accompanied by its
 *     exact figure in text, and the axis carries tick labels.
 *   - An unavailable statistic never renders as a zero-length bar, which would
 *     claim "none" when the truth is "not measured". Unavailable states render
 *     as a dashed track plus the reason text.
 *   - Every chart is a labelled figure followed by a real HTML table, so the
 *     figures are readable by assistive technology and remain legible when the
 *     SVG scales down on a small screen.
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

const CHART_WIDTH = 340;
const AXIS_FONT_SIZE = 11;
const VALUE_FONT_SIZE = 12;
const LABEL_FONT_SIZE = 10;

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

// Every plot is wrapped in the same scroll container used by the data tables,
// so a chart can keep its natural size instead of shrinking its own labels.
function ChartPlot({ children }) {
  return <div className="research-chart-scroll">{children}</div>;
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

  const plotTop = 18;
  const plotBottom = 128;
  const plotHeight = plotBottom - plotTop;
  const plotLeft = 16;
  const plotRight = CHART_WIDTH - 8;
  const plotWidth = plotRight - plotLeft;

  const slotWidth = plotWidth / categories.length;
  const barWidth = Math.min(48, slotWidth * 0.56);

  const heightFor = (count) => (count / peak) * plotHeight;

  return (
    <section className="research-panel" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Training Exposure Distribution</h2>
      <p className="research-panel-note">
        {withinSelectedCohort
          ? "Distribution within the selected exposure cohort."
          : "Distribution across the whole eligible cohort."}{" "}
        Categories are the fixed canonical Training Exposure levels, and a level
        with no participants is still shown.
      </p>

      <ChartFrame
        titleId={titleId}
        title="Participants per Training Exposure level"
        subtitle={`${withinSelectedCohort ? "Selected cohort" : "All eligible participants"} · ${cohortSize} total`}
      >
        <ChartPlot>
          <svg
            className="research-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${plotBottom + 30}`}
            role="img"
            aria-label={`Bar chart of participant counts by Training Exposure level. ${categories
              .map((entry) => `${entry.label}: ${entry.count}`)
              .join(", ")}.`}
          >
          <line
            className="research-chart-axis"
            x1={plotLeft}
            y1={plotBottom}
            x2={plotRight}
            y2={plotBottom}
          />
          <text
            className="research-chart-tick"
            x={plotLeft}
            y={plotBottom + 14}
            textAnchor="start"
            fontSize={AXIS_FONT_SIZE}
          >
            0
          </text>
          <text
            className="research-chart-tick"
            x={plotRight}
            y={plotBottom - plotHeight + 4}
            textAnchor="end"
            fontSize={AXIS_FONT_SIZE}
          >
            {peak}
          </text>

          {categories.map((entry, index) => {
            const centerX = plotLeft + slotWidth * index + slotWidth / 2;
            const barX = centerX - barWidth / 2;
            const barHeight = heightFor(entry.count);
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
                  y={barY - 6}
                  textAnchor="middle"
                  fontSize={VALUE_FONT_SIZE}
                >
                  {entry.count}
                </text>
                <text
                  className="research-chart-tick"
                  x={centerX}
                  y={plotBottom + 26}
                  textAnchor="middle"
                  fontSize={LABEL_FONT_SIZE}
                >
                  {entry.label}
                </text>
              </g>
            );
          })}
        </svg>
        </ChartPlot>

        <div className="research-table-scroll">
          <table className="research-stat-table">
            <caption className="research-table-caption">
              Training Exposure levels and participant counts
            </caption>
            <thead>
              <tr>
                <th scope="col">Training Exposure</th>
                <th scope="col">Participants</th>
                <th scope="col">Share of cohort</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((entry) => (
                <tr key={entry.percent}>
                  <th scope="row">{entry.label}</th>
                  <td>{entry.count}</td>
                  <td>
                    {formatShare(entry.count, cohortSize) ?? "Not available"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartFrame>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chart B - Assessment Score Comparison                               */
/* ------------------------------------------------------------------ */

function ScoreBar({ label, centerX, statistics, availability }) {
  const plotTop = 18;
  const plotBottom = 128;
  const plotHeight = plotBottom - plotTop;
  const barWidth = 74;

  const isAvailable = availability.state === METRIC_AVAILABILITY.available;
  const value = isAvailable ? Number(statistics.mean) : 0;
  const barHeight = isAvailable
    ? Math.max((value / 100) * plotHeight, 2)
    : 0;
  const barY = plotBottom - barHeight;
  const barX = centerX - barWidth / 2;

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
        className="research-chart-value"
        x={centerX}
        y={isAvailable ? barY - 6 : plotTop + 16}
        textAnchor="middle"
        fontSize={VALUE_FONT_SIZE}
      >
        {isAvailable ? formatScorePercent(statistics) : "Not available"}
      </text>
      <text
        className="research-chart-tick"
        x={centerX}
        y={plotBottom + 16}
        textAnchor="middle"
        fontSize={LABEL_FONT_SIZE}
      >
        {label}
      </text>
      <text
        className="research-chart-tick"
        x={centerX}
        y={plotBottom + 28}
        textAnchor="middle"
        fontSize={LABEL_FONT_SIZE}
      >
        n = {statistics.n}
      </text>
      {!isAvailable ? (
        <text
          className="research-chart-reason"
          x={centerX}
          y={plotTop + 32}
          textAnchor="middle"
          fontSize={LABEL_FONT_SIZE}
        >
          {availability.state === METRIC_AVAILABILITY.suppressed
            ? "suppressed"
            : "no data"}
        </text>
      ) : null}
    </g>
  );
}

export function AssessmentScoreComparisonChart({ awareness, phishingIdentification, context }) {
  const titleId = "research-chart-scores";

  const awarenessAvailability = describeMetricAvailability(awareness, context);
  const phishingAvailability = describeMetricAvailability(
    phishingIdentification,
    context
  );

  const plotBottom = 128;
  const plotTop = 18;

  return (
    <section className="research-panel" aria-labelledby={`${titleId}-heading`}>
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
        <ChartPlot>
          <svg
            className="research-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${plotBottom + 34}`}
            role="img"
            aria-label={`Bar chart comparing mean assessment scores. Awareness Score ${formatScorePercent(awareness) ?? "not available"} with n equals ${awareness.n}; Phishing Identification Score ${formatScorePercent(phishingIdentification) ?? "not available"} with n equals ${phishingIdentification.n}.`}
          >
          <line
            className="research-chart-axis"
            x1={8}
            y1={plotBottom}
            x2={CHART_WIDTH - 8}
            y2={plotBottom}
          />
          <line
            className="research-chart-grid"
            x1={8}
            y1={plotTop + (plotBottom - plotTop) / 2}
            x2={CHART_WIDTH - 8}
            y2={plotTop + (plotBottom - plotTop) / 2}
          />
          <text
            className="research-chart-tick"
            x={8}
            y={plotBottom + 14}
            textAnchor="start"
            fontSize={AXIS_FONT_SIZE}
          >
            0%
          </text>
          <text
            className="research-chart-tick"
            x={CHART_WIDTH - 8}
            y={plotTop + 4}
            textAnchor="end"
            fontSize={AXIS_FONT_SIZE}
          >
            100%
          </text>

          <ScoreBar
            label="Awareness"
            centerX={CHART_WIDTH * 0.29}
            statistics={awareness}
            availability={awarenessAvailability}
          />
          <ScoreBar
            label="Phishing ID"
            centerX={CHART_WIDTH * 0.71}
            statistics={phishingIdentification}
            availability={phishingAvailability}
          />
        </svg>
        </ChartPlot>

        <div className="research-table-scroll">
          <table className="research-stat-table">
            <caption className="research-table-caption">
              Mean assessment score and valid observation count
            </caption>
            <thead>
              <tr>
                <th scope="col">Assessment</th>
                <th scope="col">Mean</th>
                <th scope="col">Valid n</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Awareness Score</th>
                <td>{formatScorePercent(awareness) ?? "Not available"}</td>
                <td>{awareness.n}</td>
                <td>
                  {awarenessAvailability.message ?? "Reported"}
                </td>
              </tr>
              <tr>
                <th scope="row">Phishing Identification Score</th>
                <td>
                  {formatScorePercent(phishingIdentification) ??
                    "Not available"}
                </td>
                <td>{phishingIdentification.n}</td>
                <td>
                  {phishingAvailability.message ?? "Reported"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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

export function PearsonCorrelationChart({ relationships, context }) {
  const titleId = "research-chart-correlations";
  const entries = Object.entries(relationships);
  const rowHeight = 46;
  const plotTop = 26;

  /*
   * Layout is deliberately partitioned so nothing can overlap:
   *
   *   [ PLOT_LEFT .. PLOT_RIGHT ]  the true -1 .. +1 plot, zero centred
   *   [ VALUE_COLUMN_X .. width ]  a dedicated, left-aligned value column
   *
   * The row label sits ABOVE its bar rather than beside it, so a bar growing
   * leftwards towards -1 can never run into its own label. The signed value is
   * always written in the fixed right-hand column, so a positive and a negative
   * coefficient are read from the same place and a bar can never sit under its
   * own readout.
   */
  const PLOT_LEFT = 8;
  const PLOT_RIGHT = 232;
  const VALUE_COLUMN_X = 240;
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const zeroX = PLOT_LEFT + plotWidth / 2;
  const halfWidth = plotWidth / 2;
  const plotBottom = plotTop + rowHeight * entries.length;

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

  return (
    <section className="research-panel" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Pearson Correlations</h2>
      <p className="research-panel-note">
        Pearson coefficients for the three research-variable pairs, each using
        only the participants who have values for both variables. The sign is
        printed on every bar, so direction is never conveyed by colour or bar
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
        note="Selecting a single exposure level makes Training Exposure constant, so the two exposure relationships become undefined by definition."
      >
        <ChartPlot>
          <svg
            className="research-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${plotBottom + 6}`}
            role="img"
            aria-label={`Diverging bar chart of Pearson correlation coefficients from minus one to plus one. ${described
              .map(
                (entry) =>
                  `${entry.label}: ${
                  entry.availability.state === METRIC_AVAILABILITY.available
                    ? formatSignedCoefficient(entry.relationship.r)
                    : entry.availability.message
                }`
            )
            .join(". ")}.`}
        >
          <line
            className="research-chart-axis"
            x1={PLOT_LEFT}
            y1={plotTop - 10}
            x2={PLOT_LEFT}
            y2={plotBottom}
          />
          <line
            className="research-chart-axis"
            x1={PLOT_RIGHT}
            y1={plotTop - 10}
            x2={PLOT_RIGHT}
            y2={plotBottom}
          />
          <line
            className="research-chart-zero"
            x1={zeroX}
            y1={plotTop - 10}
            x2={zeroX}
            y2={plotBottom}
          />

          <text
            className="research-chart-tick"
            x={PLOT_LEFT}
            y={plotTop - 14}
            textAnchor="start"
            fontSize={LABEL_FONT_SIZE}
          >
            -1
          </text>
          <text
            className="research-chart-tick"
            x={zeroX}
            y={plotTop - 14}
            textAnchor="middle"
            fontSize={LABEL_FONT_SIZE}
          >
            0
          </text>
          <text
            className="research-chart-tick"
            x={PLOT_RIGHT}
            y={plotTop - 14}
            textAnchor="end"
            fontSize={LABEL_FONT_SIZE}
          >
            +1
          </text>
          <text
            className="research-chart-tick"
            x={VALUE_COLUMN_X}
            y={plotTop - 14}
            textAnchor="start"
            fontSize={LABEL_FONT_SIZE}
          >
            r
          </text>

          {described.map((entry, index) => {
            const rowTop = plotTop + index * rowHeight;
            // The row label sits above the bar with clear descender clearance,
            // so a left-growing bar can never reach it.
            const barY = rowTop + 20;
            const barHeight = 12;
            const isAvailable =
              entry.availability.state === METRIC_AVAILABILITY.available;
            const coefficient = entry.relationship.r;
            const valueText = isAvailable
              ? formatSignedCoefficient(coefficient)
              : null;
            const barWidth =
              isAvailable && coefficient !== 0
                ? Math.max(Math.abs(coefficient) * halfWidth, 2)
                : 0;
            const barX =
              coefficient > 0 ? zeroX : zeroX - barWidth;

            return (
              <g key={entry.key}>
                <text
                  className="research-chart-row-label"
                  x={PLOT_LEFT}
                  y={barY - 6}
                  fontSize={LABEL_FONT_SIZE}
                >
                  {entry.shortLabel}
                </text>

                {isAvailable ? (
                  <>
                    {coefficient !== 0 ? (
                      <rect
                        className="research-chart-bar"
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={barHeight}
                        rx={3}
                      />
                    ) : null}
                    {/* Fixed column, left aligned: identical x for every row,
                        so positive and negative values are read in one place
                        and the value can never overlap its own bar. */}
                    <text
                      className="research-chart-value"
                      x={VALUE_COLUMN_X}
                      y={barY + barHeight}
                      textAnchor="start"
                      fontSize={VALUE_FONT_SIZE}
                    >
                      {valueText}
                    </text>
                  </>
                ) : (
                  <text
                    className="research-chart-reason"
                    x={PLOT_LEFT}
                    y={barY + barHeight}
                    fontSize={LABEL_FONT_SIZE}
                  >
                    {entry.availability.message}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        </ChartPlot>

        <div className="research-table-scroll">
          <table className="research-stat-table">
            <caption className="research-table-caption">
              Pearson correlation coefficients and paired observation counts
            </caption>
            <thead>
              <tr>
                <th scope="col">Variables compared</th>
                <th scope="col">Paired n</th>
                <th scope="col">Pearson r</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {described.map((entry) => (
                <tr key={entry.key}>
                  <th scope="row">{entry.label}</th>
                  <td>{entry.relationship.n}</td>
                  <td>
                    {entry.availability.state === METRIC_AVAILABILITY.available
                      ? formatSignedCoefficient(entry.relationship.r)
                      : "Not available"}
                  </td>
                  <td>{entry.availability.message ?? "Reported"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartFrame>
    </section>
  );
}
