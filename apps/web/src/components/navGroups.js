/*
 * Shared primary-navigation definition for the authenticated shell.
 *
 * Consumed by both the desktop sidebar and the mobile drawer so the two
 * navigation surfaces can never drift apart. Role gating here is a
 * usability control only; the backend remains the security boundary.
 *
 * Scanner and History remain part of the Dashboard and link to the existing
 * Dashboard anchors. No /scanner or /history routes are introduced.
 *
 * Phase 1A-1: Scanner and History declare `parent` so both navigation
 * surfaces can present them as subsections of the Dashboard rather than as
 * independent pages. A subsection stays in its own group, so the DETECT
 * grouping is unchanged and no expand/collapse affordance is implied.
 */

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      {
        to: "/dashboard",
        label: "Dashboard",
        basePath: "/dashboard"
      }
    ]
  },
  {
    label: "Detect",
    items: [
      {
        to: "/dashboard#scanner",
        label: "Scanner",
        basePath: "/dashboard",
        hash: "scanner",
        parent: "/dashboard"
      },
      {
        to: "/dashboard#history",
        label: "History",
        basePath: "/dashboard",
        hash: "history",
        parent: "/dashboard"
      }
    ]
  },
  {
    label: "Learn",
    items: [
      { to: "/awareness", label: "Awareness" },
      {
        to: "/phishing-identification",
        label: "Phishing Identification"
      },
      { to: "/training", label: "Training" },
      { to: "/progress", label: "Progress" }
    ]
  },
  {
    label: "Report",
    items: [
      { to: "/reports", label: "Reports" },
      {
        to: "/review",
        label: "IT Review",
        roles: ["staff", "admin"]
      }
    ]
  },
  {
    label: "Research",
    items: [
      {
        to: "/research",
        label: "Research",
        // Phase 1A-2-1: the navigation label stays short while the
        // top-header title is descriptive. Declared here rather than in a
        // separate table so the two cannot drift.
        pageTitle: "Research Analytics",
        roles: ["admin"]
      }
    ]
  },
  {
    label: "Account",
    items: [{ to: "/profile", label: "Profile" }]
  }
];

function matchesPath(item, pathname) {
  if (item.basePath) {
    return pathname === item.basePath;
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/*
 * Phase 1A-2-1: top-header titles for routes that have no navigation item of
 * their own.
 *
 * Ordinary pages are not listed here. Their titles resolve from the
 * navigation label, or from an explicit `pageTitle` when the header is meant
 * to read differently, so the two surfaces share one source of truth.
 *
 * Order matters: the first matching entry wins, so the more specific
 * /reports/new/:analysisId is listed before the generic /reports/:reportId.
 */
const DETAIL_ROUTE_TITLES = [
  { path: "/reports/new", segments: 3, title: "Report to school IT" },
  { path: "/reports", segments: 2, title: "Report detail" },
  { path: "/review", segments: 2, title: "IT Review detail" }
];

const DEFAULT_PAGE_TITLE = "PhishGuard";

/*
 * Resolves the top-header title for a pathname.
 *
 * Segment-count matching is used deliberately so that unrelated paths with a
 * shared prefix are never confused with a route: "/reports-new" is not a
 * "/reports" sub-route, and "/reviewer" is not a "/review" sub-route.
 *
 * Role visibility is intentionally not applied here. Route access is already
 * enforced by ProtectedRoute, so this resolver only reports what a page calls
 * itself.
 */
function getPageTitle(pathname) {
  if (typeof pathname !== "string" || pathname === "") {
    return DEFAULT_PAGE_TITLE;
  }

  const normalized = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const segmentCount = normalized.split("/").filter(Boolean).length;

  for (const route of DETAIL_ROUTE_TITLES) {
    if (
      segmentCount === route.segments &&
      (normalized === route.path || normalized.startsWith(`${route.path}/`))
    ) {
      return route.title;
    }
  }

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      // A subsection is a location within a page, not a page title. The
      // Dashboard owns the header while Scanner or History is selected.
      if (item.hash) {
        continue;
      }

      if (matchesPath(item, normalized)) {
        return item.pageTitle || item.label;
      }
    }
  }

  return DEFAULT_PAGE_TITLE;
}

/*
 * True when this entry is the exact destination for the current location.
 *
 * For a Dashboard subsection that means the matching fragment is present, so
 * only one entry is ever the exact destination.
 */
function isItemActive(item, pathname, hash) {
  if (item.basePath) {
    return matchesPath(item, pathname) && (item.hash ? hash === `#${item.hash}` : hash === "");
  }

  return matchesPath(item, pathname);
}

/*
 * True when the page this entry belongs to is the current page, regardless
 * of any fragment.
 *
 * This keeps Dashboard marked as the current page while Scanner or History
 * is selected. Subsection entries report their own page too, so consumers
 * combine the two results rather than relying on this alone.
 */
function isSectionActive(item, pathname) {
  return matchesPath(item, pathname);
}

function getVisibleGroups(role) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || item.roles.includes(role)
    )
  })).filter((group) => group.items.length > 0);
}

/*
 * Presentation helpers shared by the sidebar and the mobile drawer, so the
 * two navigation surfaces cannot disagree about the current location.
 */
function getNavClassName(item, pathname, hash) {
  const current = isItemActive(item, pathname, hash);
  const section = isSectionActive(item, pathname);

  let state = "idle";

  if (current && item.hash) {
    state = "subsection";
  } else if (current) {
    state = "current";
  } else if (section && !item.hash) {
    state = "parent";
  }

  if (state === "idle") {
    return "nav-item";
  }

  const classNames = ["nav-item", `nav-item-${state}`];

  if (item.parent) {
    classNames.push("nav-item-child");
  }

  return classNames.join(" ");
}

/*
 * A subsection reports the fragment it currently shows. A top-level entry
 * reports that it is the current page, including while one of its
 * subsections is selected.
 */
function getAriaCurrent(item, pathname, hash) {
  if (isItemActive(item, pathname, hash)) {
    return item.hash ? "location" : "page";
  }

  if (!item.hash && isSectionActive(item, pathname)) {
    return "page";
  }

  return undefined;
}

export {
  getAriaCurrent,
  getNavClassName,
  getPageTitle,
  getVisibleGroups,
  isItemActive,
  isSectionActive
};
