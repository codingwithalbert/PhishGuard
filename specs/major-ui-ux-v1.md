# Major UI/UX V1 Specification

## Spec Status

This specification freezes the approved Major UI/UX V1 design direction and
behavioral boundaries for PhishGuard.

Implementation details may evolve where necessary, but changes to the frozen
product/behavioral boundaries defined here require explicit approval.

---

## 1. Purpose

PhishGuard is a school phishing awareness, detection, and incident-reporting
platform.

Product lifecycle:

Learn -> Identify -> Analyze -> Report -> IT Investigates -> Resolve -> Learn

Three product pillars:

1. Prevention & Education
2. Detection & Understanding
3. Incident Reporting & Response

Major UI/UX V1 is a **frontend redesign only**. It must not redefine product
behavior.

---

## 2. Approved Visual Direction

Retain and refine the existing dark navy/cyan identity.

Desired qualities:

- Professional
- Trustworthy
- Modern
- Calm
- Security-oriented
- Readable
- Approachable for students
- Efficient for school IT staff/admins

The redesign should improve:

- Information hierarchy
- Typography
- Spacing
- Layout
- Navigation
- Responsive behavior
- Consistency
- Interaction states
- Accessibility
- Operational scanability

### Avoid

- Hacker-terminal aesthetics
- Neon cyberpunk
- Matrix styling
- Excessive glow or gradients
- Crypto/gaming dashboard aesthetics
- Generic admin-template appearance
- Marketing-page styling inside the authenticated application
- Unnecessary animation
- Excessive metrics
- Gamification, XP, streaks, rankings, leaderboards, achievement badges
- Excessive nested bordered cards
- Abstractions/components created only to imitate a design system

The design skills (`design-taste-frontend`, `impeccable`) may guide
implementation and critique, but their generic recommendations do not override
PhishGuard project rules, frozen specifications, or existing behavior.

---

## 3. Approved Application Shell

### Authenticated Desktop Experience

- Persistent grouped left sidebar on sufficiently wide screens
- Compact top header
- Main workspace
- Clear page title strategy
- Explicit active navigation state

### Approved Navigation Grouping

```
OVERVIEW
  Dashboard

DETECT
  Scanner
  History

LEARN
  Awareness
  Phishing Identification
  Training
  Progress

REPORT
  Reports
  IT Review (staff/admin only)

RESEARCH
  Research (admin only)

ACCOUNT
  Profile
```

Scanner and History remain part of Dashboard in Major UI/UX V1. They may be
represented in sidebar navigation using the existing Dashboard anchors
(`#scanner`, `#history`).

Do NOT introduce `/scanner` or `/history` routes during this redesign.

### Logout Placement

- Desktop: bottom of sidebar
- Mobile/small-screen: inside mobile navigation

Frontend role-based navigation remains UX only. Backend authorization remains
the security boundary.

---

## 4. Responsive Navigation

Do not use the current wrapped desktop link list as the final mobile model.

Use:

- Persistent sidebar on sufficiently wide screens
- Mobile/drawer navigation below the chosen breakpoint

Do NOT introduce a separate icon-only tablet navigation mode unless actual
implementation constraints demonstrate a need.

Prefer transitioning from the full desktop shell to the compact mobile/drawer
model.

### Mobile Navigation Requirements

- Keyboard operation
- Visible focus
- Escape-to-close where applicable
- Focus return after closing
- Appropriate `aria-expanded` / navigation labeling
- Adequate touch targets

---

## 5. Design Foundation

Use semantic CSS custom properties for:

- Application background
- Surfaces
- Elevated/sunken surfaces where genuinely useful
- Borders/dividers
- Primary/secondary/muted text
- Primary accent
- Focus
- Informational state
- Success
- Warning
- Danger
- Heuristic LOW/MEDIUM/HIGH presentation

Keep risk communication accessible and non-color-only.

Establish a deliberate:

- Typography hierarchy
- Spacing scale
- Restrained radius scale
- Border/elevation hierarchy
- Focus-visible treatment
- Hover/active/disabled treatment
- Reduced-motion strategy

### Theme Scope

Dark theme only is in scope for V1.

Do not implement a light-theme toggle in this phase.

Semantic tokens should make future theming possible without requiring it now.

---

## 6. CSS Architecture

The existing large `index.css` should be migrated incrementally into a small,
purposeful CSS structure.

Do not require a framework.

Do not introduce:

- Tailwind
- Sass
- CSS-in-JS
- A component library

unless separately approved for a concrete need.

The exact final number of CSS files is not frozen.

Prefer logical concerns such as:

- Tokens/base
- Application layout
- Shared presentation
- Domain/page-specific presentation

Do not perform a risky all-at-once stylesheet rewrite. Pages not yet redesigned
must continue working during migration.

---

## 7. Component Architecture

### Approved High-Value Shared Architecture

- `AppShell`
- Sidebar
- Mobile navigation
- Compact top header
- `PageHeader` or equivalent shared page-title structure

### Component Creation Discipline

Additional shared components should be created only when actual repeated
presentation/behavior justifies them.

Do NOT build a large generic UI component library before redesigning pages.

Do NOT automatically create generic wrappers for every card, section, button,
error, loading state, table, or form field unless reuse clearly justifies the
abstraction.

Preserve domain concepts. Existing reusable reporting components should remain
unless there is a clear design reason to evolve them.

### Assessment Components

Awareness and Phishing Identification should remain independently
understandable. Do not force them into a shared `AssessmentForm` solely because
their structures are similar.

### ReviewReportDetail

- Extracting the IT Review action panel is approved when that page is redesigned
- Do not introduce a custom review hook merely to reduce line count
- Additional extraction requires a concrete maintainability or reuse benefit

---

## 8. Dashboard

Keep the existing Dashboard route and existing functionality.

### Approved Hierarchy

1. Compact page heading
2. Compact overview/summary information
3. Prominent URL scanner
4. Analysis result when present
5. Recent/history content

Keep the existing four useful summary areas, but make them more compact.

Do not invent new metrics. Do not add gamification.

Scanner and History remain accessible through the Dashboard and existing anchor
behavior.

The redesign may improve their presentation and hierarchy without changing
their product behavior.

---

## 9. Scanner / Analysis

The scanner remains a core product interaction.

### Preserve

- URL submission
- Loading
- Errors
- Saved analysis behavior
- Heuristic risk level
- Score
- Findings
- Indicators
- Defensive guidance
- History
- Deletion behavior
- Report-to-IT path

### Heuristic Communication

Automated URL analysis is heuristic.

The interface MUST NOT imply that:

- LOW = proven safe
- HIGH = confirmed phishing/malicious

Preserve explicit heuristic communication. Findings and indicators remain
explainability mechanisms.

Risk/status presentation must not depend on color alone.

Do not reintroduce `Analysis.status` controls to the frontend.

---

## 10. Education / Progress

Awareness, Phishing Identification, Training, and Progress should share a
coherent visual language while preserving their distinct purposes.

### Improve

- Instructions
- Question/scenario hierarchy
- Answer controls
- Completion/result presentation
- Module presentation
- Progress readability

Preserve all scoring and completion behavior.

Do not add XP, streaks, rankings, leaderboards, achievements, or competitive
comparisons.

---

## 11. Reporting / IT Review

Student reporting and staff/admin IT review should become easier to scan and
operate.

### Preserve

- Report creation
- Report list
- Report details
- Ticket identity
- Report workflow status
- Messaging
- Evidence
- IT priority
- Assignment
- Claim/start-review behavior
- Human assessment
- Completion
- Existing permissions

Automated analysis and human IT review MUST remain visually and conceptually
distinct.

Report workflow status MUST remain distinct from `Analysis.status`.

Do not expose internal database concepts.

ReviewReportDetail may be structurally decomposed during redesign where clear
component boundaries exist, especially the IT Review action panel.

Do not change the reporting workflow simply to make the UI easier to build.

---

## 12. Research Analytics

Research Analytics remains admin-only.

### Preserve

- Aggregate statistics
- Pearson correlations
- Missing-data handling
- Privacy protections
- Pseudonymous CSV export
- Interpretation boundaries

Do not imply:

- Causation
- Statistical significance
- Predictive validity
- Participant ranking or judgment

Responsive presentation may transform dense tables when necessary, but must not
change the meaning of the data.

---

## 13. Auth / Account

Login, Register, Forgot Password, Reset Password, Profile, and Change Password
should use a coherent visual family.

### Improve

- Trust
- Hierarchy
- Form width
- Labels
- Helper text
- Validation/error presentation
- Success presentation
- Focus states

Do not change authentication/session behavior, password-reset behavior, or
profile/change-password API behavior.

---

## 14. Accessibility

Major UI/UX V1 should improve:

- Semantic HTML
- Heading hierarchy
- Keyboard navigation
- Visible focus
- Form labels
- Form error association where appropriate
- Non-color-only risk/status communication
- Contrast
- Touch targets
- Readable line lengths
- Responsive text/layout
- Reduced-motion behavior
- Button vs. link semantics

Add a skip-to-main-content mechanism to the authenticated shell where
appropriate.

Do NOT claim WCAG compliance unless it has actually been verified. Do not add
statements such as "WCAG AA compliant" or equivalent solely because the redesign
follows accessibility practices.

---

## 15. Dependencies / Icons

Do not add an icon library during the foundation stage.

Prefer dependency-free, restrained icon treatment where icons materially
improve communication or accessibility.

If implementation later demonstrates a concrete need for an icon dependency,
stop and obtain approval before adding it.

---

## 16. Implementation Strategy

Implementation must remain incremental. Use approximately these major stages:

### Stage 1: Design Foundation + Application Shell

- Semantic tokens/base styling
- Authenticated shell
- Sidebar
- Mobile navigation
- Top header
- Page-title structure

### Stage 2: Dashboard + Scanner + History

- Hierarchy
- Scanner/result presentation
- History presentation

### Stage 3: Education + Progress

- Awareness
- Phishing Identification
- Training
- Progress

### Stage 4: Student Reporting

- Reports
- Report Create
- Report Detail

### Stage 5: IT Review + Research

- Review Queue
- Review Report Detail
- Research Analytics

### Stage 6: Auth + Account

- Login
- Register
- Forgot Password
- Reset Password
- Profile

### Stage 7: Responsive + Accessibility + Visual Polish

- Whole-frontend consistency
- Keyboard/focus review
- Responsive verification
- Visual critique using relevant Taste/Impeccable guidance

### Stage 8: Whole-Frontend Regression Verification

Responsive and accessibility considerations must also be addressed during each
stage rather than deferred entirely to Stage 7.

Do not rewrite the whole frontend at once.

---

## 17. Frozen Functional Boundaries

Major UI/UX V1 must not change unless separately approved:

- Backend behavior
- API contracts
- URL-analysis heuristics
- URL-analysis scores
- URL-analysis thresholds
- Findings logic
- Analysis History functionality
- `Analysis.status` backend compatibility
- Absence of normal `Analysis.status` frontend controls
- Automated-analysis vs. human-assessment separation
- Report workflow behavior
- Report workflow status semantics
- Role/authorization semantics
- Authentication/session behavior
- Password reset behavior
- Profile/change-password behavior
- Report email notification behavior
- Research Analytics calculations
- Research Analytics interpretation boundaries
- Pseudonymous research export design
- Existing security boundaries

Existing loading, error, empty, disabled, and success states must not be
silently removed during redesign.

---

## 18. Verification

Every implementation stage should at minimum run:

```powershell
cd apps\web
npm run lint
```

```powershell
cd apps\web
npm run build
```

Use separate PowerShell commands. Do not use `&&` or `||`.

Behaviorally significant stages also require manual verification of the affected
workflow before commit.

The final UI/UX stage requires regression verification across:

- Normal user
- Staff
- Admin

---

## 19. Definition of Done

Major UI/UX V1 is complete when:

- The authenticated shell uses the approved sidebar/header structure
- Responsive navigation works on desktop and mobile with full keyboard support
- All pages redesigned to the approved visual direction
- No frozen functional boundaries were violated
- Frontend lint and build pass
- Regression verification passes for all roles
- No new dependencies added without approval
- No backend or API contract changes
- `git diff --check` passes
