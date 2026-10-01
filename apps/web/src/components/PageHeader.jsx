/*
 * Shared page-title structure for authenticated pages.
 *
 * One clear h1, an optional description, and optional contextual actions.
 * Visually replaces the former per-page intro sections without changing
 * their presentation during the Stage 1 migration.
 */
import useEntranceMotion from "../hooks/useEntranceMotion";

function PageHeader({ title, description, actions, motion = false }) {
  const entranceRef = useEntranceMotion({
    selector: ".page-header-text",
    enabled: motion,
    activationKey: title,
    offset: 6
  });

  return (
    <header className="page-header" ref={entranceRef}>
      <div className="page-header-text">
        <h1 className="page-header-title">{title}</h1>
        {description ? (
          <div className="page-header-description">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="page-header-actions">{actions}</div>
      ) : null}
    </header>
  );
}

export default PageHeader;
