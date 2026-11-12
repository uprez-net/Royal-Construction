import { formatSydneyDate } from "@/lib/dates/sydney";
import type { DomainDb } from "../db";
import { isDomainError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeComplianceAccess } from "../access/compliance";
import { authorizeLead } from "../access/leads";
import { authorizeOffer } from "../access/offers";
import { authorizeMilestone, authorizeProject } from "../access/projects";
import { authorizeTradie, authorizeTradieSchedule } from "../access/tradies";

// What an approval is about, in words.
//
// An Eve approval names its target only by the ids in the tool input — a
// milestone approval read "Milestone Id e5924aa1-…" and nothing else, so the
// person approving could not check it against what they meant. Eve's approval
// request carries no custom prompt, so the names are looked up here, from the
// database, and never taken from the model.
//
// Each id goes through the same access rule the tool itself applies. One the
// caller may not see — or that does not exist — is simply left out, and the
// card shows the raw id it was given; the label never confirms that someone
// else's record exists.

/** Tool-input field → the name the approval card shows beside it. */
export type ApprovalTargetLabels = Readonly<Record<string, string>>;

/**
 * The tool-input fields this module can name. A caller that shows an approval
 * uses it to tell "this field had no name to look up" from "the lookup failed
 * or the caller may not see it" — the second must not read like the first.
 */
export const APPROVAL_TARGET_FIELDS = [
  "alertId",
  "documentId",
  "leadId",
  "milestoneId",
  "offerId",
  "parentId",
  "projectId",
  "scheduleId",
  "taskId",
  "tradieId",
] as const;

type ApprovalTargetField = (typeof APPROVAL_TARGET_FIELDS)[number];

type Resolver = (
  value: unknown,
  input: Readonly<Record<string, unknown>>,
) => Promise<string | null>;

export async function describeApprovalTargets(
  principal: DomainPrincipal,
  input: Readonly<Record<string, unknown>>,
  db: DomainDb,
): Promise<ApprovalTargetLabels> {
  const resolvers: Record<ApprovalTargetField, Resolver> = {
    alertId: (value, fields) =>
      complianceRecordLabel(principal, value, fields, db, "alert"),
    documentId: (value, fields) =>
      complianceRecordLabel(principal, value, fields, db, "document"),
    leadId: (value) => leadLabel(principal, value, db),
    milestoneId: (value) => milestoneLabel(principal, value, db),
    offerId: (value) => offerLabel(principal, value, db),
    parentId: (value) => milestoneLabel(principal, value, db),
    projectId: (value) => projectLabel(principal, value, db),
    scheduleId: (value) => scheduleLabel(principal, value, db),
    taskId: (value) => leadTaskLabel(principal, value, db),
    tradieId: (value) => tradieLabel(principal, value, db),
  };

  const entries = await Promise.all(
    Object.entries(resolvers)
      .filter(([field]) => input[field] !== undefined && input[field] !== null)
      .map(async ([field, resolve]) => {
        const label = await visibleOnly(() => resolve(input[field], input));
        return label === null ? null : ([field, label] as const);
      }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

/** A refusal or a missing record is "no label"; anything else still throws. */
async function visibleOnly(
  lookup: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await lookup();
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

async function leadLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  const leadId = asInteger(value);
  if (leadId === null) return null;
  await authorizeLead(principal, leadId, db);
  const lead = await db.lead.findUnique({
    select: { location: true, name: true },
    where: { id: leadId },
  });
  // Name and site, not the database number: the office knows a client by
  // who and where, and the site tells apart two leads with the same name.
  return lead ? withPlace(lead.name, lead.location) : null;
}

async function leadTaskLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  const taskId = asInteger(value);
  if (taskId === null) return null;
  const task = await db.leadTask.findUnique({
    select: {
      dueDate: true,
      dueTime: true,
      lead: { select: { name: true } },
      leadId: true,
      notes: true,
      type: true,
    },
    where: { id: taskId },
  });
  if (!task) return null;
  await authorizeLead(principal, task.leadId, db);
  // A lead often has several open tasks of one type (four meetings on one
  // lead is ordinary), so the type alone does not say which one is being
  // changed. The due date and what the task is for do.
  const due = task.dueDate
    ? `due ${formatSydneyDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}`
    : null;
  const what = task.notes ? excerpt(task.notes, 60) : null;
  return [`${humanize(task.type)} task`, due, what, task.lead.name]
    .filter(Boolean)
    .join(" · ");
}

async function offerLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  if (typeof value !== "string") return null;
  await authorizeOffer(principal, value, db, { allowInactive: true });
  const offer = await db.offer.findUnique({
    select: {
      baseReference: true,
      lead: { select: { name: true } },
      leadId: true,
      revisionNumber: true,
    },
    where: { id: value },
  });
  if (!offer) return null;
  const reference = offer.baseReference.trim() || `OF-${offer.leadId}`;
  return `${reference}-R${offer.revisionNumber} · ${offer.lead.name}`;
}

async function projectLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  if (typeof value !== "string") return null;
  const project = await authorizeProject(principal, value, db);
  return project.name;
}

async function milestoneLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  if (typeof value !== "string") return null;
  const { project } = await authorizeMilestone(principal, value, db);
  const milestone = await db.milestone.findUnique({
    select: { name: true },
    where: { id: value },
  });
  return milestone ? `${milestone.name} · ${project.name}` : null;
}

async function tradieLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  if (typeof value !== "string") return null;
  await authorizeTradie(principal, value, db);
  const tradie = await db.tradie.findUnique({
    select: { name: true, trade: true },
    where: { id: value },
  });
  return tradie ? `${tradie.name} (${tradie.trade})` : null;
}

async function scheduleLabel(
  principal: DomainPrincipal,
  value: unknown,
  db: DomainDb,
) {
  if (typeof value !== "string") return null;
  await authorizeTradieSchedule(principal, value, db);
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      project: { select: { name: true } },
      tradie: { select: { name: true } },
    },
    where: { id: value },
  });
  return schedule
    ? `${schedule.tradie.name} booking · ${schedule.project.name}`
    : null;
}

/**
 * A compliance document or alert, checked against the project named beside it
 * and that project's own engagement — an id from one project cannot borrow
 * another's label.
 */
async function complianceRecordLabel(
  principal: DomainPrincipal,
  value: unknown,
  input: Readonly<Record<string, unknown>>,
  db: DomainDb,
  kind: "alert" | "document",
) {
  const projectId = input.projectId;
  if (typeof value !== "string" || typeof projectId !== "string") return null;
  const { engagement } = await authorizeComplianceAccess(
    principal,
    projectId,
    db,
  );
  if (!engagement) return null;
  if (kind === "document") {
    const document = await db.complianceDocument.findFirst({
      select: { documentType: true, label: true },
      where: { engagementId: engagement.id, id: value },
    });
    return document
      ? document.label?.trim() || humanize(document.documentType)
      : null;
  }
  const alert = await db.complianceAlert.findFirst({
    select: { type: true },
    where: { engagementId: engagement.id, id: value },
  });
  return alert ? `${humanize(alert.type)} alert` : null;
}

function withPlace(name: string, location: string | null | undefined) {
  const place = location?.trim();
  return place ? `${name} — ${place}` : name;
}

function excerpt(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function asInteger(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number"
    && Number.isSafeInteger(parsed)
    && parsed > 0
    ? parsed
    : null;
}

function humanize(value: string) {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
