import {
  MilestoneStatus,
  ProjectStatus,
  type LeadStage,
  type ProjectStatus as ProjectStatusType,
} from "@prisma/client";

import type { DomainDb } from "../../db";
import { projectReadScope } from "../../access/projects";
import { searchLeads } from "../../leads/queries";
import { cap, DEAD_BOOKINGS, type BuiltBriefing } from "./briefing-lines";
import type { VoiceCallerPrincipal } from "./identity";
import { currentVoiceStaff } from "./relationships";
import { leadListScope } from "../../access/leads";
import { meetingsBetweenWhere } from "@/lib/leads/followup-due";
import {
  addDays,
  bookingStatus,
  field,
  spokenDate,
  staffLeadStage,
  staffProjectStatus,
  startOfSydneyDay,
} from "./speech";

// ADMIN: an overview — live projects, the week's bookings, the pipeline and
// today's meetings. Anything else is a catalogue lookup (lookups.ts).

const LIVE_FOR_ADMIN: ProjectStatusType[] = [
  ProjectStatus.ACTIVE,
  ProjectStatus.ON_TRACK,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.DELAYED,
  ProjectStatus.COMPLIANCE_STARTED,
  ProjectStatus.COMPLIANCE_COMPLETED,
];

export async function adminBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
): Promise<BuiltBriefing> {
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
    // A meeting is a MEETING lead task (#193); `Lead.meetingDate` is the
    // retired column the task form never sets. Same rule as the office digest
    // and the agent's meetings read (#618).
    db.leadTask.findMany({
      orderBy: [{ dueDate: "asc" }, { dueTime: "asc" }],
      select: {
        dueDate: true,
        dueTime: true,
        lead: { select: { id: true, name: true } },
      },
      take: 6,
      where: meetingsBetweenWhere({
        assignedId: leadListScope(principal).assignedId,
        from: today,
        to: new Date(addDays(today, 2).getTime() - 1),
      }),
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
            `${field(m.lead.name, 40)} ${m.dueDate ? spokenDate(m.dueDate, now) : ""}${m.dueTime ? ` at ${field(m.dueTime, 10)}` : ""}`,
        )
        .join("; ")}.`,
    );
  }
  return {
    recordIds: [
      ...projects.map((p) => `project:${p.id}`),
      ...bookings.map((b) => `booking:${b.id}`),
      ...meetings.map((m) => `lead:${m.lead.id}`),
    ],
    text: cap(lines),
  };
}
