import { formatSydneyDate } from "@/lib/dates/sydney";

// The words the operations agent reads about a record before it asks for it.
//
// Pure and deterministic on purpose: the same record always produces the same
// text, so `contentHash` only changes when the business did, and a test can pin
// the wording. No model writes or summarises any of it — what the agent knows
// about a client is exactly what the CRM says, laid out the way the office
// talks about it (names, addresses, stages, money, dates), never paraphrased.
//
// Every chunk ends with a "Refs" line. Those ids are for tool calls only; the
// agent's instructions forbid repeating them to people.

export type AgentContextKind = "lead" | "project" | "tradie" | "digest";

export type ChunkDraft = {
  readonly kind: AgentContextKind;
  readonly entityId: string;
  readonly title: string;
  readonly content: string;
};

export type LeadContextSource = {
  id: number;
  name: string;
  location: string;
  stage: string;
  source: string | null;
  type: readonly string[];
  budget: string | null;
  urgent: boolean;
  estimatedValue: number | null;
  expectedCloseDate: Date | null;
  estimatedStartDate: Date | null;
  followupDate: Date | null;
  followupTime: string | null;
  meetingDate: Date | null;
  meetingTime: string | null;
  meetingMode: string | null;
  lostReason: string | null;
  secondaryName: string | null;
  assignedName: string | null;
  updatedAt: Date;
  openTasks: readonly {
    type: string;
    dueDate: Date | null;
    dueTime: string | null;
    notes: string | null;
  }[];
  recentHistory: readonly {
    action: string;
    detail: string;
    type: string;
    actionDate: Date;
  }[];
  activeOffer: {
    id: string;
    reference: string;
    revisionNumber: number;
    status: string;
    totalAmount: number;
    contractValueIncGst: number | null;
    sentAt: Date | null;
    updatedAt: Date;
  } | null;
  project: { id: string; name: string; status: string } | null;
};

export type ProjectContextSource = {
  id: string;
  name: string;
  location: string;
  council: string;
  buildingType: string;
  status: string;
  leadId: number;
  customerNames: readonly string[];
  siteManagerName: string | null;
  totalBudget: number;
  spent: number;
  startDate: Date;
  estimatedEndDate: Date;
  milestones: readonly {
    name: string;
    projectStage: string;
    status: string;
    targetDate: Date;
    startDate: Date | null;
    isTopLevel: boolean;
  }[];
  compliance: {
    status: string;
    certifierName: string | null;
    openAlerts: readonly string[];
  } | null;
  invoices: readonly {
    projectStage: string;
    status: string;
    total: number;
    amountDue: number;
  }[];
  checklists: readonly { title: string; status: string }[];
  upcomingBookings: readonly {
    tradieName: string;
    trade: string | null;
    scheduledDate: Date;
    durationDays: number;
    status: string;
  }[];
  openVariations: number;
};

export type TradieContextSource = {
  id: string;
  name: string;
  trade: string;
  trades: readonly string[];
  location: string | null;
  rating: number | null;
  isFavourite: boolean;
  lastQuotedPrice: number | null;
  lastQuotedPriceUnit: string;
  openIncidents: number;
  upcomingBookings: readonly {
    projectName: string;
    scheduledDate: Date;
    status: string;
  }[];
};

export type OfficeDigestSource = {
  generatedAt: Date;
  leadsByStage: Readonly<Record<string, number>>;
  offersByStatus: Readonly<Record<string, number>>;
  projectsByStatus: Readonly<Record<string, number>>;
  overdueTasks: readonly { leadName: string; type: string; dueDate: Date }[];
  upcomingMeetings: readonly {
    leadName: string;
    date: Date;
    time: string | null;
  }[];
  awaitingSignature: readonly {
    leadName: string;
    reference: string;
    status: string;
    sentAt: Date | null;
  }[];
  activeProjects: readonly {
    name: string;
    status: string;
    currentActivity: string | null;
    nextActivity: string | null;
  }[];
  openComplianceAlerts: number;
  outstandingInvoices: { count: number; amountDue: number };
};

const MAX_HISTORY_DETAIL = 220;
const MAX_TASK_NOTE = 160;

export function humanizeEnum(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatAud(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    currency: "AUD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function day(date: Date | null | undefined): string | null {
  return date ? formatSydneyDate(date) : null;
}

/** Collapse whitespace and cut to a sentence-sized excerpt. */
export function excerpt(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function line(label: string, value: string | null | undefined): string | null {
  return value && value.trim() ? `${label}: ${value.trim()}` : null;
}

function compact(lines: readonly (string | null)[]): string {
  return lines.filter((entry): entry is string => entry !== null).join("\n");
}

function offerReference(offer: NonNullable<LeadContextSource["activeOffer"]>) {
  return `${offer.reference}-R${offer.revisionNumber}`;
}

export function leadChunk(lead: LeadContextSource): ChunkDraft {
  const offer = lead.activeOffer;
  const title = lead.location ? `${lead.name} — ${lead.location}` : lead.name;
  const nextStep = [
    lead.meetingDate
      ? `meeting ${day(lead.meetingDate)}${lead.meetingTime ? ` ${lead.meetingTime}` : ""}${lead.meetingMode ? ` (${lead.meetingMode})` : ""}`
      : null,
    lead.followupDate
      ? `follow-up ${day(lead.followupDate)}${lead.followupTime ? ` ${lead.followupTime}` : ""}`
      : null,
  ].filter(Boolean);

  const content = compact([
    `Lead: ${title}`,
    `Stage: ${humanizeEnum(lead.stage)}${lead.urgent ? " (urgent)" : ""}`,
    line("Second client", lead.secondaryName),
    line("Wants", lead.type.length ? lead.type.join(", ") : null),
    line("Source", lead.source),
    line("Budget", lead.budget),
    line(
      "Estimated value",
      lead.estimatedValue !== null ? formatAud(lead.estimatedValue) : null,
    ),
    line("Expected close", day(lead.expectedCloseDate)),
    line("Estimated start", day(lead.estimatedStartDate)),
    line("Assigned to", lead.assignedName),
    line("Next", nextStep.length ? nextStep.join("; ") : null),
    line("Lost reason", lead.lostReason),
    offer
      ? `Offer: ${offerReference(offer)} is ${humanizeEnum(offer.status)}, ${formatAud(offer.contractValueIncGst ?? offer.totalAmount)} inc GST${offer.sentAt ? `, sent ${day(offer.sentAt)}` : ""}, last changed ${day(offer.updatedAt)}`
      : "Offer: none started",
    lead.project
      ? `Project: ${lead.project.name} (${humanizeEnum(lead.project.status)})`
      : null,
    lead.openTasks.length
      ? `Open tasks: ${lead.openTasks
          .map(
            (task) =>
              `${humanizeEnum(task.type)}${task.dueDate ? ` due ${day(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}` : ""}${task.notes ? ` — ${excerpt(task.notes, MAX_TASK_NOTE)}` : ""}`,
          )
          .join("; ")}`
      : null,
    lead.recentHistory.length
      ? `Recent activity:\n${lead.recentHistory
          .map(
            (entry) =>
              `- ${day(entry.actionDate)} ${humanizeEnum(entry.type)}: ${excerpt(entry.action, 80)}${entry.detail ? ` — ${excerpt(entry.detail, MAX_HISTORY_DETAIL)}` : ""}`,
          )
          .join("\n")}`
      : null,
    `Last updated: ${day(lead.updatedAt)}`,
    `Refs (tools only, never show people): leadId=${lead.id}${offer ? ` offerId=${offer.id}` : ""}${lead.project ? ` projectId=${lead.project.id}` : ""}`,
  ]);

  return { content, entityId: String(lead.id), kind: "lead", title };
}

export function projectChunk(project: ProjectContextSource): ChunkDraft {
  const topLevel = project.milestones.filter((m) => m.isTopLevel);
  const current = project.milestones.filter((m) => m.status === "ACTIVE");
  const next = project.milestones.find((m) => m.status === "PENDING");
  const done = topLevel.filter(
    (m) => m.status === "DONE" || m.status === "NOT_REQUIRED",
  ).length;
  const invoiced = project.invoices.reduce((sum, inv) => sum + inv.total, 0);
  const due = project.invoices.reduce((sum, inv) => sum + inv.amountDue, 0);
  const openChecklists = project.checklists.filter((c) => c.status === "OPEN");

  const content = compact([
    `Project: ${project.name} — ${project.location}`,
    `Status: ${humanizeEnum(project.status)}`,
    line("Client", project.customerNames.join(" & ")),
    `Build: ${project.buildingType}, ${project.council}`,
    line("Site manager", project.siteManagerName),
    `Contract budget ${formatAud(project.totalBudget)}, spent ${formatAud(project.spent)}`,
    `Dates: start ${day(project.startDate)}, estimated finish ${day(project.estimatedEndDate)}`,
    topLevel.length
      ? `Milestones: ${done} of ${topLevel.length} stages complete`
      : "Milestones: none planned yet",
    current.length
      ? `Underway: ${current
          .map(
            (m) =>
              `${m.name} (${humanizeEnum(m.projectStage)}, due ${day(m.targetDate)})`,
          )
          .join("; ")}`
      : null,
    next
      ? `Next up: ${next.name} (${humanizeEnum(next.projectStage)}${next.startDate ? `, starts ${day(next.startDate)}` : ""}, due ${day(next.targetDate)})`
      : null,
    project.compliance
      ? `Compliance: ${humanizeEnum(project.compliance.status)}${project.compliance.certifierName ? ` with ${project.compliance.certifierName}` : ""}${project.compliance.openAlerts.length ? `; open alerts: ${project.compliance.openAlerts.map(humanizeEnum).join(", ")}` : ""}`
      : "Compliance: not started",
    project.invoices.length
      ? `Progress claims: ${project.invoices.length} raised, ${formatAud(invoiced)} total, ${formatAud(due)} still owed (${project.invoices.map((inv) => `${humanizeEnum(inv.projectStage)} ${humanizeEnum(inv.status)}`).join(", ")})`
      : "Progress claims: none raised",
    openChecklists.length
      ? `Open handover checklists: ${openChecklists.map((c) => c.title).join(", ")}`
      : null,
    project.upcomingBookings.length
      ? `Tradie bookings: ${project.upcomingBookings
          .map(
            (b) =>
              `${b.tradieName}${b.trade ? ` (${b.trade})` : ""} ${day(b.scheduledDate)} for ${b.durationDays} day${b.durationDays === 1 ? "" : "s"}, ${humanizeEnum(b.status)}`,
          )
          .join("; ")}`
      : null,
    project.openVariations
      ? `Open variations: ${project.openVariations}`
      : null,
    `Refs (tools only, never show people): projectId=${project.id} leadId=${project.leadId}`,
  ]);

  return {
    content,
    entityId: project.id,
    kind: "project",
    title: `${project.name} — ${project.location}`,
  };
}

export function tradieChunk(tradie: TradieContextSource): ChunkDraft {
  const trades = [...new Set([tradie.trade, ...tradie.trades])].filter(Boolean);
  const content = compact([
    `Tradie: ${tradie.name}${tradie.isFavourite ? " (favourite)" : ""}`,
    `Trades: ${trades.join(", ")}`,
    line("Based in", tradie.location),
    line("Rating", tradie.rating !== null ? `${tradie.rating} / 5` : null),
    line(
      "Last quoted",
      tradie.lastQuotedPrice !== null
        ? `${formatAud(tradie.lastQuotedPrice)} ${tradie.lastQuotedPriceUnit === "HOURLY" ? "per hour" : "fixed"}`
        : null,
    ),
    tradie.openIncidents ? `Open incidents: ${tradie.openIncidents}` : null,
    tradie.upcomingBookings.length
      ? `Booked: ${tradie.upcomingBookings
          .map(
            (b) =>
              `${b.projectName} ${day(b.scheduledDate)} (${humanizeEnum(b.status)})`,
          )
          .join("; ")}`
      : "Booked: nothing upcoming",
    `Refs (tools only, never show people): tradieId=${tradie.id}`,
  ]);
  return { content, entityId: tradie.id, kind: "tradie", title: tradie.name };
}

function counts(record: Readonly<Record<string, number>>): string {
  const entries = Object.entries(record)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length
    ? entries.map(([key, count]) => `${humanizeEnum(key)} ${count}`).join(", ")
    : "none";
}

export const OFFICE_DIGEST_ENTITY_ID = "office";

export function officeDigestChunk(digest: OfficeDigestSource): ChunkDraft {
  const content = compact([
    `Office snapshot for ${day(digest.generatedAt)}`,
    `Leads by stage: ${counts(digest.leadsByStage)}`,
    `Active offers by status: ${counts(digest.offersByStatus)}`,
    `Projects by status: ${counts(digest.projectsByStatus)}`,
    digest.awaitingSignature.length
      ? `Waiting on the client: ${digest.awaitingSignature
          .map(
            (o) =>
              `${o.leadName} (${o.reference}, ${humanizeEnum(o.status)}${o.sentAt ? ` since ${day(o.sentAt)}` : ""})`,
          )
          .join("; ")}`
      : "Waiting on the client: nothing out for signature",
    digest.overdueTasks.length
      ? `Overdue lead tasks: ${digest.overdueTasks
          .map(
            (t) =>
              `${humanizeEnum(t.type)} for ${t.leadName} (due ${day(t.dueDate)})`,
          )
          .join("; ")}`
      : "Overdue lead tasks: none",
    digest.upcomingMeetings.length
      ? `Meetings in the next 7 days: ${digest.upcomingMeetings
          .map(
            (m) => `${m.leadName} ${day(m.date)}${m.time ? ` ${m.time}` : ""}`,
          )
          .join("; ")}`
      : "Meetings in the next 7 days: none booked",
    digest.activeProjects.length
      ? `Jobs in progress:\n${digest.activeProjects
          .map(
            (p) =>
              `- ${p.name} (${humanizeEnum(p.status)})${p.currentActivity ? `: on ${p.currentActivity}` : ""}${p.nextActivity ? `, next ${p.nextActivity}` : ""}`,
          )
          .join("\n")}`
      : "Jobs in progress: none",
    `Open compliance alerts: ${digest.openComplianceAlerts}`,
    `Progress claims outstanding: ${digest.outstandingInvoices.count} (${formatAud(digest.outstandingInvoices.amountDue)} owed)`,
  ]);
  return {
    content,
    entityId: OFFICE_DIGEST_ENTITY_ID,
    kind: "digest",
    title: "Office snapshot",
  };
}
