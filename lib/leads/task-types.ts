import type { LeadTaskStatus, LeadTaskType } from "@prisma/client";

/**
 * One task, plus the bit of its lead a row needs to render.
 *
 * Lives here rather than beside the queries so client modules never reach into
 * lib/data for it. A type-only import is erased today, but one refactor turning
 * it into a value import would pull Prisma into the browser bundle.
 */
export interface LeadTaskRow {
  id: number;
  leadId: number;
  type: LeadTaskType;
  status: LeadTaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  notes: string | null;
  completedAt: string | null;
  lead: {
    id: number;
    name: string;
    stage: string;
    phone: string | null;
    email: string | null;
    assignedName: string | null;
  };
}
