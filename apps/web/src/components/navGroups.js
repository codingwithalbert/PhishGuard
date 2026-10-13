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
  getVisibleGroups,
  isItemActive,
  isSectionActive
};
