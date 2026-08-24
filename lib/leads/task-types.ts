import type { LeadTaskStatus, LeadTaskType } from "@prisma/client";

import type { LeadStage } from "@/lib/leads/types";

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
    /**
     * The UI label, "Discovery", not the Prisma enum "DISCOVERY".
     *
     * It was typed as string and passed through raw. Every consumer treats it
     * as a UI label: three assign it straight onto a Lead, and the rest render
     * it or look it up in STAGE_STYLES. Assigning the enum made stageDef()
     * throw and took the whole lead page down with "This lead could not be
     * loaded". Typed properly now, so that cannot compile again.
     */
    stage: LeadStage;
    phone: string | null;
    email: string | null;
    assignedName: string | null;
  };
}
