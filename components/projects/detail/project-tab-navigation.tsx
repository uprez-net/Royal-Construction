"use client";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import {
  isNotRequired,
  isOutstandingEvidence,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { cn } from "@/lib/utils";
import { countPendingInvoices } from "@/lib/projects/invoice-display";
import { calcStageProgress } from "@/lib/projects/stage-progress";
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

type ComplianceOverview = {
  outstanding: number;
  /**
   * How many of those the certifier has already sent back. Counted apart from
   * the total only to pick the tone: a document that has been round-tripped
   * once is a sharper problem than one nobody has got to yet.
   */
  rejected: number;
  /** Spells the bare number out. Only this knows what it just counted. */
  description: string;
};

/** Waiting on the certifier, or finished. Either way, no prompt to show. */
const NOTHING_OUTSTANDING: ComplianceOverview = {
  outstanding: 0,
  rejected: 0,
  description: "",
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the Compliance badge counts.
 *
 * Whatever the engagement is actually waiting on, which changes as it moves.
 * One count across every document said nothing useful: only checklist evidence
 * is ever approved, so "not approved" left the required pack, the signed copies
 * and the certifier's own invoice outstanding for ever, and a badge still
 * reading twelve on a closed engagement is one nobody looks at twice.
 *
 * Three phases, the same three the tab itself walks through — collect the pack,
 * supply the checklist the certifier issued, then work the review round. The
 * stretches between them, where the ball is with the certifier or with a
 * running extraction, show nothing at all: a badge is a prompt to go and do
 * something, and there is nothing there to do.
 *
 * Silent until an engagement exists, so a project nobody has started this on
 * does not wear a badge for it.
 */
const calcComplianceOverviewData = (
  engagement: ProjectDetail["certifierEngagement"],
): ComplianceOverview => {
  if (!engagement) {
    return NOTHING_OUTSTANDING;
  }

  // Counted against the canonical lists rather than the seeded rows, so a type
  // that never got a row still reads as missing instead of silently passing.
  const supplied = new Set(
    engagement.documents
      .filter((document) => document.files.length > 0)
      .map((document) => document.documentType),
  );
  const stillMissing = (types: readonly ComplianceDocumentType[]) =>
    types.filter((type) => !supplied.has(type)).length;

  const checklist = engagement.documents.filter(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  switch (engagement.status) {
    // Assembling the pack that opens the engagement.
    case CertifierEngagementStatus.NOT_STARTED:
    case CertifierEngagementStatus.COLLECTING_DOCS: {
      const outstanding = stillMissing(
        REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
      );
      return {
        outstanding,
        rejected: 0,
        description: `${plural(outstanding, "required document", "required documents")} still to collect`,
      };
    }

    // The certifier has answered and wants their own forms back signed. Both
    // have to land before they will issue a checklist, so this is real work
    // sitting with the builder rather than a wait.
    case CertifierEngagementStatus.RESPONSE_RECEIVED: {
      const outstanding = stillMissing(
        SIGNED_COPY_DOCUMENTS.map((copy) => copy.type),
      );
      return {
        outstanding,
        rejected: 0,
        description: `${plural(outstanding, "signed copy", "signed copies")} still to upload`,
      };
    }

    // The checklist is live: one document per line the certifier asked for.
    //
    // The insurance certificate is not counted alongside them. It is only
    // raised once the checklist is whole, and answering "no" to the question
    // means there is no certificate to supply — counting it would leave a badge
    // that cannot be cleared.
    case CertifierEngagementStatus.CHECKLIST_TRACKING:
    case CertifierEngagementStatus.INSURANCE: {
      // A line marked as not applying to this job is answered, not missing.
      // Counting it left a badge on the tab that nobody could ever clear.
      const outstanding = checklist.filter(isOutstandingEvidence).length;
      return {
        outstanding,
        rejected: 0,
        description: `${plural(outstanding, "checklist item", "checklist items")} still to supply`,
      };
    }

    // With the certifier. What is left is what they have not passed, and a
    // rejection is the part of it somebody has to act on today — the reason
    // survives the status going back to PENDING, and is the only trace that an
    // item has been round-tripped.
    case CertifierEngagementStatus.IN_REVIEW: {
      const unresolved = checklist.filter(
        (document) =>
          document.status !== ComplianceDocumentStatus.APPROVED &&
          !isNotRequired(document.status),
      );
      const rejected = unresolved.filter(
        (document) =>
          document.status === ComplianceDocumentStatus.REJECTED ||
          document.rejectionReason,
      ).length;
      return {
        outstanding: unresolved.length,
        rejected,
        description:
          rejected > 0
            ? `${plural(unresolved.length, "checklist item", "checklist items")} still to clear, ${rejected} sent back by the certifier`
            : `${plural(unresolved.length, "checklist item", "checklist items")} awaiting the certifier's decision`,
      };
    }

    // OUTREACH_SENT and AWAITING_RESPONSE are waiting on a reply; SIGNING is
    // waiting on the checklist; CHECKLIST_EXTRACTING is a workflow mid-run; and
    // APPROVED is done. None of them is a thing to nag anyone about.
    default:
      return NOTHING_OUTSTANDING;
  }
};

const generateProjectDetailTabs = (
  project: ProjectDetail,
): ProjectDetailTab[] => {
  const {
    totalStages: projectStagesCount,
    completedStages: completedStagesCount,
  } = calcStageProgress(project.milestones);
  const blockedTradies = project.tradieSchedules.filter((schedule) =>
    BLOCKED_TRADIE_STATUSES.has(schedule.status),
  ).length;
  const awaitingTradies = project.tradieSchedules.filter((schedule) =>
    AWAITING_TRADIE_STATUSES.has(schedule.status),
  ).length;
  const tradieAlerts = blockedTradies + awaitingTradies;
  const compliance = calcComplianceOverviewData(project.certifierEngagement);
  // One reference date for the whole calculation — see `invoice-display`.
  const { pending: pendingInvoices, overdue: overdueInvoices } =
    countPendingInvoices(project.invoices, new Date());

  return [
    { key: "overview", label: "Overview" },
    {
      key: "compliance",
      label: "Compliance",
      ...(compliance.outstanding > 0
        ? {
            badge: {
              count: compliance.outstanding.toString(),
              // A rejected document is work the certifier has already sent
              // back, which is a different urgency from one nobody has
              // supplied yet.
              tone: compliance.rejected > 0 ? "danger" : "warning",
              // Written by the counter, because what the number means depends
              // on which phase it counted.
              description: compliance.description,
            } satisfies TabBadge,
          }
        : {}),
    },
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
    {
      key: "payments",
      label: "Payments",
      isAdminOnly: true,
      ...(pendingInvoices > 0
        ? {
            badge: {
              count: pendingInvoices.toString(),
              // An unpaid claim is routine; one past its due date is a debt
              // somebody needs to chase.
              tone: overdueInvoices > 0 ? "warning" : "primary",
              description:
                overdueInvoices > 0
                  ? `${pendingInvoices} unpaid invoices, ${overdueInvoices} overdue`
                  : `${pendingInvoices} unpaid invoices`,
            } satisfies TabBadge,
          }
        : {}),
    },
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
