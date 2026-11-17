import {
  MilestoneStatus,
  ProjectStatus,
  TradieScheduleStatus,
  type LeadStage,
  type ProjectStatus as ProjectStatusType,
} from "@prisma/client";

import type { DomainDb } from "../../db";
import { projectManageScope, projectReadScope } from "../../access/projects";
import { searchLeads } from "../../leads/queries";
import { recordCallerAccess } from "./audit";
import type { VoiceCallerClass, VoiceCallerPrincipal } from "./identity";
import {
  clientProjectWhere,
  currentVoiceStaff,
  currentVoiceTradie,
  leadScopeWhere,
} from "./relationships";
import {
  addDays,
  bookingStatus,
  clientLeadStage,
  clientProjectStatus,
  field,
  milestoneStatus,
  spokenDate,
  staffLeadStage,
  staffProjectStatus,
  startOfSydneyDay,
} from "./speech";

// What Mili knows about a verified caller before they say a word.
//
// One bounded, role-scoped briefing per call, read and allowlisted here and
// handed to her when her session starts — deterministic, so it does not
// depend on GPT-Live choosing to ask for anything. Each builder selects only
// the fields that class may hear: there is no full record followed by a
// prompt asking her to leave parts out.
//
//   CLIENT        their own projects (status, current and next stages, the
//                 current schedule's dates) and their enquiries with no
//                 project yet. No prices, notes, staff or other people.
//   TRADIE        only their own bookings, with the project name, site
//                 address and activity they need to turn up. No prices,
//                 other trades, customer details or notes.
//   SITE_MANAGER  the projects assigned to them (projectManageScope): stages,
//                 dates and the trades booked. No prices, costs or payments
//                 (#158).
//   ADMIN         an overview — live projects, the week's bookings, the
//                 pipeline and today's meetings. Anything else is a catalogue
//                 lookup (lookups.ts).
//
// The relationship is re-read first (relationships.ts) and the briefing is
// audited before it is returned.

export type VoiceBriefing = {
  readonly callerClass: Exclude<VoiceCallerClass, "unknown">;
  readonly firstName: string | null;
  /** The facts Mili may say, one per line. */
  readonly text: string;
  readonly recordIds: readonly string[];
};

/** A briefing longer than this is cut: a phone call is not a report. */
export const VOICE_BRIEFING_MAX_CHARS = 6_000;

const DEAD_BOOKINGS = [
  TradieScheduleStatus.CANCELLED,
  TradieScheduleStatus.DECLINED,
];

type MilestoneRow = {
  readonly name: string;
  readonly status: MilestoneStatus;
  readonly startDate: Date | null;
  readonly targetDate: Date;
};

const MILESTONE_SELECT = {
  name: true,
  startDate: true,
  status: true,
  targetDate: true,
} as const;

function scheduleWords(milestone: MilestoneRow, now: Date): string {
  const start = spokenDate(milestone.startDate, now);
  const finish = spokenDate(milestone.targetDate, now);
  if (milestone.status === MilestoneStatus.ACTIVE) {
    return finish ? `the current schedule shows it finishing ${finish}` : "";
  }
  if (start && finish) {
    return `the current schedule shows ${start} to ${finish}`;
  }
  return finish ? `the current schedule shows it due ${finish}` : "";
}

function milestoneLine(milestone: MilestoneRow, now: Date): string {
  const words = scheduleWords(milestone, now);
  return `${field(milestone.name)} (${milestoneStatus(milestone.status)}${words ? `; ${words}` : ""})`;
}

/** In progress, the next few, and how far along — top-level stages only. */
function stageLines(
  milestones: readonly MilestoneRow[],
  now: Date,
  indent: string,
): string[] {
  const counted = milestones.filter(
    (m) => m.status !== MilestoneStatus.NOT_REQUIRED,
  );
  const current = counted.filter((m) => m.status === MilestoneStatus.ACTIVE);
  const next = counted
    .filter((m) => m.status === MilestoneStatus.PENDING)
    .slice(0, 3);
  const done = counted.filter((m) => m.status === MilestoneStatus.DONE).length;
  const lines: string[] = [];
  if (current.length > 0) {
    lines.push(
      `${indent}In progress: ${current
        .slice(0, 3)
        .map((m) => milestoneLine(m, now))
        .join("; ")}.`,
    );
  }
  if (next.length > 0) {
    lines.push(
      `${indent}Coming up: ${next.map((m) => milestoneLine(m, now)).join("; ")}.`,
    );
  }
  if (counted.length > 0) {
    lines.push(`${indent}Stages completed: ${done} of ${counted.length}.`);
  }
  if (lines.length === 0) lines.push(`${indent}No stages are scheduled yet.`);
  return lines;
}

function cap(lines: readonly string[]): string {
  const text = lines.join("\n");
  return text.length <= VOICE_BRIEFING_MAX_CHARS
    ? text
    : `${text.slice(0, VOICE_BRIEFING_MAX_CHARS - 40).trimEnd()}\n(more on file — offer the team)`;
}

async function clientBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
): Promise<Omit<VoiceBriefing, "callerClass" | "firstName">> {
  if (caller.identity.class !== "client") throw new Error("not a client");
  const { leadIds } = caller.identity;
  const today = startOfSydneyDay(now);
  const [projects, enquiries] = await Promise.all([
    db.project.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        location: true,
        milestones: {
          orderBy: { order: "asc" },
          select: MILESTONE_SELECT,
          where: { parentId: null },
        },
        name: true,
        status: true,
      },
      take: 3,
      where: clientProjectWhere(caller),
    }),
    leadIds.length
      ? db.lead.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            meetingCompletedAt: true,
            meetingDate: true,
            meetingMode: true,
            meetingTime: true,
            stage: true,
            type: true,
          },
          take: 3,
          where: {
            id: { in: [...leadIds] },
            isArchived: false,
            project: { is: null },
          },
        })
      : [],
  ]);

  const lines: string[] = [];
  if (projects.length > 0) {
    lines.push("Their projects with Royal Constructions:");
    for (const project of projects) {
      lines.push(
        `- ${field(project.name)} at ${field(project.location)}: ${clientProjectStatus(project.status)}.`,
      );
      lines.push(...stageLines(project.milestones, now, "  "));
    }
  }
  if (enquiries.length > 0) {
    lines.push("Their enquiries (not yet a project):");
    for (const lead of enquiries) {
      const kind = lead.type.length
        ? ` about ${field(lead.type.join(", "))}`
        : "";
      const meeting =
        lead.meetingDate
        && !lead.meetingCompletedAt
        && lead.meetingDate.getTime() >= today.getTime()
          ? ` A meeting is in the diary for ${spokenDate(lead.meetingDate, now)}${
              lead.meetingTime ? ` at ${field(lead.meetingTime, 10)}` : ""
            }${lead.meetingMode ? ` (${field(lead.meetingMode, 30)})` : ""}.`
          : "";
      lines.push(
        `- An enquiry${kind}: ${clientLeadStage(lead.stage)}.${meeting}`,
      );
    }
  }
  if (lines.length === 0) {
    lines.push("Nothing current is on file for them; offer the team.");
  }
  return {
    recordIds: [
      ...projects.map((p) => `project:${p.id}`),
      ...enquiries.map((l) => `lead:${l.id}`),
    ],
    text: cap(lines),
  };
}

async function tradieBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
) {
  const tradie = await currentVoiceTradie(caller, db);
  const today = startOfSydneyDay(now);
  // Resolved through the tradie's own engagement: the booking is found by
  // tradieId, and the project and activity come from the booking.
  const bookings = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      durationDays: true,
      id: true,
      milestone: { select: { name: true } },
      project: { select: { id: true, location: true, name: true } },
      scheduledDate: true,
      status: true,
      trade: true,
    },
    take: 10,
    where: {
      scheduledDate: { gte: addDays(today, -14), lt: addDays(today, 90) },
      status: { notIn: DEAD_BOOKINGS },
      tradieId: tradie.id,
    },
  });
  const lines = bookings.length
    ? [
        "Their bookings with Royal Constructions (from two weeks ago to three months ahead):",
        ...bookings.map((booking) => {
          const what = [
            booking.milestone ? field(booking.milestone.name) : null,
            booking.trade ? field(booking.trade, 40) : null,
          ]
            .filter(Boolean)
            .join(", ");
          const days =
            booking.durationDays > 1 ? ` for ${booking.durationDays} days` : "";
          return `- ${what || "Work"} at ${field(booking.project.name)}, ${field(booking.project.location)}: the current schedule shows ${spokenDate(booking.scheduledDate, now)}${days}; booking ${bookingStatus(booking.status)}.`;
        }),
      ]
    : [
        "No bookings are on file for them in the next three months; offer the team.",
      ];
  return {
    recordIds: [
      `tradie:${tradie.id}`,
      ...bookings.map((b) => `booking:${b.id}`),
    ],
    text: cap(lines),
  };
}

async function siteManagerBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
) {
  const principal = await currentVoiceStaff(caller, db);
  const today = startOfSydneyDay(now);
  const projects = await db.project.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      location: true,
      milestones: {
        orderBy: { order: "asc" },
        select: MILESTONE_SELECT,
        where: { parentId: null },
      },
      name: true,
      status: true,
      tradieSchedules: {
        orderBy: { scheduledDate: "asc" },
        select: {
          id: true,
          milestone: { select: { name: true } },
          scheduledDate: true,
          status: true,
          trade: true,
          tradie: { select: { name: true } },
        },
        take: 8,
        where: {
          scheduledDate: { gte: today, lt: addDays(today, 21) },
          status: { notIn: DEAD_BOOKINGS },
        },
      },
    },
    take: 6,
    where: {
      ...projectManageScope(principal),
      status: { not: ProjectStatus.COMPLETED },
    },
  });
  const lines: string[] = projects.length
    ? ["Projects assigned to them:"]
    : ["No live projects are assigned to them; offer the team."];
  for (const project of projects) {
    lines.push(
      `- ${field(project.name)} at ${field(project.location)}: ${staffProjectStatus(project.status)}.`,
    );
    lines.push(...stageLines(project.milestones, now, "  "));
    if (project.tradieSchedules.length > 0) {
      lines.push(
        `  Trades booked in the next three weeks: ${project.tradieSchedules
          .map(
            (b) =>
              `${field(b.tradie.name, 40)}${b.trade ? ` (${field(b.trade, 30)})` : ""}${b.milestone ? ` for ${field(b.milestone.name, 40)}` : ""} on ${spokenDate(b.scheduledDate, now)}, ${bookingStatus(b.status)}`,
          )
          .join("; ")}.`,
      );
    }
  }
  return {
    recordIds: [
      ...projects.map((p) => `project:${p.id}`),
      ...projects.flatMap((p) =>
        p.tradieSchedules.map((b) => `booking:${b.id}`),
      ),
    ],
    text: cap(lines),
  };
}

const LIVE_FOR_ADMIN: ProjectStatusType[] = [
  ProjectStatus.ACTIVE,
  ProjectStatus.ON_TRACK,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.DELAYED,
  ProjectStatus.COMPLIANCE_STARTED,
  ProjectStatus.COMPLIANCE_COMPLETED,
];

async function adminBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
) {
  const principal = await currentVoiceStaff(caller, db);
  const today = startOfSydneyDay(now);
  const [projects, bookings, pipeline, meetings] = await Promise.all([
    db.project.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        location: true,
        milestones: {
          orderBy: { order: "asc" },
          select: { name: true },
          take: 2,
          where: { parentId: null, status: MilestoneStatus.ACTIVE },
        },
        name: true,
        status: true,
      },
      take: 10,
      where: { ...projectReadScope(principal), status: { in: LIVE_FOR_ADMIN } },
    }),
    db.tradieSchedule.findMany({
      orderBy: { scheduledDate: "asc" },
      select: {
        id: true,
        project: { select: { name: true } },
        scheduledDate: true,
        status: true,
        trade: true,
        tradie: { select: { name: true } },
      },
      take: 12,
      where: {
        project: projectReadScope(principal),
        scheduledDate: { gte: today, lt: addDays(today, 7) },
        status: { notIn: DEAD_BOOKINGS },
      },
    }),
    searchLeads(
      principal,
      { includeArchived: false, limit: 1, page: 1, query: "" },
      db,
    ),
    db.lead.findMany({
      orderBy: { meetingDate: "asc" },
      select: { id: true, meetingDate: true, meetingTime: true, name: true },
      take: 6,
      where: {
        ...leadScopeWhere(principal),
        isArchived: false,
        meetingCompletedAt: null,
        meetingDate: { gte: today, lt: addDays(today, 2) },
      },
    }),
  ]);

  const lines: string[] = [];
  lines.push(
    projects.length
      ? "Live projects (most recently updated first):"
      : "No live projects.",
  );
  for (const project of projects) {
    const current = project.milestones.map((m) => field(m.name, 40)).join(", ");
    lines.push(
      `- ${field(project.name)} at ${field(project.location)}: ${staffProjectStatus(project.status)}${current ? `; in progress: ${current}` : ""}.`,
    );
  }
  lines.push(
    bookings.length
      ? "Trade bookings in the next seven days:"
      : "No trade bookings in the next seven days.",
  );
  for (const booking of bookings) {
    lines.push(
      `- ${spokenDate(booking.scheduledDate, now)}: ${field(booking.tradie.name, 40)}${booking.trade ? ` (${field(booking.trade, 30)})` : ""} at ${field(booking.project.name)}, ${bookingStatus(booking.status)}.`,
    );
  }
  const stages = Object.entries(pipeline.countsByStage)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([stage, count]) => `${staffLeadStage(stage as LeadStage)} ${count}`);
  lines.push(
    `Open leads: ${pipeline.totalCount}${stages.length ? ` (${stages.join(", ")})` : ""}.`,
  );
  if (meetings.length) {
    lines.push(
      `Lead meetings today and tomorrow: ${meetings
        .map(
          (m) =>
            `${field(m.name, 40)} ${spokenDate(m.meetingDate, now)}${m.meetingTime ? ` at ${field(m.meetingTime, 10)}` : ""}`,
        )
        .join("; ")}.`,
    );
  }
  return {
    recordIds: [
      ...projects.map((p) => `project:${p.id}`),
      ...bookings.map((b) => `booking:${b.id}`),
      ...meetings.map((m) => `lead:${m.id}`),
    ],
    text: cap(lines),
  };
}

/**
 * The briefing for this caller, or null for an unknown one (who gets none).
 *
 * Throws when the relationship no longer holds or the database fails; the
 * adapter then starts Mili as for an unknown caller. Audited before it is
 * returned, so nothing reaches her that the trail does not show.
 */
export async function briefVoiceCaller(
  caller: VoiceCallerPrincipal,
  input: { readonly now: Date },
  db: DomainDb,
): Promise<VoiceBriefing | null> {
  const identity = caller.identity;
  if (identity.class === "unknown") return null;
  const built =
    identity.class === "client"
      ? await clientBriefing(caller, db, input.now)
      : identity.class === "tradie"
        ? await tradieBriefing(caller, db, input.now)
        : identity.class === "site_manager"
          ? await siteManagerBriefing(caller, db, input.now)
          : await adminBriefing(caller, db, input.now);
  await recordCallerAccess(
    caller,
    { kind: "BRIEFING", outcome: "ok", recordIds: built.recordIds },
    db,
  );
  return {
    ...built,
    callerClass: identity.class,
    firstName: identity.firstName,
  };
}
