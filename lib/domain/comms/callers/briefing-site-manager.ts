import { ProjectStatus } from "@prisma/client";

import type { DomainDb } from "../../db";
import { projectManageScope } from "../../access/projects";
import {
  cap,
  DEAD_BOOKINGS,
  MILESTONE_SELECT,
  stageLines,
  type BuiltBriefing,
} from "./briefing-lines";
import type { VoiceCallerPrincipal } from "./identity";
import { currentVoiceStaff } from "./relationships";
import {
  addDays,
  bookingStatus,
  field,
  spokenDate,
  staffProjectStatus,
  startOfSydneyDay,
} from "./speech";

// SITE_MANAGER: the projects assigned to them (projectManageScope): stages,
// dates and the trades booked. No prices, costs or payments (#158).

export async function siteManagerBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
): Promise<BuiltBriefing> {
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
