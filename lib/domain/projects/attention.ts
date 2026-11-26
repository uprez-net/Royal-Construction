import {
  ChecklistIssueStatus,
  ComplianceAlertStatus,
  type ComplianceAlertType,
  type ComplianceDocumentType,
  type MilestoneStatus,
  Prisma,
  ProjectStatus,
  type TradieScheduleStatus,
  VariationStatus,
} from "@prisma/client";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import { COMPLIANCE_ALERT_COPY } from "@/constants/complianceAlerts";
import { SYDNEY_TZ } from "@/lib/dates/sydney";
import type {
  HbcfClaimDocument,
  ProjectSourceDocumentReference,
} from "@/types/project-flow";
import { openOverdueDays } from "@/lib/projects/milestone-ledger";

import { canSeeProjectFinancials, projectReadScope } from "../access/projects";
import { BUILD_START_DOCUMENT_TYPES } from "../compliance/lifecycle";
import type { DomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import { gapsVisibleTo, projectDocumentGaps } from "./document-gaps";
import {
  BUILDING_PROJECT_STATUSES,
  hasWorkStarted,
  milestoneEndDate,
  STARTED_MILESTONE_STATUSES,
} from "./milestone-schedule";
import {
  bookingGapLabel,
  overdueMilestoneBookings,
} from "./tradie-dependencies";
import { formatVariationNumber } from "./variation-rules";

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
//   - overdue activity       `openOverdueDays` — the Milestones tab's badge;
//                            only an activity under way on a project being
//                            built, so a job in drafting or compliance never
//                            reads overdue
//   - open compliance alert  `ComplianceAlert.status = OPEN` — the project page's Alerts card
//   - unresolved issue       a checklist defect still OPEN or IN_PROGRESS
//   - variation pending      `Variation.status = PENDING` — awaiting the client
//   - missing documents      `projectDocumentGaps` — the readiness warns (PCA,
//                            HBCF number) from day one, and
//                            `missingBuildStartDocuments` once work has
//                            started on site
//   - booking overdue        `overdueMilestoneBookings` — the project page's
//                            "No confirmed … booking" alert: an activity under
//                            way, or one on a job being built whose planned
//                            start day has come, without a confirmed booking
//                            for each trade it needs, or with a tradie booked
//                            who has not confirmed
//
// **Drafting** is the stage before any of that work: no activity has started.
// `hasWorkStarted` is the same test that freezes a project's start date, so the
// two can never disagree about whether a job is under way.
//
// **Every condition names what it is about.** "2 activities overdue" sent the
// office into the project to find out which two; the label now says which
// activity, which alert, which variation, which document, and by how much. A
// condition over a single thing is one sentence naming it; over several it is
// a count with each one listed in `details`.

export type AttentionKind =
  | "OVERDUE"
  | "COMPLIANCE_ALERT"
  | "ISSUE"
  | "VARIATION"
  | "MISSING_DOCUMENT"
  | "DEPENDENCY";

export type AttentionCondition = {
  readonly kind: AttentionKind;
  /**
   * One line an operator can act on. Names the thing when there is one
   * ("Slab is 3 days overdue (expected 9 Nov)"); a count when there are
   * several ("2 activities overdue"), with each one in `details`.
   */
  readonly label: string;
  /** How many things of this kind are outstanding. */
  readonly count: number;
  /**
   * The outstanding things, named, when there is more than one: the first
   * `ATTENTION_DETAIL_LIMIT`, most urgent first, so `count` minus this
   * length is how many more there are. Empty when the label already names the
   * only one.
   */
  // Mutable: it travels through the Redux store with the list rows.
  readonly details: string[];
};

/**
 * How many things one condition names. Every project on the list carries its
 * conditions, and a test job had 83 overdue activities: listing them all made
 * the payload grow with the backlog, for a column that has room for a few.
 */
export const ATTENTION_DETAIL_LIMIT = 3;

export type OverdueActivity = {
  readonly milestoneId: string;
  readonly name: string;
  readonly status: MilestoneStatus;
  /** ISO instant: the activity's estimated completion (`milestoneEndDate`). */
  readonly expectedCompletion: string;
  /** Whole calendar days past that date, in Sydney. Always at least 1. */
  readonly daysOverdue: number;
};

/**
 * A trade booking an activity needed confirmed by now and does not have
 * (`overdueMilestoneBookings`).
 */
export type OverdueBooking = {
  readonly milestoneId: string;
  /** The activity's name. */
  readonly name: string;
  readonly trade: string;
  /** A tradie is booked but has not confirmed; false when nobody is booked. */
  readonly unconfirmed: boolean;
  /** The activity is under way, as against due to start. */
  readonly started: boolean;
  /** ISO instant: the activity's planned start. */
  readonly plannedStart: string;
  /**
   * Whole calendar days since the booking was owed, in Sydney: the day an
   * activity under way started, else its planned start. 0 on the day itself,
   * never negative.
   */
  readonly daysLate: number;
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
  /** Latest first. Empty when every booking due is confirmed. */
  readonly overdueBookings: OverdueBooking[];
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
  readonly variations: readonly {
    readonly status: VariationStatus;
    readonly number: number | null;
    readonly description: string;
  }[];
  readonly checklists: readonly {
    readonly title: string;
    readonly issues: readonly {
      readonly status: ChecklistIssueStatus;
      readonly number: number;
      readonly description: string;
    }[];
  }[];
  readonly certifierEngagement: {
    readonly alerts: readonly {
      readonly status: ComplianceAlertStatus;
      readonly type: ComplianceAlertType;
    }[];
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

/** Longest free text (a variation's reason, an issue's description) quoted. */
const QUOTE_LIMIT = 60;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Free text cut to one short line, on a word where it can be. */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= QUOTE_LIMIT) return flat;
  const cut = flat.slice(0, QUOTE_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > QUOTE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * An activity's timing moved onto Sydney's wall clock, which is what both the
 * overdue count and the day it was expected are worked out on.
 */
function sydneyTiming(milestone: AttentionSource["milestones"][number]) {
  return {
    status: milestone.status,
    estimatedDays: milestone.estimatedDays,
    targetDate: toZonedTime(milestone.targetDate, SYDNEY_TZ),
    startDate: milestone.startDate
      ? toZonedTime(milestone.startDate, SYDNEY_TZ)
      : null,
  };
}

/**
 * The day an activity was expected to finish, as "9 Nov", with the year when
 * it is not this year's: an activity three years late read "expected 13 Oct",
 * which says the wrong October.
 *
 * Worked out with the same calendar arithmetic as the overdue count
 * (`milestoneEndDate` on Sydney's wall clock), not from the end instant
 * converted afterwards: adding days to the instant drifts by an hour across a
 * daylight-saving change, and a midnight end then printed as the day before,
 * a day off the count beside it.
 */
function sydneyExpectedDay(
  milestone: AttentionSource["milestones"][number],
  now: Date,
): string {
  const day = milestoneEndDate(sydneyTiming(milestone));
  const thisYear = toZonedTime(now, SYDNEY_TZ).getFullYear();
  return format(day, day.getFullYear() === thisYear ? "d MMM" : "d MMM yyyy");
}

/**
 * One condition over `items`: the item itself when there is one, otherwise a
 * count with the first few named.
 */
function condition(
  kind: AttentionKind,
  items: readonly string[],
  single: (item: string) => string,
  summary: (count: number) => string,
): AttentionCondition {
  return items.length === 1
    ? { kind, count: 1, label: single(items[0]), details: [] }
    : {
        kind,
        count: items.length,
        label: summary(items.length),
        details: items.slice(0, ATTENTION_DETAIL_LIMIT),
      };
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
  projectStatus: ProjectStatus,
): number | null {
  return openOverdueDays(
    sydneyTiming(milestone),
    toZonedTime(now, SYDNEY_TZ),
    projectStatus,
  );
}

function legalAdministration(requirements: Prisma.JsonValue) {
  if (!requirements || typeof requirements !== "object") return null;
  const legal = (requirements as Record<string, unknown>).legalAdministration;
  if (!legal || typeof legal !== "object") return null;
  const fields = legal as Record<string, unknown>;
  const read = (key: string) => {
    const value = fields[key];
    return typeof value === "string" ? value : null;
  };
  return {
    signedDate: read("signedDate"),
    pcaInspector: read("pcaInspector"),
    hbcfInsuranceNumber: read("hbcfInsuranceNumber"),
    // The certificate an Overview-tab upload records on the project, which
    // counts as held as much as one on the compliance file.
    hbcfInsuranceDocument:
      fields.hbcfInsuranceDocument
      && typeof fields.hbcfInsuranceDocument === "object"
        ? (fields.hbcfInsuranceDocument as ProjectSourceDocumentReference)
        : null,
    hbcfClaimDocuments: Array.isArray(fields.hbcfClaimDocuments)
      ? (fields.hbcfClaimDocuments as HbcfClaimDocument[])
      : undefined,
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
  /** False for a caller who may not see project money (a site manager). */
  seesMoney = true,
): ProjectAttention {
  const started = hasWorkStarted(project.milestones);
  const conditions: AttentionCondition[] = [];

  const overdue = project.milestones
    .flatMap((milestone): OverdueActivity[] => {
      const days = sydneyOverdueDays(milestone, now, project.status);
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
    const milestoneById = new Map(
      project.milestones.map((milestone) => [milestone.id, milestone]),
    );
    const expected = (activity: OverdueActivity) =>
      sydneyExpectedDay(milestoneById.get(activity.milestoneId)!, now);
    const late = overdue.map(
      (activity) =>
        `${activity.name} — ${plural(activity.daysOverdue, "day", "days")} overdue (expected ${expected(activity)})`,
    );
    conditions.push({
      ...condition(
        "OVERDUE",
        late,
        () => {
          const [only] = overdue;
          return `${only.name} is ${plural(only.daysOverdue, "day", "days")} overdue (expected ${expected(only)})`;
        },
        (count) => `${plural(count, "activity", "activities")} overdue`,
      ),
    });
  }

  const openAlerts = (project.certifierEngagement?.alerts ?? [])
    .filter((alert) => alert.status === ComplianceAlertStatus.OPEN)
    .map((alert) => COMPLIANCE_ALERT_COPY[alert.type].title);
  if (openAlerts.length > 0) {
    conditions.push(
      condition(
        "COMPLIANCE_ALERT",
        openAlerts,
        (title) => `Open compliance alert: ${title}`,
        (count) =>
          `${plural(count, "open compliance alert", "open compliance alerts")}`,
      ),
    );
  }

  const issues = project.checklists.flatMap((checklist) =>
    checklist.issues
      .filter((issue) => UNRESOLVED_ISSUE_STATUSES.includes(issue.status))
      .map(
        (issue) =>
          `${checklist.title} #${issue.number}: ${quote(issue.description)}`,
      ),
  );
  if (issues.length > 0) {
    conditions.push(
      condition(
        "ISSUE",
        issues,
        (issue) => `Unresolved checklist issue — ${issue}`,
        (count) =>
          `${plural(count, "unresolved checklist issue", "unresolved checklist issues")}`,
      ),
    );
  }

  const variations = project.variations
    .filter((variation) => variation.status === VariationStatus.PENDING)
    .map(
      (variation) =>
        `${formatVariationNumber(variation.number)}: ${quote(variation.description)}`,
    );
  if (variations.length > 0) {
    conditions.push(
      condition(
        "VARIATION",
        variations,
        (variation) => `Variation awaiting client approval — ${variation}`,
        (count) =>
          `${plural(count, "variation", "variations")} awaiting client approval`,
      ),
    );
  }

  // The same entries the project page lists one by one.
  const missing = gapsVisibleTo(
    projectDocumentGaps({
      status: project.status,
      started,
      legal: legalAdministration(project.requirements),
      heldDocuments: new Set(
        (project.certifierEngagement?.documents ?? [])
          .filter((document) => document._count.files > 0)
          .map((document) => document.documentType),
      ),
    }),
    !seesMoney,
  ).map((gap) => gap.title);
  if (missing.length > 0) {
    conditions.push(
      condition(
        "MISSING_DOCUMENT",
        missing,
        (gap) => gap,
        (count) => `${count} required documents or details missing`,
      ),
    );
  }

  // Planned starts on Sydney's calendar, like the overdue count above.
  const today = toZonedTime(now, SYDNEY_TZ);
  const overdueBookings = project.milestones
    .flatMap((milestone): OverdueBooking[] => {
      const plannedStart = toZonedTime(milestone.targetDate, SYDNEY_TZ);
      const started = milestone.status === "ACTIVE";
      // Late from the day the work began when it has, else the planned day.
      const owedFrom =
        started && milestone.startDate
          ? toZonedTime(milestone.startDate, SYDNEY_TZ)
          : plannedStart;
      return overdueMilestoneBookings(
        { ...milestone, targetDate: plannedStart },
        project.tradieSchedules,
        today,
        project.status,
      ).map((gap) => ({
        milestoneId: milestone.id,
        name: milestone.name,
        trade: gap.trade,
        unconfirmed: gap.unconfirmed,
        started,
        plannedStart: milestone.targetDate.toISOString(),
        daysLate: Math.max(0, differenceInCalendarDays(today, owedFrom)),
      }));
    })
    .sort((a, b) => b.daysLate - a.daysLate);
  if (overdueBookings.length > 0) {
    const thisYear = today.getFullYear();
    const when = (booking: OverdueBooking) => {
      if (booking.started) return "which has started";
      if (booking.daysLate === 0) return "which starts today";
      const day = toZonedTime(new Date(booking.plannedStart), SYDNEY_TZ);
      return `due to start ${format(day, day.getFullYear() === thisYear ? "d MMM" : "d MMM yyyy")}`;
    };
    const lines = overdueBookings.map(
      (booking) =>
        `${bookingGapLabel(booking)} for ${booking.name}, ${when(booking)}`,
    );
    conditions.push(
      condition(
        "DEPENDENCY",
        lines,
        (line) => line,
        (count) =>
          `${plural(count, "trade booking", "trade bookings")} overdue`,
      ),
    );
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
    overdueBookings,
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
    orderBy: [{ number: "asc" }, { requestedDate: "asc" }],
    select: { status: true, number: true, description: true },
  },
  checklists: {
    orderBy: { number: "asc" },
    select: {
      title: true,
      issues: {
        where: { status: { in: [...UNRESOLVED_ISSUE_STATUSES] } },
        orderBy: { number: "asc" },
        select: { status: true, number: true, description: true },
      },
    },
  },
  certifierEngagement: {
    select: {
      alerts: {
        where: { status: ComplianceAlertStatus.OPEN },
        orderBy: { createdAt: "asc" },
        select: { status: true, type: true },
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
  options: {
    now?: Date;
    projectIds?: readonly string[];
    /**
     * Read only the projects that could be overdue (`overdueCandidateWhere`),
     * for the Overdue filter. `assessProjectAttention` still decides which are.
     */
    overdueCandidates?: boolean;
  } = {},
): Promise<ProjectAttention[]> {
  if (options.projectIds && options.projectIds.length === 0) return [];
  const now = options.now ?? new Date();
  const rows = await db.project.findMany({
    where: {
      ...projectReadScope(principal),
      status: { not: ProjectStatus.COMPLETED },
      ...(options.projectIds ? { id: { in: [...options.projectIds] } } : {}),
      ...(options.overdueCandidates
        ? { AND: [overdueCandidateWhere(now)] }
        : {}),
    },
    select: attentionSourceSelect,
  });
  // A pending variation is named with its description, which is where the
  // office writes what it costs. Someone who may not see project money (a site
  // manager) is not alerted to them; the variation is the office's to chase.
  const seesMoney = canSeeProjectFinancials(principal);
  return rows.map((row) =>
    assessProjectAttention(
      seesMoney ? row : { ...row, variations: [] },
      now,
      seesMoney,
    ),
  );
}

/**
 * A wide net for the Overdue filter, so it reads the few projects that could
 * be overdue rather than every open job with all its relations. Prisma turns
 * it into one EXISTS per branch, and because it is a `where` rather than raw
 * SQL the caller's scope still applies to it.
 *
 * Wider than the rule on purpose, never narrower: both ways to be overdue
 * need an activity under way, or a pending one on a job being built whose
 * planned start is no later than today in Sydney, which is always before
 * now + 1 day. `assessProjectAttention` then decides.
 */
export function overdueCandidateWhere(now: Date): Prisma.ProjectWhereInput {
  return {
    OR: [
      { milestones: { some: { status: "ACTIVE" } } },
      {
        status: { in: [...BUILDING_PROJECT_STATUSES] },
        milestones: {
          some: { status: "PENDING", targetDate: { lt: addDays(now, 1) } },
        },
      },
    ],
  };
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
