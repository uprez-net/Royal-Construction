import { Prisma } from "@prisma/client";

import { NEXT_FOLLOWUP_TASK } from "@/lib/leads/followup-resolution";

import type { DomainDb } from "../db";
import { reviveRow } from "../sql-json";

const LEAD_FILE_SELECT = {
  id: true,
  filename: true,
  filesize: true,
  url: true,
  fileType: true,
  createdAt: true,
  origin: true,
  tags: true,
  projectId: true,
} as const satisfies Prisma.FileSelect;

/**
 * Everything a lead screen reads about one lead, and the one shape `mapLead`
 * accepts. The writes in `commands.ts` load it through Prisma; the reads load
 * it through `readLeadRows` below, which must return it field for field
 * (`tests/leads/lead-row-sql-contract.test.ts`).
 *
 * `author` is `{ id, name }` and `chatSessions` only its ids: the screens show
 * the name and test for "has a chat session", and the whole `User` row put a
 * colleague's Clerk id, email and phone into every lead payload.
 */
export const LEAD_ROW_INCLUDE = {
  history: {
    orderBy: [{ actionDate: "asc" }, { id: "asc" }],
    include: { author: { select: { id: true, name: true } } },
  },
  chatSessions: { select: { id: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
  noteAnnotations: { orderBy: [{ createdAt: "desc" }, { id: "asc" }] },
  emails: { orderBy: [{ createdAt: "desc" }, { id: "asc" }] },
  // What `mapLead` reads of a file. The rest of the row (blob path, scanning
  // state, every foreign key) was about a third of a list page.
  files: { select: LEAD_FILE_SELECT },
  // The one task that decides the Follow-up cell. Not filtered to open work:
  // mapLead has to tell "the follow-up is done" apart from "this lead never
  // had one". See NEXT_FOLLOWUP_TASK.
  tasks: NEXT_FOLLOWUP_TASK,
} satisfies Prisma.LeadInclude;

export type LeadRow = Prisma.LeadGetPayload<{
  include: typeof LEAD_ROW_INCLUDE;
}>;

/**
 * Leads with every list `LEAD_ROW_INCLUDE` names, in ONE SQL statement.
 *
 * Prisma loads that include as a statement per relation: nine for one lead,
 * ten for a page with its count, about four round trips each. Here Postgres
 * builds each lead as JSON (`jsonb_agg` per list) and `reviveRow` turns the
 * JSON back into what Prisma would have returned (Dates, Decimals), so
 * `mapLead` and everything after it is unchanged. Issue #411 has the pattern;
 * `scripts/perf/compare-lead-read.ts` checks the two agree on real rows.
 *
 * `ids` come back in the order given, so a caller that paged with Prisma keeps
 * its order. `"all"` reads every lead, archived or not, as `getAllLeads` did.
 *
 * Applies no scope: the caller has already decided which ids it may read.
 */
export async function readLeadRows(
  ids: readonly number[] | "all",
  db: DomainDb,
): Promise<LeadRow[]> {
  if (ids !== "all" && ids.length === 0) return [];
  const filter =
    ids === "all" ? Prisma.empty : Prisma.sql`WHERE l.id = ANY(${[...ids]})`;

  const rows = await db.$queryRaw<{ lead: Record<string, unknown> }[]>`
    SELECT to_jsonb(l) || jsonb_build_object(
      'history', (
        SELECT coalesce(jsonb_agg(
          to_jsonb(h) || jsonb_build_object('author', (
            SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM "User" u WHERE u.id = h."authorId"
          ))
          ORDER BY h."actionDate" ASC, h.id ASC
        ), '[]')
        FROM "LeadHistory" h WHERE h."leadId" = l.id
      ),
      'chatSessions', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', cs.id)), '[]')
        FROM "ChatSession" cs WHERE cs."leadId" = l.id
      ),
      'assignedUser', (
        SELECT jsonb_build_object('id', au.id, 'name', au.name, 'email', au.email)
        FROM "User" au WHERE au.id = l."assignedId"
      ),
      'noteAnnotations', (
        SELECT coalesce(jsonb_agg(to_jsonb(na) ORDER BY na."createdAt" DESC, na.id ASC), '[]')
        FROM "LeadNoteAnnotation" na WHERE na."leadId" = l.id
      ),
      'emails', (
        SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e."createdAt" DESC, e.id ASC), '[]')
        FROM "LeadEmails" e WHERE e."leadId" = l.id
      ),
      'files', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', f.id, 'filename', f.filename, 'filesize', f.filesize, 'url', f.url,
          'fileType', f."fileType", 'createdAt', f."createdAt", 'origin', f.origin,
          'tags', f.tags, 'projectId', f."projectId"
        )), '[]')
        FROM "File" f WHERE f."leadId" = l.id
      ),
      -- NEXT_FOLLOWUP_TASK: open work first, then the earliest due, take 1.
      'tasks', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'dueDate', t."dueDate", 'dueTime', t."dueTime", 'completedAt', t."completedAt"
        )), '[]')
        FROM (
          SELECT * FROM "LeadTask" lt WHERE lt."leadId" = l.id
          ORDER BY lt."completedAt" ASC NULLS FIRST, lt."dueDate" ASC NULLS LAST, lt.id ASC
          LIMIT 1
        ) t
      )
    ) AS lead
    FROM "Lead" l
    ${filter}
  `;

  const leads = rows.map((row) => reviveRow(row.lead, "Lead") as LeadRow);
  if (ids === "all") return leads;
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
