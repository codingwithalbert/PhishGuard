/*
 * Shared primary-navigation definition for the authenticated shell.
 *
 * Consumed by both the desktop sidebar and the mobile drawer so the two
 * navigation surfaces can never drift apart. Role gating here is a
 * usability control only; the backend remains the security boundary.
 *
 * Scanner and History remain part of the Dashboard and link to the existing
 * Dashboard anchors. No /scanner or /history routes are introduced.
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
        hash: "scanner"
      },
      {
        to: "/dashboard#history",
        label: "History",
        basePath: "/dashboard",
        hash: "history"
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

function isItemActive(item, pathname, hash) {
  if (item.basePath) {
    return (
      pathname === item.basePath &&
      (item.hash ? hash === `#${item.hash}` : hash === "")
    );
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function getVisibleGroups(role) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || item.roles.includes(role)
    )
  })).filter((group) => group.items.length > 0);
}

export { getVisibleGroups, isItemActive };
