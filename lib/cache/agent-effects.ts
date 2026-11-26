import type { DomainDb } from "@/lib/domain/db";
import { ADMIN_OFFER_CONTENT_TAG } from "@/types/admin-offer-content";

// What an operations-agent write means for the app's caches.
//
// Eve runs outside the Next request that owns `revalidateTag`, so before this
// an agent write committed and the screens went on showing the old record
// until their cache expired on its own — the agent even warned "may show the
// previous budget for a few minutes". Now every audited agent write reports
// the records it touched (agent/lib/mutation-effects.ts) to one route
// (app/api/agent/effects), and this module is the single table from "a record
// changed" to "these tags are stale". A new cached screen adds its tag here,
// once, and every agent tool that touches that record expires it.

/** A record the agent changed, as the tool reported it. */
export type EffectRef = { readonly type: string; readonly id: string };

const MAX_REFS = 50;
const KNOWN_TYPES = new Set([
  "adminContent",
  "approval",
  "complianceDocument",
  "lead",
  "leadTask",
  "milestone",
  "milestoneTemplate",
  "offer",
  "offerRevision",
  /** Not a screen: a scheduled owner call whose timer is started here. */
  "ownerCall",
  "project",
  "teamMember",
  "tradie",
  "tradieSchedule",
]);

/** Shape-check an untrusted body: known types, bounded ids, no duplicates. */
export function parseEffectRefs(body: unknown): EffectRef[] {
  const raw =
    body
    && typeof body === "object"
    && Array.isArray((body as { refs?: unknown }).refs)
      ? (body as { refs: unknown[] }).refs
      : [];
  const seen = new Set<string>();
  const refs: EffectRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { type, id } = entry as { type?: unknown; id?: unknown };
    if (typeof type !== "string" || !KNOWN_TYPES.has(type)) continue;
    const value = typeof id === "number" ? String(id) : id;
    if (typeof value !== "string" || !/^[\w-]{1,100}$/.test(value)) continue;
    const key = `${type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ id: value, type });
    if (refs.length === MAX_REFS) break;
  }
  return refs;
}

/** The records whose screens are stale, after following parent links. */
export type AffectedRecords = {
  leadIds: Set<number>;
  offerIds: Set<string>;
  projectIds: Set<string>;
  tradieIds: Set<string>;
  schedules: boolean;
  approvals: boolean;
  adminContent: boolean;
  team: boolean;
  allProjects: boolean;
};

export function emptyAffected(): AffectedRecords {
  return {
    adminContent: false,
    allProjects: false,
    approvals: false,
    leadIds: new Set(),
    offerIds: new Set(),
    projectIds: new Set(),
    schedules: false,
    team: false,
    tradieIds: new Set(),
  };
}

function leadId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Follow each ref to everything that shows it: an offer to its lead and
 * project, a milestone or booking to its project, a lead to its project.
 * Reads only; a ref that names nothing simply adds nothing.
 */
export async function resolveAffected(
  refs: readonly EffectRef[],
  db: DomainDb,
): Promise<AffectedRecords> {
  const out = emptyAffected();
  const offerIds = new Set<string>();
  const milestoneIds = new Set<string>();
  const scheduleIds = new Set<string>();
  const taskIds = new Set<number>();

  for (const ref of refs) {
    switch (ref.type) {
      case "lead": {
        const id = leadId(ref.id);
        if (id) out.leadIds.add(id);
        break;
      }
      case "leadTask": {
        const id = leadId(ref.id);
        if (id) taskIds.add(id);
        break;
      }
      case "offer":
      case "offerRevision":
        offerIds.add(ref.id);
        break;
      case "project":
        out.projectIds.add(ref.id);
        break;
      case "milestone":
        milestoneIds.add(ref.id);
        break;
      case "complianceDocument":
        // Reported alongside its project; the document alone names no screen.
        break;
      case "tradie":
        out.tradieIds.add(ref.id);
        break;
      case "tradieSchedule":
        scheduleIds.add(ref.id);
        out.schedules = true;
        break;
      case "approval":
        out.approvals = true;
        break;
      case "adminContent":
        out.adminContent = true;
        break;
      case "teamMember":
        out.team = true;
        break;
      case "milestoneTemplate":
        out.allProjects = true;
        break;
    }
  }

  const [offers, milestones, schedules, tasks] = await Promise.all([
    offerIds.size
      ? db.offer.findMany({
          select: { id: true, leadId: true },
          where: { id: { in: [...offerIds] } },
        })
      : [],
    milestoneIds.size
      ? db.milestone.findMany({
          select: { projectId: true },
          where: { id: { in: [...milestoneIds] } },
        })
      : [],
    scheduleIds.size
      ? db.tradieSchedule.findMany({
          select: { projectId: true, tradieId: true },
          where: { id: { in: [...scheduleIds] } },
        })
      : [],
    taskIds.size
      ? db.leadTask.findMany({
          select: { leadId: true },
          where: { id: { in: [...taskIds] } },
        })
      : [],
  ]);
  for (const offer of offers) {
    out.offerIds.add(offer.id);
    out.leadIds.add(offer.leadId);
  }
  for (const milestone of milestones) out.projectIds.add(milestone.projectId);
  for (const schedule of schedules) {
    out.projectIds.add(schedule.projectId);
    out.tradieIds.add(schedule.tradieId);
  }
  for (const task of tasks) out.leadIds.add(task.leadId);

  // A lead's project and active offer show the lead's name and stage.
  if (out.leadIds.size) {
    const leads = await db.lead.findMany({
      select: {
        offers: { select: { id: true }, where: { isActive: true } },
        project: { select: { id: true } },
      },
      where: { id: { in: [...out.leadIds] } },
    });
    for (const lead of leads) {
      if (lead.project) out.projectIds.add(lead.project.id);
      for (const offer of lead.offers) out.offerIds.add(offer.id);
    }
  }

  if (out.allProjects) {
    const open = await db.project.findMany({
      select: { id: true },
      where: { status: { not: "COMPLETED" } },
    });
    for (const project of open) out.projectIds.add(project.id);
  }
  return out;
}

/** Every cache tag a set of changed records makes stale. Pure. */
export function cacheTagsFor(affected: AffectedRecords): string[] {
  const tags = new Set<string>();
  for (const id of affected.leadIds) {
    tags.add(`offer-lead-${id}`);
    tags.add(`chat-session-lead-${id}`);
  }
  if (affected.offerIds.size || affected.leadIds.size) tags.add("offers");
  for (const id of affected.offerIds) tags.add(`offer-${id}`);
  if (affected.projectIds.size) tags.add("projects");
  for (const id of affected.projectIds) {
    tags.add(`project-${id}`);
    tags.add(`certifier-engagement-${id}`);
    tags.add(`compliance-${id}`);
  }
  if (affected.tradieIds.size) {
    tags.add("tradies");
    tags.add("tradie-management");
  }
  for (const id of affected.tradieIds) tags.add(`tradie-${id}`);
  if (affected.schedules) tags.add("tradies-schedules");
  if (affected.approvals) {
    tags.add("approval-query");
    tags.add("approval-kpi");
    tags.add("tradie-management");
  }
  if (affected.adminContent) tags.add(ADMIN_OFFER_CONTENT_TAG);
  if (affected.team) tags.add("site-managers");
  if (affected.allProjects) tags.add("milestone-trade-dependencies");
  return [...tags].sort();
}
