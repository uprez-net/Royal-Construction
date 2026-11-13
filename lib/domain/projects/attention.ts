import {
  ChecklistIssueStatus,
  ComplianceAlertStatus,
  type ComplianceDocumentType,
  type MilestoneStatus,
  Prisma,
  ProjectStatus,
  type TradieScheduleStatus,
  VariationStatus,
} from "@prisma/client";
import { toZonedTime } from "date-fns-tz";

import { SYDNEY_TZ } from "@/lib/dates/sydney";
import { openOverdueDays } from "@/lib/projects/milestone-ledger";

import { projectReadScope } from "../access/projects";
import {
  BUILD_START_DOCUMENT_TYPES,
  missingBuildStartDocuments,
} from "../compliance/lifecycle";
import type { DomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import {
  hasWorkStarted,
  milestoneEndDate,
  STARTED_MILESTONE_STATUSES,
} from "./milestone-schedule";
import { collectProjectDateBlockers } from "./readiness";
import { missingMilestoneTrades } from "./tradie-dependencies";

// What on a project needs somebody, and whether it has started on site yet
// (issues #451 and #452).
//
// **Needs Attention is derived, not stored.** It used to be a `ProjectStatus`
// written once, at creation, when the readiness check warned — so a job with a
// surveyor three weeks late, an open checklist defect and an unapproved
// variation read "Draft" or "Active" with nothing wrong, while a job whose PCA
// was filled in the next morning read "Needs attention" for ever. Worse, writing
// it replaced the lifecycle stage: a project could not be both "in compliance"
// and "needs attention", which is exactly what most of them are.
//
// So the conditions are read live from the records that cause them, every time
// they are asked for, and a project leaves Needs Attention the moment the last
// one is resolved — nobody has to remember to clear a flag. Each condition is
// the rule that already exists elsewhere, called rather than restated:
//
//   - overdue activity       `openOverdueDays` — the Milestones tab's badge
//   - open compliance alert  `ComplianceAlert.status = OPEN` — the project page's Alerts card
//   - unresolved issue       a checklist defect still OPEN or IN_PROGRESS
//   - variation pending      `Variation.status = PENDING` — awaiting the client
//   - missing documents      `missingBuildStartDocuments` + the readiness warns,
//                            once work has started on site
//   - dependency breach      `missingMilestoneTrades` — the project page's
//                            "No confirmed … booking" alert; it only looks at
//                            activities under way, so a booking not yet due is
//                            never flagged
//
// **Drafting** is the stage before any of that work: no activity has started.
// `hasWorkStarted` is the same test that freezes a project's start date, so the
// two can never disagree about whether a job is under way.

export type AttentionKind =
  | "OVERDUE"
  | "COMPLIANCE_ALERT"
  | "ISSUE"
  | "VARIATION"
  | "MISSING_DOCUMENT"
  | "DEPENDENCY";

export type AttentionCondition = {
  readonly kind: AttentionKind;
  /** One line an operator can act on: "2 activities overdue". */
  readonly label: string;
  /** How many things of this kind are outstanding. */
  readonly count: number;
};

export type OverdueActivity = {
  readonly milestoneId: string;
  readonly name: string;
  readonly status: MilestoneStatus;
  /** ISO instant: the activity's estimated completion (`milestoneEndDate`). */
  readonly expectedCompletion: string;
  /** Whole calendar days past that date, in Sydney. Always at least 1. */
  readonly daysOverdue: number;
};

export type ProjectAttention = {
  readonly projectId: string;
  readonly name: string;
  readonly location: string;
  readonly customerName: string;
  readonly status: ProjectStatus;
  /** No activity has started yet (issue #452). */
  readonly drafting: boolean;
  // Mutable arrays: the list rows carrying this go through the Redux store,
  // whose drafts cannot hold a readonly array.
  /** Empty when nothing needs anybody. */
  readonly conditions: AttentionCondition[];
  /** Most overdue first. Empty when nothing is overdue. */
  readonly overdue: OverdueActivity[];
};

/** Everything `assessProjectAttention` reads, as the query selects it. */
export type AttentionSource = {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly status: ProjectStatus;
  readonly requirements: Prisma.JsonValue;
  readonly customer: { readonly name: string };
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: MilestoneStatus;
    readonly targetDate: Date;
    readonly startDate: Date | null;
    readonly estimatedDays: number;
    readonly requiredTradeTypes: readonly { readonly label: string }[];
  }[];
  readonly tradieSchedules: readonly {
    readonly milestoneId: string | null;
    readonly status: TradieScheduleStatus;
    readonly trade: string | null;
    readonly tradie: { readonly trade: string };
  }[];
  readonly variations: readonly { readonly status: VariationStatus }[];
  readonly checklists: readonly {
    readonly issues: readonly { readonly status: ChecklistIssueStatus }[];
  }[];
  readonly certifierEngagement: {
    readonly alerts: readonly { readonly status: ComplianceAlertStatus }[];
    readonly documents: readonly {
      readonly documentType: ComplianceDocumentType;
      readonly _count: { readonly files: number };
    }[];
  } | null;
};

const UNRESOLVED_ISSUE_STATUSES: readonly ChecklistIssueStatus[] = [
  ChecklistIssueStatus.OPEN,
  ChecklistIssueStatus.IN_PROGRESS,
];

/** The readiness warns, in the words the attention list uses. */
const READINESS_GAP_LABEL: Record<string, string> = {
  pca_missing: "PCA inspector",
  hbcf_missing: "HBCF insurance number",
  signed_date_unparseable: "a valid signed date",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Calendar days an activity is overdue, judged on Sydney's calendar.
 *
 * `openOverdueDays` counts calendar days in the process's own time zone, which
 * is the office's in a browser and UTC on the server. Both instants are moved
 * onto Sydney's wall clock first, so the server and the Milestones tab agree
 * on which day it is.
 */
function sydneyOverdueDays(
  milestone: AttentionSource["milestones"][number],
  now: Date,
): number | null {
  return openOverdueDays(
    {
      status: milestone.status,
      estimatedDays: milestone.estimatedDays,
      targetDate: toZonedTime(milestone.targetDate, SYDNEY_TZ),
      startDate: milestone.startDate
        ? toZonedTime(milestone.startDate, SYDNEY_TZ)
        : null,
    },
    toZonedTime(now, SYDNEY_TZ),
  );
}

function legalAdministration(requirements: Prisma.JsonValue) {
  if (!requirements || typeof requirements !== "object") return null;
  const legal = (requirements as Record<string, unknown>).legalAdministration;
  if (!legal || typeof legal !== "object") return null;
  const read = (key: string) => {
    const value = (legal as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  };
  return {
    signedDate: read("signedDate"),
    pcaInspector: read("pcaInspector"),
    hbcfInsuranceNumber: read("hbcfInsuranceNumber"),
  };
}

/**
 * The conditions on one project, and whether it is still drafting.
 *
 * Pure: the read below supplies the rows, a test supplies literals.
 */
export function assessProjectAttention(
  project: AttentionSource,
  now: Date,
): ProjectAttention {
  const started = hasWorkStarted(project.milestones);
  const conditions: AttentionCondition[] = [];

  const overdue = project.milestones
    .flatMap((milestone): OverdueActivity[] => {
      const days = sydneyOverdueDays(milestone, now);
      return days === null
        ? []
        : [
            {
              milestoneId: milestone.id,
              name: milestone.name,
              status: milestone.status,
              expectedCompletion: milestoneEndDate(milestone).toISOString(),
              daysOverdue: days,
            },
          ];
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  if (overdue.length > 0) {
    conditions.push({
      kind: "OVERDUE",
      count: overdue.length,
      label: `${plural(overdue.length, "activity", "activities")} overdue`,
    });
  }

  const openAlerts = (project.certifierEngagement?.alerts ?? []).filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  ).length;
  if (openAlerts > 0) {
    conditions.push({
      kind: "COMPLIANCE_ALERT",
      count: openAlerts,
      label: `${plural(openAlerts, "open compliance alert", "open compliance alerts")}`,
    });
  }

  const issues = project.checklists
    .flatMap((checklist) => checklist.issues)
    .filter((issue) => UNRESOLVED_ISSUE_STATUSES.includes(issue.status)).length;
  if (issues > 0) {
    conditions.push({
      kind: "ISSUE",
      count: issues,
      label: `${plural(issues, "unresolved checklist issue", "unresolved checklist issues")}`,
    });
  }

  const variations = project.variations.filter(
    (variation) => variation.status === VariationStatus.PENDING,
  ).length;
  if (variations > 0) {
    conditions.push({
      kind: "VARIATION",
      count: variations,
      label: `${plural(variations, "variation", "variations")} awaiting approval`,
    });
  }

  // Documents follow the stage: before anything has started on site, chasing
  // the certificate and the HBCF cover is the compliance file's job, and its
  // own overdue alerts say when one is late. Once work has started they are
  // documents the build is going on without.
  const missing: string[] = [];
  if (started) {
    const held = new Set(
      (project.certifierEngagement?.documents ?? [])
        .filter((document) => document._count.files > 0)
        .map((document) => document.documentType),
    );
    missing.push(...missingBuildStartDocuments(held));
  }
  const legal = legalAdministration(project.requirements);
  const warns = collectProjectDateBlockers({
    signedDate: legal?.signedDate ?? null,
    startDate: null,
    pcaInspector: legal?.pcaInspector ?? null,
    hbcfInsuranceNumber: legal?.hbcfInsuranceNumber ?? null,
    // The readiness gate asks what stands between a project and going on
    // site, so it is asked as ACTIVE once the project is there.
    status: started ? ProjectStatus.ACTIVE : project.status,
  }).filter((blocker) => blocker.severity === "warn");
  for (const warn of warns) {
    const label = READINESS_GAP_LABEL[warn.id];
    if (label) missing.push(label);
  }
  if (missing.length > 0) {
    conditions.push({
      kind: "MISSING_DOCUMENT",
      count: missing.length,
      label: `Missing ${missing.join(", ")}`,
    });
  }

  const missingTrades = project.milestones.flatMap((milestone) =>
    missingMilestoneTrades(milestone, project.tradieSchedules),
  ).length;
  if (missingTrades > 0) {
    conditions.push({
      kind: "DEPENDENCY",
      count: missingTrades,
      label: `${plural(missingTrades, "required trade", "required trades")} not booked for work under way`,
    });
  }

  return {
    projectId: project.id,
    name: project.name,
    location: project.location,
    customerName: project.customer.name,
    status: project.status,
    drafting: !started,
    conditions,
    overdue,
  };
}

export const attentionSourceSelect = {
  id: true,
  name: true,
  location: true,
  status: true,
  requirements: true,
  customer: { select: { name: true } },
  milestones: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      targetDate: true,
      startDate: true,
      estimatedDays: true,
      requiredTradeTypes: { select: { label: true } },
    },
  },
  tradieSchedules: {
    select: {
      milestoneId: true,
      status: true,
      trade: true,
      tradie: { select: { trade: true } },
    },
  },
  variations: {
    where: { status: VariationStatus.PENDING },
    select: { status: true },
  },
  checklists: {
    select: {
      issues: {
        where: { status: { in: [...UNRESOLVED_ISSUE_STATUSES] } },
        select: { status: true },
      },
    },
  },
  certifierEngagement: {
    select: {
      alerts: {
        where: { status: ComplianceAlertStatus.OPEN },
        select: { status: true },
      },
      documents: {
        where: { documentType: { in: [...BUILD_START_DOCUMENT_TYPES] } },
        select: { documentType: true, _count: { select: { files: true } } },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

/**
 * The attention read for every project the caller may see that is not
 * finished, or for just `projectIds` when given.
 *
 * A completed project is never read: whatever is left on it is history, and
 * the Completed chip is where it lives.
 */
export async function readProjectAttention(
  principal: DomainPrincipal,
  db: DomainDb,
  options: { now?: Date; projectIds?: readonly string[] } = {},
): Promise<ProjectAttention[]> {
  if (options.projectIds && options.projectIds.length === 0) return [];
  const now = options.now ?? new Date();
  const rows = await db.project.findMany({
    where: {
      ...projectReadScope(principal),
      status: { not: ProjectStatus.COMPLETED },
      ...(options.projectIds ? { id: { in: [...options.projectIds] } } : {}),
    },
    select: attentionSourceSelect,
  });
  return rows.map((row) => assessProjectAttention(row, now));
}

/** Projects with at least one condition, most urgent first. */
export function needingAttention(
  projects: readonly ProjectAttention[],
): ProjectAttention[] {
  return projects
    .filter((project) => project.conditions.length > 0)
    .sort(
      (a, b) =>
        (b.overdue[0]?.daysOverdue ?? 0) - (a.overdue[0]?.daysOverdue ?? 0)
        || b.conditions.length - a.conditions.length
        || a.name.localeCompare(b.name),
    );
}

/**
 * The Drafting filter as a query: not finished, and no activity started.
 *
 * The same test as `hasWorkStarted`, expressed for the database so a listing
 * can page and count it.
 */
export const draftingProjectWhere: Prisma.ProjectWhereInput = {
  status: { not: ProjectStatus.COMPLETED },
  milestones: { none: { status: { in: [...STARTED_MILESTONE_STATUSES] } } },
};
