"use client";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import {
  isNotRequired,
  isOutstandingEvidence,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { outreachRequiredDocuments } from "@/lib/domain/compliance/required-pack";
import { cn } from "@/lib/utils";
import { countPendingInvoices } from "@/lib/projects/invoice-display";
import { calcStageProgress } from "@/lib/projects/stage-progress";
import {
  LayoutGrid,
  CalendarCheck,
  CreditCard,
  FileDiff,
  Scale,
  Wrench,
  FileText,
  History,
  Mail,
  ShieldCheck,
  ClipboardCheck,
  Phone,
} from "lucide-react";
import { ProjectDetail } from "@/types/project";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ProjectDetailTabKey } from "@/utils/validators/projects";

import { useProjectCallsUnread } from "./calls/project-calls-queries";

/**
 * The tabs that are actually navigable. `projectTabsValidator` still accepts
 * `materials`, `updates` and `workers` because those tab bodies exist, but
 * they were deliberately hidden (commit 230c35e) as unfinished surfaces.
 * Variations came back once raising one invoiced and emailed the client. This list is the single source of truth for what a user can reach,
 * and `project-detail-tabs.tsx` narrows the URL parameter against it so a
 * hidden key can no longer render a panel with no way back.
 */
export const VISIBLE_PROJECT_DETAIL_TABS = [
  "overview",
  "milestones",
  "checklists",
  "payments",
  "financials",
  "variations",
  "tradies",
  "docs",
  "history",
  "communications",
  "compliance",
] as const satisfies readonly ProjectDetailTabKey[];

export type VisibleProjectDetailTabKey =
  (typeof VISIBLE_PROJECT_DETAIL_TABS)[number];

/**
 * Whether this viewer may open the tab on this project. Compliance and History
 * depend on the project's `viewerAccess`; the rest are open to any viewer who
 * reaches the page (the admin-only tabs are dropped in the tab bar itself).
 */
export function canOpenProjectDetailTab(
  key: VisibleProjectDetailTabKey,
  project: ProjectDetail,
): boolean {
  if (key === "compliance") return project.viewerAccess.compliance;
  if (key === "history") return project.viewerAccess.history;
  return true;
}

export function isVisibleProjectDetailTab(
  value: string,
  project: ProjectDetail,
): value is VisibleProjectDetailTabKey {
  return (
    (VISIBLE_PROJECT_DETAIL_TABS as readonly string[]).includes(value)
    && canOpenProjectDetailTab(value as VisibleProjectDetailTabKey, project)
  );
}

export const projectTabTriggerId = (key: VisibleProjectDetailTabKey) =>
  `project-tab-${key}`;
export const projectTabPanelId = (key: VisibleProjectDetailTabKey) =>
  `project-tabpanel-${key}`;

const TabIcons: Record<VisibleProjectDetailTabKey, React.ElementType> = {
  overview: LayoutGrid,
  milestones: CalendarCheck,
  // The stage inspections, handover among them (issue #420).
  checklists: ClipboardCheck,
  payments: CreditCard,
  financials: Scale,
  variations: FileDiff,
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
  /** Drawn before the number, when the count is of one kind of thing. */
  icon?: React.ElementType;
};

type ProjectDetailTab = {
  key: VisibleProjectDetailTabKey;
  label: string;
  badge?: TabBadge;
  isAdminOnly?: boolean;
};

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  // Counts are neutral: gold is for actions, not for numbers.
  primary: "bg-muted text-foreground",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
  neutral: "bg-muted text-muted-foreground",
};

const BLOCKED_TRADIE_STATUSES = new Set(["NO_RESPONSE", "DECLINED"]);
const AWAITING_TRADIE_STATUSES = new Set([
  "PENDING",
  "PENDING_RESPONSE",
  "AWAITING_QUOTE",
  "AWAITING_ADMIN_APPROVAL",
  "PENDING_FINAL_CONFIRMATION",
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
      // What the outreach is actually waiting for, not all six. Two documents
      // drop out for different reasons: an open DA alert takes the 10.7
      // certificate off the file entirely, and the full architectural design is
      // never a precondition for engaging a certifier. Counting either left a
      // badge on the tab over a document the tab itself no longer chases.
      const outstanding = stillMissing(
        outreachRequiredDocuments(engagement).map((doc) => doc.type),
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
          document.status !== ComplianceDocumentStatus.APPROVED
          && !isNotRequired(document.status),
      );
      const rejected = unresolved.filter(
        (document) =>
          document.status === ComplianceDocumentStatus.REJECTED
          || document.rejectionReason,
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
  unreadCalls: number,
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
  const unsentVariations = project.variations.filter(
    (variation) =>
      variation.status === "APPROVED"
      && variation.newPrice !== null
      && (variation.issueError !== null || variation.sentAt === null),
  ).length;
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
    // Beside Milestones: each stage there opens its checklist here.
    { key: "checklists", label: "Checklists" },
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
    // Profit and loss per activity: the tender against what each tradie is
    // paid, which is the margin, so admin only like Payments.
    { key: "financials", label: "Financials", isAdminOnly: true },
    // Prices to the client and the Xero invoices behind them: admin only.
    {
      key: "variations",
      label: "Variations",
      isAdminOnly: true,
      ...(unsentVariations > 0
        ? {
            badge: {
              count: unsentVariations.toString(),
              // Raised but not in front of the client: an invoice or an email
              // that did not go, which nobody else is watching for.
              tone: "danger",
              description: `${unsentVariations} variations not fully sent to the client`,
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
    {
      key: "communications",
      label: "Communications",
      ...(unreadCalls > 0
        ? {
            badge: {
              count: unreadCalls.toString(),
              // Somebody rang about this build and nobody has read it yet.
              tone: "warning",
              description: `${unreadCalls} new inbound call${unreadCalls === 1 ? "" : "s"} filed on this project`,
              icon: Phone,
            } satisfies TabBadge,
          }
        : {}),
    },
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
  // Filtered here, not per button, so the arrow keys skip a tab the viewer
  // cannot open as well as the mouse.
  // Matched inbound calls are the office's to read: nobody else is asked.
  const unreadCalls = useProjectCallsUnread(project.id, isAdmin);
  const projectDetailTabs = useMemo(
    () =>
      generateProjectDetailTabs(project, unreadCalls).filter(
        (tab) =>
          canOpenProjectDetailTab(tab.key, project)
          && (!tab.isAdminOnly || isAdmin),
      ),
    [isAdmin, project, unreadCalls],
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in view on the phone strip, without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[activeTab];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (
      left < list.scrollLeft
      || left + tab.offsetWidth > list.scrollLeft + list.clientWidth
    )
      list.scrollTo({ left: Math.max(0, left - 12), behavior: "smooth" });
  }, [activeTab]);

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
    <>
      {/* Desktop tabs wrap so every section is visible without a hidden
          scrollbar. A phone has room for two or three, so there the same
          tablist scrolls sideways with the active tab kept in view; it
          replaces a <select> that hid every other section behind a tap. */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Project sections"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="-mx-3 mb-5 flex snap-x gap-x-1 overflow-x-auto overscroll-x-contain border-b-2 border-border/60 px-3 no-scrollbar md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      >
        {projectDetailTabs.map((tab) => {
          const Icon = TabIcons[tab.key];
          const isActive = activeTab === tab.key;

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
                "relative -mb-0.5 inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm md:px-4 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive && "border-royal-gold font-semibold text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{tab.label}</span>
              {tab.badge ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-1 inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full px-1.5 text-xs font-medium leading-none",
                      BADGE_TONE_CLASS[tab.badge.tone],
                    )}
                  >
                    {tab.badge.icon ? (
                      <tab.badge.icon className="size-3" aria-hidden="true" />
                    ) : null}
                    {tab.badge.count}
                  </span>
                  <span className="sr-only">{tab.badge.description}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
