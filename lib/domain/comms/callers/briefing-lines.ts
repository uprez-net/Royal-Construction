import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";

import { field, milestoneStatus, spokenDate } from "./speech";

// The pieces every role's briefing (briefing-*.ts) is built from: how a stage
// reads out, the length cap, and the bookings nobody is told about.

/** What a role's builder hands back: the text, and the ids it read. */
export type BuiltBriefing = {
  readonly text: string;
  readonly recordIds: readonly string[];
};

/** A briefing longer than this is cut: a phone call is not a report. */
export const VOICE_BRIEFING_MAX_CHARS = 6_000;

export const DEAD_BOOKINGS = [
  TradieScheduleStatus.CANCELLED,
  TradieScheduleStatus.DECLINED,
];

type MilestoneRow = {
  readonly name: string;
  readonly status: MilestoneStatus;
  readonly startDate: Date | null;
  readonly targetDate: Date;
};

export const MILESTONE_SELECT = {
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
export function stageLines(
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

export function cap(lines: readonly string[]): string {
  const text = lines.join("\n");
  return text.length <= VOICE_BRIEFING_MAX_CHARS
    ? text
    : `${text.slice(0, VOICE_BRIEFING_MAX_CHARS - 40).trimEnd()}\n(more on file — offer the team)`;
}
