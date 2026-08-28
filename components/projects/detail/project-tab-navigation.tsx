"use client";

import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  CalendarCheck,
  CreditCard,
  Wrench,
  FileText,
  History,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { ProjectDetail } from "@/types/project";
import { useCallback, useMemo, useRef } from "react";
import { ProjectDetailTabKey } from "@/utils/validators/projects";

/**
 * The tabs that are actually navigable. `projectTabsValidator` still accepts
 * `materials`, `updates`, `workers` and `variations` because those tab bodies
 * exist, but they were deliberately hidden (commit 230c35e) as unfinished
 * surfaces. This list is the single source of truth for what a user can reach,
 * and `project-detail-tabs.tsx` narrows the URL parameter against it so a
 * hidden key can no longer render a panel with no way back.
 */
export const VISIBLE_PROJECT_DETAIL_TABS = [
  "overview",
  "milestones",
  "payments",
  "tradies",
  "docs",
  "history",
  "communications",
  "compliance",
] as const satisfies readonly ProjectDetailTabKey[];

export type VisibleProjectDetailTabKey =
  (typeof VISIBLE_PROJECT_DETAIL_TABS)[number];

export function isVisibleProjectDetailTab(
  value: string,
): value is VisibleProjectDetailTabKey {
  return (VISIBLE_PROJECT_DETAIL_TABS as readonly string[]).includes(value);
}

export const projectTabTriggerId = (key: VisibleProjectDetailTabKey) =>
  `project-tab-${key}`;
export const projectTabPanelId = (key: VisibleProjectDetailTabKey) =>
  `project-tabpanel-${key}`;

const TabIcons: Record<VisibleProjectDetailTabKey, React.ElementType> = {
  overview: LayoutGrid,
  milestones: CalendarCheck,
  payments: CreditCard,
  tradies: Wrench,
  history: History,
  docs: FileText,
  communications: Mail,
  // Pairs with the ShieldAlert the compliance banner above the tabs already
  // uses: the same subject, one warning about it and one holding it.
  compliance: ShieldCheck,
};

type BadgeTone = "primary" | "warning" | "danger" | "neutral";

/**
 * The badge is one value, not three loose fields.
 *
 * As separate optionals, a tab could carry `badge` without `badgeDescription`
 * and still typecheck — and the render emitted `<span class="sr-only">
 * {undefined}</span>`, so the bare number reached screen readers with nothing
 * explaining it. Grouping them makes the description structurally impossible to
 * omit, and `tone` explicit rather than silently defaulting.
 */
type TabBadge = {
  count: string;
  tone: BadgeTone;
  /** Spells out what the bare number means for screen readers. */
  description: string;
};

type ProjectDetailTab = {
  key: VisibleProjectDetailTabKey;
  label: string;
  badge?: TabBadge;
  isAdminOnly?: boolean;
};

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  primary: "bg-primary/15 text-primary",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
  neutral: "bg-muted text-muted-foreground",
};

const BLOCKED_TRADIE_STATUSES = new Set(["NO_RESPONSE", "DECLINED"]);
const AWAITING_TRADIE_STATUSES = new Set([
  "PENDING",
  "PENDING_RESPONSE",
  "AWAITING_QUOTE",
]);

const calcMilestoneOverviewData = (milestones: ProjectDetail["milestones"]) => {
  const stageMilestoneMap = new Map<
    string,
    { completed: number; total: number }
  >();
  for (const milestone of milestones) {
    const stage = milestone.projectStage;
    if (!stageMilestoneMap.has(stage)) {
      stageMilestoneMap.set(stage, { completed: 0, total: 0 });
    }
    const stageData = stageMilestoneMap.get(stage)!;
    stageData.total++;
    if (milestone.status === "DONE" || milestone.status === "NOT_REQUIRED") {
      stageData.completed++;
    }
  }
  const totalStages = stageMilestoneMap.size;
  const completedStages = Array.from(stageMilestoneMap.values()).filter(
    (stageData) => stageData.completed === stageData.total,
  ).length;
  return {
    totalStages,
    completedStages,
  };
};

/**
 * What the Compliance badge counts.
 *
 * Anything not yet approved is outstanding — that is the whole job of the tab.
 * A rejected document is counted separately only to pick the tone: it has
 * already been round-tripped past the certifier once, which is a sharper
 * problem than a document nobody has supplied yet.
 *
 * Silent until an engagement exists, so a project nobody has started this on
 * does not wear a badge for it.
 */
const calcComplianceOverviewData = (
  engagement: ProjectDetail["certifierEngagement"],
) => {
  if (!engagement) {
    return { outstanding: 0, rejected: 0 };
  }
  let outstanding = 0;
  let rejected = 0;
  for (const document of engagement.documents) {
    if (document.status !== "APPROVED") {
      outstanding += 1;
    }
    // A rejection reason survives the status going back to PENDING — that is
    // what tells the admin why they are uploading again, and it is the only
    // trace that this document has been round-tripped.
    if (document.status === "REJECTED" || document.rejectionReason) {
      rejected += 1;
    }
  }
  return { outstanding, rejected };
};

const generateProjectDetailTabs = (
  project: ProjectDetail,
): ProjectDetailTab[] => {
  const {
    totalStages: projectStagesCount,
    completedStages: completedStagesCount,
  } = calcMilestoneOverviewData(project.milestones);
  const blockedTradies = project.tradieSchedules.filter((schedule) =>
    BLOCKED_TRADIE_STATUSES.has(schedule.status),
  ).length;
  const awaitingTradies = project.tradieSchedules.filter((schedule) =>
    AWAITING_TRADIE_STATUSES.has(schedule.status),
  ).length;
  const tradieAlerts = blockedTradies + awaitingTradies;
  const { outstanding: outstandingCompliance, rejected: rejectedCompliance } =
    calcComplianceOverviewData(project.certifierEngagement);

  return [
    { key: "overview", label: "Overview" },
    {
      key: "milestones",
      label: "Milestones",
      ...(projectStagesCount - completedStagesCount > 0
        ? {
            badge: {
              count: (projectStagesCount - completedStagesCount).toString(),
              tone: "primary",
              description: `${projectStagesCount - completedStagesCount} milestones remaining`,
            } satisfies TabBadge,
          }
        : {}),
    },
    // { key: "payments", label: "Payments", isAdminOnly: true },
    {
      key: "tradies",
      label: "Tradies",
      ...(tradieAlerts > 0
        ? {
            badge: {
              count: tradieAlerts.toString(),
              // Declined or unanswered requests are blocked work; requests still
              // inside their response window are merely open.
              tone: blockedTradies > 0 ? "danger" : "neutral",
              description:
                blockedTradies > 0
                  ? `${tradieAlerts} tradie requests unresolved, ${blockedTradies} declined or unanswered`
                  : `${tradieAlerts} tradie requests awaiting a response`,
            } satisfies TabBadge,
          }
        : {}),
    },
    { key: "docs", label: "Documents" },
    {
      key: "compliance",
      label: "Compliance",
      ...(outstandingCompliance > 0
        ? {
            badge: {
              count: outstandingCompliance.toString(),
              // A rejected document is work the certifier has already sent
              // back, which is a different urgency from one nobody has
              // supplied yet.
              tone: rejectedCompliance > 0 ? "danger" : "warning",
              description:
                rejectedCompliance > 0
                  ? `${outstandingCompliance} compliance documents outstanding, ${rejectedCompliance} sent back by the certifier`
                  : `${outstandingCompliance} compliance documents outstanding`,
            } satisfies TabBadge,
          }
        : {}),
    },
    { key: "history", label: "History" },
    { key: "communications", label: "Communications" },
  ];
};

export function ProjectTabNavigation({
  isAdmin,
  project,
  activeTab,
  onTabChange,
}: {
  isAdmin: boolean;
  project: ProjectDetail;
  activeTab: VisibleProjectDetailTabKey;
  onTabChange: (tab: VisibleProjectDetailTabKey) => void;
}) {
  const projectDetailTabs = useMemo(
    () => generateProjectDetailTabs(project),
    [project],
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusTab = useCallback(
    (tab: ProjectDetailTab) => {
      onTabChange(tab.key);
      tabRefs.current[tab.key]?.focus();
    },
    [onTabChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = projectDetailTabs.findIndex(
        (tab) => tab.key === activeTab,
      );
      if (currentIndex === -1) return;

      const last = projectDetailTabs.length - 1;
      let nextIndex: number | null = null;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex === last ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex === 0 ? last : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = last;
          break;
        default:
          return;
      }

      event.preventDefault();
      focusTab(projectDetailTabs[nextIndex]);
    },
    [activeTab, focusTab, projectDetailTabs],
  );

  return (
    // Wrapping rather than horizontally scrolling: a scroll container with a
    // hidden scrollbar gave no affordance that further tabs existed.
    <div
      role="tablist"
      aria-label="Project sections"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className="mb-5 flex flex-wrap gap-x-1 border-b-2 border-border/60"
    >
      {projectDetailTabs.map((tab) => {
        const Icon = TabIcons[tab.key];
        const isActive = activeTab === tab.key;
        if (tab.isAdminOnly && !isAdmin) {
          return null;
        }

        return (
          <button
            key={tab.key}
            ref={(node) => {
              tabRefs.current[tab.key] = node;
            }}
            type="button"
            role="tab"
            id={projectTabTriggerId(tab.key)}
            aria-selected={isActive}
            aria-controls={projectTabPanelId(tab.key)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "relative -mb-0.5 inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isActive && "border-primary font-semibold text-primary",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{tab.label}</span>
            {tab.badge ? (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium leading-none",
                    BADGE_TONE_CLASS[tab.badge.tone],
                  )}
                >
                  {tab.badge.count}
                </span>
                <span className="sr-only">{tab.badge.description}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
