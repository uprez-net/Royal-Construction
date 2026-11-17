import type { DomainDb } from "../../db";
import {
  cap,
  MILESTONE_SELECT,
  stageLines,
  type BuiltBriefing,
} from "./briefing-lines";
import type { VoiceCallerPrincipal } from "./identity";
import { clientProjectWhere } from "./relationships";
import {
  clientLeadStage,
  clientProjectStatus,
  field,
  spokenDate,
  startOfSydneyDay,
} from "./speech";

// CLIENT: their own projects (status, current and next stages, the current
// schedule's dates) and their enquiries with no project yet. No prices,
// notes, staff or other people.

export async function clientBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
): Promise<BuiltBriefing> {
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
