import { Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { reviveRow } from "../sql-json";

/**
 * The project detail row, with every list the project page shows, in ONE SQL
 * statement.
 *
 * Prisma's default way to load `projectDetailInclude` is a statement per
 * relation per level: 61 statements for a busy project, in about ten rounds,
 * each paying a full round trip to the database. Here Postgres builds the
 * whole tree as JSON instead (`jsonb_agg` per list), so the page pays one round
 * trip for it. `reviveRow` then turns the JSON back into exactly what Prisma
 * would have returned (Dates, Decimals), so nothing downstream changes.
 *
 * The statement must return the shape of `projectDetailInclude` in
 * `queries.ts`, field for field. `scripts/perf/compare-project-read.ts`
 * snapshots the read with every value's type, so a drift between the two shows
 * up as a diff (issue #411 has the comparison that shipped this).
 *
 * `certifierEngagement` is not in here: its include is the compliance
 * module's canonical shape, so it is read through Prisma, alongside this.
 *
 * Applies only the scope it is given; the caller passes
 * `projectReadScope(principal)`. Staff notes on each milestone are read only
 * when `milestoneNotes` is set — `canSeeMilestoneNotes(principal)` — and are
 * an empty list otherwise, so a customer's payload never carries one.
 */
export async function readProjectDetailRow(
  projectId: string,
  scope: { customerId?: string },
  db: DomainDb,
  options: { milestoneNotes: boolean },
): Promise<Record<string, unknown> | null> {
  // A scope rule this statement does not know about must not be dropped
  // silently: that would widen what a caller can read.
  const unknownScope = Object.keys(scope).filter((key) => key !== "customerId");
  if (unknownScope.length > 0) {
    throw new Error(
      `readProjectDetailRow cannot apply scope ${unknownScope.join(", ")}`,
    );
  }
  const customerFilter =
    scope.customerId !== undefined
      ? Prisma.sql`AND p."customerId" = ${scope.customerId}`
      : Prisma.empty;
  const milestoneNotes = options.milestoneNotes
    ? Prisma.sql`(
        SELECT coalesce(jsonb_agg(
          to_jsonb(n) || jsonb_build_object('author', (
            SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM "User" u WHERE u.id = n."authorId"
          ))
          ORDER BY n."createdAt" DESC, n.id ASC
        ), '[]')
        FROM "MilestoneNote" n WHERE n."milestoneId" = m.id
      )`
    : Prisma.sql`'[]'::jsonb`;

  const rows = await db.$queryRaw<{ project: Record<string, unknown> }[]>`
    SELECT to_jsonb(p) || jsonb_build_object(
      'customer', (SELECT to_jsonb(c) FROM "Customer" c WHERE c.id = p."customerId"),
      'siteManager', (
        SELECT jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'phone', u.phone)
        FROM "User" u WHERE u.id = p."siteManagerId"
      ),
      'invoices', (
        SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i."issuedDate" DESC), '[]')
        FROM "Invoice" i WHERE i."projectId" = p.id
      ),
      'Lead', (
        SELECT jsonb_build_object(
          'id', l.id, 'email', l.email, 'type', l.type, 'location', l.location,
          'assignedId', l."assignedId",
          'emails', (
            SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e."sentAt" ASC), '[]')
            FROM "LeadEmails" e WHERE e."leadId" = l.id
          )
        )
        FROM "Lead" l WHERE l.id = p."leadId"
      ),
      'activityLogs', (
        SELECT coalesce(jsonb_agg(
          to_jsonb(a) || jsonb_build_object('author', (
            SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM "User" u WHERE u.id = a."authorId"
          ))
          ORDER BY a."createdAt" DESC
        ), '[]')
        FROM "ActivityLog" a WHERE a."projectId" = p.id
      ),
      'milestones', (
        SELECT coalesce(jsonb_agg(
          to_jsonb(m) || jsonb_build_object(
            'requiredTradeTypes', (
              SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) ORDER BY t.label ASC), '[]')
              FROM "_MilestoneRequiredTrades" mt JOIN "TradeType" t ON t.id = mt."B"
              WHERE mt."A" = m.id
            ),
            'siteUpdates', (
              SELECT coalesce(jsonb_agg(
                to_jsonb(s) || jsonb_build_object('author', (
                  SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM "User" u WHERE u.id = s."authorId"
                ))
              ), '[]')
              FROM "SiteUpdate" s WHERE s."milestoneId" = m.id
            ),
            'files', (
              SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]')
              FROM "File" f WHERE f."milestoneId" = m.id
            ),
            'notes', ${milestoneNotes}
          )
          ORDER BY m."order" ASC
        ), '[]')
        FROM "Milestone" m WHERE m."projectId" = p.id
      ),
      'siteUpdates', (
        SELECT coalesce(jsonb_agg(
          to_jsonb(s) || jsonb_build_object(
            'author', (
              SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM "User" u WHERE u.id = s."authorId"
            ),
            'milestone', (SELECT to_jsonb(sm) FROM "Milestone" sm WHERE sm.id = s."milestoneId")
          )
          ORDER BY s."createdAt" DESC
        ), '[]')
        FROM "SiteUpdate" s WHERE s."projectId" = p.id
      ),
      'variations', (
        SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v."createdAt" DESC), '[]')
        FROM "Variation" v WHERE v."projectId" = p.id
      ),
      'tradieSchedules', (
        SELECT coalesce(jsonb_agg(
          to_jsonb(ts) || jsonb_build_object(
            'tradie', (SELECT to_jsonb(td) FROM "Tradie" td WHERE td.id = ts."tradieId"),
            'milestone', (
              SELECT jsonb_build_object(
                'id', bm.id, 'name', bm.name, 'status', bm.status,
                'targetDate', bm."targetDate", 'startDate', bm."startDate",
                'budget', bm.budget, 'spend', bm.spend, 'parentId', bm."parentId",
                'order', bm."order", 'projectStage', bm."projectStage"
              )
              FROM "Milestone" bm WHERE bm.id = ts."milestoneId"
            ),
            'requestRecipient', (
              SELECT jsonb_build_object(
                'id', r.id, 'deliveryStatus', r."deliveryStatus", 'attempts', r.attempts,
                'lastAttemptAt', r."lastAttemptAt", 'nextAttemptAt', r."nextAttemptAt",
                'sentAt', r."sentAt", 'lastError', r."lastError", 'toAddress', r."toAddress",
                'createdAt', r."createdAt",
                'request', (
                  SELECT jsonb_build_object('id', q.id, 'createdAt', q."createdAt", 'subject', q.subject, 'kind', q.kind)
                  FROM "TradieRequest" q WHERE q.id = r."requestId"
                )
              )
              FROM "TradieRequestRecipient" r WHERE r.id = ts."requestRecipientId"
            ),
            'invoices', (
              SELECT coalesce(jsonb_agg(jsonb_build_object('status', ti.status, 'subTotal', ti."subTotal")), '[]')
              FROM "TradieInvoice" ti WHERE ti."scheduleId" = ts.id
            ),
            'quote', (
              SELECT jsonb_build_object(
                'id', qt.id, 'source', qt.source, 'gstTreatment', qt."gstTreatment",
                'quotedAt', qt."quotedAt", 'validUntil', qt."validUntil", 'notes', qt.notes,
                'enteredBy', (SELECT jsonb_build_object('name', u.name) FROM "User" u WHERE u.id = qt."enteredById")
              )
              FROM "TradieQuote" qt WHERE qt.id = ts."quoteId"
            )
          )
          ORDER BY ts."scheduledDate" ASC
        ), '[]')
        FROM "TradieSchedule" ts WHERE ts."projectId" = p.id
      ),
      'tradeSelections', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', sel.id, 'trade', sel.trade, 'tradeKey', sel."tradeKey", 'tradieId', sel."tradieId",
            'status', sel.status, 'selectedAt', sel."selectedAt", 'cancelledAt', sel."cancelledAt",
            'tradie', (SELECT jsonb_build_object('name', td.name) FROM "Tradie" td WHERE td.id = sel."tradieId"),
            'selectedBy', (SELECT jsonb_build_object('name', u.name) FROM "User" u WHERE u.id = sel."selectedById")
          )
          ORDER BY sel."selectedAt" DESC
        ), '[]')
        FROM "TradeSelection" sel WHERE sel."projectId" = p.id
      ),
      'files', (
        SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]')
        FROM "File" f WHERE f."projectId" = p.id
      ),
      'materials', (
        SELECT coalesce(jsonb_agg(to_jsonb(mat)), '[]')
        FROM "Material" mat WHERE mat."projectId" = p.id
      )
    ) AS project
    FROM "Project" p
    WHERE p.id = ${projectId} ${customerFilter}
    LIMIT 1
  `;

  const row = rows[0]?.project;
  return row ? (reviveRow(row, "Project") as Record<string, unknown>) : null;
}
