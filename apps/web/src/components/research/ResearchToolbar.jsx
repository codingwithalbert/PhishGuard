/*
 * Research Analytics V2 control bar.
 *
 * Filtering and export sit together so their different scopes are stated in one
 * place: the filter is applied on the server to every value on the page, while
 * the CSV always covers the whole eligible cohort. The filter markup and request
 * behaviour remain owned by ExposureLevelFilter.
 */
import { Link } from "react-router-dom";
import ExposureLevelFilter from "./ExposureLevelFilter";

export default function ResearchToolbar({
  id,
  levels,
  selectedLevel,
  onLevelChange,
  available,
  loading,
  stale,
  cohortSize,
  scopeLabel,
  exporting,
  exportError,
  exportNeedsSignIn,
  onExport
}) {
  return (
    <section className="research-toolbar" aria-labelledby={`${id}-heading`}>
      <div className="research-toolbar-main">
        <div className="research-toolbar-heading-row">
          <h2 id={`${id}-heading`}>Cohort view</h2>
          <p className="research-scope-line" aria-live="polite">
            Current scope: <strong>{scopeLabel}</strong>
          </p>
        </div>

        <ExposureLevelFilter
          id={id}
          levels={levels}
          selectedLevel={selectedLevel}
          onChange={onLevelChange}
          available={available}
          loading={loading}
          stale={stale}
          cohortSize={cohortSize}
        />
      </div>

      <div className="research-toolbar-export">
        <span className="research-toolbar-label">Dataset export</span>

        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          aria-busy={exporting}
        >
          {exporting ? "Preparing export..." : "Export CSV"}
        </button>

        <p className="research-export-rule">
          Exports the whole eligible cohort. The on-screen filter does not
          change the file.
        </p>

        {exporting && (
          <p className="awareness-status" role="status" aria-live="polite">
            Downloading the research dataset...
          </p>
        )}

        {exportError && (
          <div className="research-export-error" role="alert">
            <p>{exportError.message}</p>

            {exportNeedsSignIn ? (
              <p>
                <Link to="/login">Sign in again</Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
