/*
 * Analytics Visualization V1 Training Exposure filter.
 *
 * A native select, so keyboard operation, screen-reader announcement, and
 * platform behaviour come from the browser rather than from custom key
 * handling. Option labels are derived from the canonical levels the backend
 * publishes in `methodology.trainingExposureLevels`; no percentage value is
 * hard-coded here.
 *
 * The control is rendered only once that metadata is available, which is why
 * it cannot trigger the very first request. That is deliberate: the initial
 * load reproduces the pre-existing unfiltered behaviour exactly.
 */
import { buildExposureLevelOptions } from "./researchChartUi";

export const ALL_EXPOSURE_LEVEL = "all";

function ExposureLevelFilter({
  id,
  levels,
  selectedLevel,
  onChange,
  available,
  loading,
  cohortSize,
  stale
}) {
  const options = buildExposureLevelOptions(levels);
  const isFiltered = available && selectedLevel !== ALL_EXPOSURE_LEVEL;

  // Before the first successful response there are no canonical levels to offer,
  // so the control renders disabled with an honest explanation rather than
  // leaving a titled panel with nothing in it.
  const hint = !available
    ? loading
      ? "Loading Training Exposure levels..."
      : "Training Exposure levels are unavailable. Retry to load the filter."
    : isFiltered
      ? `Showing ${cohortSize} participant(s) in the selected exposure cohort. Every count, chart and statistic on this page describes that cohort only.`
      : "Showing the entire eligible cohort of active user accounts. Choose a level to scope the page to one exposure cohort.";

  return (
    <div className="research-filter">
      <div className="research-filter-field">
        <label htmlFor={id}>Training Exposure</label>
        <select
          id={id}
          value={selectedLevel}
          onChange={(event) => onChange(event.target.value)}
          disabled={!available}
          aria-describedby={`${id}-hint`}
        >
          <option value={ALL_EXPOSURE_LEVEL}>
            All — entire eligible cohort
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p id={`${id}-hint`} className="research-filter-hint">
        {hint}
      </p>

      {/*
        While a new selection is in flight the figures on the page still belong
        to the previous selection. Saying so prevents a stale-looking chart from
        being read as the answer to the level currently shown in the select.
      */}
      {stale ? (
        <p className="research-filter-pending" role="status">
          Updating analytics for the selected level...
        </p>
      ) : null}
    </div>
  );
}

export default ExposureLevelFilter;
