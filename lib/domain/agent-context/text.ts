import { formatSydneyDate } from "@/lib/dates/sydney";
import {
  addressKeywords,
  nameKeywords,
  referenceKeywords,
  suburbOf,
  tag,
  uniqueSorted,
} from "./keywords";

// The words the operations agent reads about a record before it asks for it.
//
// Pure and deterministic on purpose: the same record always produces the same
// text, so `contentHash` only changes when the business did, and a test can pin
// the wording. No model writes or summarises any of it — what the agent knows
// about a client is exactly what the CRM says, laid out the way the office
// talks about it (names, addresses, stages, money, dates), never paraphrased.
//
// A lead, an offer and a project are each written as sections (#621), one
// chunk and one vector each, with the record's header line repeated at the
// top of every section: a project with eighty milestones, compliance, claims
// and bookings was one long text with one vector, and "when is the slab pour
// at X" ranked poorly against it. Money is a section of its own, so a caller
// who may not see money is never handed it.
//
// Dates are written as dates. Whether something is overdue or due soon is
// worked out when the index is read (`dueAt`), never written into a nightly
// snapshot that is wrong by the afternoon.
//
// Every chunk ends with a "Refs" line. Those ids are for tool calls only; the
// agent's instructions forbid repeating them to people.

export type AgentContextKind =
  | "lead"
  | "offer"
  | "project"
  | "tradie"
  | "digest";

/**
 * `record` is a chunk that is not split: a tradie and the office digest.
 * `money` is withheld from anyone who may not see a price
 * (`canSeeProjectFinancials`).
 */
export type ContextSection =
  | "record"
  | "overview"
  | "people"
  | "money"
  | "dates"
  | "compliance"
  | "comms"
  | "tasks";

export const MONEY_SECTION: ContextSection = "money";

export type ChunkDraft = {
  readonly kind: AgentContextKind;
  /** A lead's and its active offer's chunks share the lead id. */
  readonly entityId: string;
  readonly section: ContextSection;
  readonly title: string;
  readonly content: string;
  /** Normal forms people say this record by (./keywords.ts). */
  readonly keywords: readonly string[];
  /** `kind:project`, `status:delayed`, `suburb:oran park` … */
  readonly tags: readonly string[];
  /** The earliest open date this section is about, for "overdue" at read time. */
  readonly dueAt: Date | null;
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

export type OfferContextSource = {
  id: string;
  leadId: number;
  leadName: string;
  secondaryName: string | null;
  location: string;
  /** The base reference, without the revision. */
  reference: string;
  revisionNumber: number;
  status: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
  updatedAt: Date;
  /** `YYYY-MM-DD`, as the workspace stores it, or null. */
  validUntil: string | null;
  valueIncGst: number | null;
  totalAmount: number;
  followUps: { count: number; lastSentAt: Date | null };
  projectId: string | null;
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
  /**
   * Every overdue task, not just the ones listed: the list is the oldest few,
   * and "anything overdue?" is answered with this number. Optional so an
   * older caller that only has the list still gets a count.
   */
  overdueTaskCount?: number;
  /** Documents the document index has failed to read, by name and record. */
  unreadDocuments?: readonly {
    filename: string;
    record: string | null;
    gaveUp: boolean;
  }[];
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
/** Open milestones listed with their dates; a long job lists its next ones. */
const MAX_DATED_MILESTONES = 40;

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

/** A `YYYY-MM-DD` workspace date as the office reads it. */
function calendarDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return formatSydneyDate(new Date(`${value}T02:00:00Z`));
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

function earliest(dates: readonly (Date | null | undefined)[]): Date | null {
  let first: Date | null = null;
  for (const date of dates) {
    if (date && (!first || date < first)) first = date;
  }
  return first;
}

type SectionBody = {
  readonly section: ContextSection;
  readonly heading: string;
  readonly lines: readonly (string | null)[];
  readonly dueAt?: Date | null;
};

/**
 * One record as section chunks: each repeats the header, so a section found
 * on its own still says which record it is, and ends with the record's Refs.
 * A section with nothing to say is left out.
 */
function sectioned(
  record: {
    kind: AgentContextKind;
    entityId: string;
    title: string;
    header: string;
    refs: string;
    keywords: readonly string[];
    tags: readonly (string | null)[];
  },
  bodies: readonly SectionBody[],
): ChunkDraft[] {
  const keywords = uniqueSorted([...record.keywords]);
  const tags = uniqueSorted([...record.tags]);
  return bodies.flatMap((body) => {
    const lines = body.lines.filter((entry): entry is string => entry !== null);
    if (!lines.length) return [];
    return [
      {
        content: compact([
          record.header,
          `Section: ${body.heading}`,
          ...lines,
          `Refs (tools only, never show people): ${record.refs}`,
        ]),
        dueAt: body.dueAt ?? null,
        entityId: record.entityId,
        keywords,
        kind: record.kind,
        section: body.section,
        tags,
        title: record.title,
      },
    ];
  });
}

function offerReference(reference: string, revisionNumber: number) {
  return `${reference}-R${revisionNumber}`;
}

export function leadSections(lead: LeadContextSource): ChunkDraft[] {
  const offer = lead.activeOffer;
  const title = lead.location ? `${lead.name} — ${lead.location}` : lead.name;
  const legacyNext = [
    lead.meetingDate
      ? `meeting ${day(lead.meetingDate)}${lead.meetingTime ? ` ${lead.meetingTime}` : ""}${lead.meetingMode ? ` (${lead.meetingMode})` : ""}`
      : null,
    lead.followupDate
      ? `follow-up ${day(lead.followupDate)}${lead.followupTime ? ` ${lead.followupTime}` : ""}`
      : null,
  ].filter(Boolean);

  return sectioned(
    {
      entityId: String(lead.id),
      header: `Lead: ${title} (${humanizeEnum(lead.stage)}${lead.urgent ? ", urgent" : ""})`,
      keywords: [
        ...nameKeywords(lead.name),
        ...nameKeywords(lead.secondaryName),
        ...addressKeywords(lead.location),
        ...(offer
          ? referenceKeywords(offer.reference, offer.revisionNumber)
          : []),
        lead.stage.toLowerCase().replaceAll("_", " "),
      ],
      kind: "lead",
      refs: `leadId=${lead.id}${offer ? ` offerId=${offer.id}` : ""}${lead.project ? ` projectId=${lead.project.id}` : ""}`,
      tags: [
        "kind:lead",
        tag("stage", lead.stage),
        tag("suburb", suburbOf(lead.location)),
        lead.urgent ? "urgent" : null,
        offer ? tag("offer", offer.status) : "offer:none",
        lead.project ? "has-project" : null,
        lead.openTasks.length ? "has-open-tasks" : null,
      ],
      title,
    },
    [
      {
        heading: "Overview",
        lines: [
          line("Wants", lead.type.length ? lead.type.join(", ") : null),
          line("Source", lead.source),
          line("Expected close", day(lead.expectedCloseDate)),
          line("Estimated start", day(lead.estimatedStartDate)),
          line("Lost reason", lead.lostReason),
          offer
            ? `Offer: ${offerReference(offer.reference, offer.revisionNumber)} is ${humanizeEnum(offer.status)}${offer.sentAt ? `, sent ${day(offer.sentAt)}` : ""}, last changed ${day(offer.updatedAt)}`
            : "Offer: none started",
          lead.project
            ? `Project: ${lead.project.name} (${humanizeEnum(lead.project.status)})`
            : null,
          `Last updated: ${day(lead.updatedAt)}`,
        ],
        section: "overview",
      },
      {
        heading: "People and contact",
        lines: [
          `Client: ${lead.name}`,
          line("Second client", lead.secondaryName),
          line("Site", lead.location),
          line("Assigned to", lead.assignedName),
        ],
        section: "people",
      },
      {
        heading: "Offer and money",
        lines: [
          line("Budget", lead.budget),
          line(
            "Estimated value",
            lead.estimatedValue !== null
              ? formatAud(lead.estimatedValue)
              : null,
          ),
          offer
            ? `Offer value: ${formatAud(offer.contractValueIncGst ?? offer.totalAmount)} inc GST (${offerReference(offer.reference, offer.revisionNumber)})`
            : null,
        ],
        section: "money",
      },
      {
        dueAt: earliest([
          ...lead.openTasks.map((task) => task.dueDate),
          lead.meetingDate,
          lead.followupDate,
        ]),
        heading: "Open tasks",
        lines: [
          ...lead.openTasks.map(
            (task) =>
              `- ${humanizeEnum(task.type)}${task.dueDate ? ` due ${day(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}` : ", no date"}${task.notes ? ` — ${excerpt(task.notes, MAX_TASK_NOTE)}` : ""}`,
          ),
          line("Next", legacyNext.length ? legacyNext.join("; ") : null),
        ],
        section: "tasks",
      },
      {
        heading: "Recent comms",
        lines: lead.recentHistory.map(
          (entry) =>
            `- ${day(entry.actionDate)} ${humanizeEnum(entry.type)}: ${excerpt(entry.action, 80)}${entry.detail ? ` — ${excerpt(entry.detail, MAX_HISTORY_DETAIL)}` : ""}`,
        ),
        section: "comms",
      },
    ],
  );
}

/** Where an offer stands with DocuSign, in words, from its status. */
function signingState(status: string): string | null {
  switch (status) {
    case "OFFER_SENT":
      return "out for the client's signature (offer)";
    case "TENDER_SENT":
      return "out for the client's signature (tender)";
    case "CONTRACT_SENT":
      return "out for the client's signature (contract)";
    case "TENDER_SIGNED":
      return "tender signed";
    case "CONTRACT_SIGNED":
      return "contract signed";
    case "DECLINED":
      return "the client declined to sign";
    default:
      return null;
  }
}

/**
 * The lead's active offer as its own record (#621): it used to be one line
 * inside the lead, so a question about an offer reference found the lead at
 * best. Keyed by the lead's id, so a new revision replaces it in place.
 */
export function offerSections(offer: OfferContextSource): ChunkDraft[] {
  const reference = offerReference(offer.reference, offer.revisionNumber);
  const title = `${reference} — ${offer.leadName}${offer.location ? `, ${offer.location}` : ""}`;
  const validUntil = calendarDay(offer.validUntil);
  return sectioned(
    {
      entityId: String(offer.leadId),
      header: `Offer: ${reference} for ${offer.leadName}${offer.location ? ` — ${offer.location}` : ""} (${humanizeEnum(offer.status)})`,
      keywords: [
        ...referenceKeywords(offer.reference, offer.revisionNumber),
        ...nameKeywords(offer.leadName),
        ...nameKeywords(offer.secondaryName),
        ...addressKeywords(offer.location),
        `r${offer.revisionNumber}`,
        `revision ${offer.revisionNumber}`,
      ],
      kind: "offer",
      refs: `offerId=${offer.id} leadId=${offer.leadId}${offer.projectId ? ` projectId=${offer.projectId}` : ""}`,
      tags: [
        "kind:offer",
        tag("status", offer.status),
        tag("revision", String(offer.revisionNumber)),
        tag("suburb", suburbOf(offer.location)),
        signingState(offer.status) ? "signing" : null,
      ],
      title,
    },
    [
      {
        dueAt: offer.validUntil
          ? new Date(`${offer.validUntil}T13:59:59Z`)
          : null,
        heading: "Overview",
        lines: [
          `Reference: ${reference} (revision ${offer.revisionNumber})`,
          `Status: ${humanizeEnum(offer.status)}`,
          line("Signing", signingState(offer.status)),
          line("Sent", day(offer.sentAt)),
          line("Valid until", validUntil),
          line("Accepted", day(offer.acceptedAt)),
          offer.followUps.count
            ? `Follow-ups sent: ${offer.followUps.count}, last ${day(offer.followUps.lastSentAt)}`
            : offer.sentAt
              ? "Follow-ups sent: none"
              : null,
          `Last changed: ${day(offer.updatedAt)}`,
        ],
        section: "overview",
      },
      {
        heading: "Offer and money",
        lines: [
          `Value: ${formatAud(offer.valueIncGst ?? offer.totalAmount)} inc GST`,
        ],
        section: "money",
      },
    ],
  );
}

export function projectSections(project: ProjectContextSource): ChunkDraft[] {
  const topLevel = project.milestones.filter((m) => m.isTopLevel);
  const current = project.milestones.filter((m) => m.status === "ACTIVE");
  const next = project.milestones.find((m) => m.status === "PENDING");
  const done = topLevel.filter(
    (m) => m.status === "DONE" || m.status === "NOT_REQUIRED",
  ).length;
  const open = project.milestones
    .filter((m) => m.status === "ACTIVE" || m.status === "PENDING")
    .slice()
    .sort((a, b) => a.targetDate.getTime() - b.targetDate.getTime());
  const invoiced = project.invoices.reduce((sum, inv) => sum + inv.total, 0);
  const due = project.invoices.reduce((sum, inv) => sum + inv.amountDue, 0);
  const openChecklists = project.checklists.filter((c) => c.status === "OPEN");
  const title = `${project.name} — ${project.location}`;

  return sectioned(
    {
      entityId: project.id,
      header: `Project: ${title} (${humanizeEnum(project.status)})`,
      keywords: [
        ...nameKeywords(project.name),
        ...addressKeywords(project.location),
        ...addressKeywords(project.name),
        ...project.customerNames.flatMap((name) => nameKeywords(name)),
        ...nameKeywords(project.siteManagerName),
        ...current.map((m) => m.name.toLowerCase()),
      ],
      kind: "project",
      refs: `projectId=${project.id} leadId=${project.leadId}`,
      tags: [
        "kind:project",
        tag("status", project.status),
        tag("suburb", suburbOf(project.location)),
        tag("council", project.council),
        ...current.map((m) => tag("stage", m.projectStage)),
        project.openVariations ? "has-open-variations" : null,
        project.compliance?.openAlerts.length ? "has-compliance-alerts" : null,
      ],
      title,
    },
    [
      {
        heading: "Overview",
        lines: [
          `Build: ${project.buildingType}, ${project.council}`,
          `Dates: start ${day(project.startDate)}, estimated finish ${day(project.estimatedEndDate)}`,
          // Every activity is counted, not just the stages (#432).
          topLevel.length
            ? `Milestones: ${done} of ${topLevel.length} stages complete; ${project.milestones.length} activities in all, ${project.milestones.filter((m) => m.status === "DONE" || m.status === "NOT_REQUIRED").length} done`
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
          project.openVariations
            ? `Open variations: ${project.openVariations}`
            : null,
        ],
        section: "overview",
      },
      {
        heading: "People and contact",
        lines: [
          line("Client", project.customerNames.join(" & ")),
          line("Site", project.location),
          line("Site manager", project.siteManagerName),
          line("Certifier", project.compliance?.certifierName),
        ],
        section: "people",
      },
      {
        heading: "Offer and money",
        lines: [
          `Contract budget ${formatAud(project.totalBudget)}, spent ${formatAud(project.spent)}`,
          project.invoices.length
            ? `Progress claims: ${project.invoices.length} raised, ${formatAud(invoiced)} total, ${formatAud(due)} still owed (${project.invoices.map((inv) => `${humanizeEnum(inv.projectStage)} ${humanizeEnum(inv.status)}`).join(", ")})`
            : "Progress claims: none raised",
        ],
        section: "money",
      },
      {
        dueAt: earliest(open.map((m) => m.targetDate)),
        heading: "Milestones and dates",
        lines: [
          ...open
            .slice(0, MAX_DATED_MILESTONES)
            .map(
              (m) =>
                `- ${m.name} (${humanizeEnum(m.projectStage)}, ${humanizeEnum(m.status)})${m.startDate ? `: starts ${day(m.startDate)}` : ""}, due ${day(m.targetDate)}`,
            ),
          open.length > MAX_DATED_MILESTONES
            ? `and ${open.length - MAX_DATED_MILESTONES} more open activities`
            : null,
          ...project.upcomingBookings.map(
            (b) =>
              `- Booking: ${b.tradieName}${b.trade ? ` (${b.trade})` : ""} ${day(b.scheduledDate)} for ${b.durationDays} day${b.durationDays === 1 ? "" : "s"}, ${humanizeEnum(b.status)}`,
          ),
        ],
        section: "dates",
      },
      {
        heading: "Compliance",
        lines: [
          project.compliance
            ? `Compliance: ${humanizeEnum(project.compliance.status)}${project.compliance.certifierName ? ` with ${project.compliance.certifierName}` : ""}${project.compliance.openAlerts.length ? `; open alerts: ${project.compliance.openAlerts.map(humanizeEnum).join(", ")}` : ""}`
            : "Compliance: not started",
          openChecklists.length
            ? `Open handover checklists: ${openChecklists.map((c) => c.title).join(", ")}`
            : null,
        ],
        section: "compliance",
      },
    ],
  );
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
  return {
    content,
    dueAt: earliest(tradie.upcomingBookings.map((b) => b.scheduledDate)),
    entityId: tradie.id,
    keywords: uniqueSorted([
      ...nameKeywords(tradie.name),
      ...trades.map((trade) => trade.toLowerCase().replaceAll("_", " ")),
      ...addressKeywords(tradie.location),
    ]),
    kind: "tradie",
    section: "record",
    tags: uniqueSorted([
      "kind:tradie",
      ...trades.map((trade) => tag("trade", trade)),
      tradie.isFavourite ? "favourite" : null,
    ]),
    title: tradie.name,
  };
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

/**
 * "Overdue lead tasks: 11 (live leads only), oldest first: …". The count is
 * every overdue task by the same rule as the lead specialist's live list, so
 * the two give one number (#432); the list is only the oldest few.
 */
function overdueLine(digest: OfficeDigestSource): string {
  const total = Math.max(
    digest.overdueTaskCount ?? digest.overdueTasks.length,
    digest.overdueTasks.length,
  );
  if (total === 0) return "Overdue lead tasks: none";
  const listed = digest.overdueTasks
    .map(
      (t) =>
        `${humanizeEnum(t.type)} for ${t.leadName} (due ${day(t.dueDate)})`,
    )
    .join("; ");
  const more = total - digest.overdueTasks.length;
  return `Overdue lead tasks: ${total} on live leads, oldest first: ${listed}${more > 0 ? `; and ${more} more` : ""}`;
}

/**
 * Documents the nightly read could not read. They used to be reported only to
 * the server log, which nobody here watches (#432), so a missing certificate
 * looked like one the office had never uploaded.
 */
function unreadDocumentsLine(
  documents: NonNullable<OfficeDigestSource["unreadDocuments"]>,
): string | null {
  if (!documents.length) return null;
  const shown = documents
    .slice(0, 10)
    .map(
      (doc) =>
        `${doc.filename}${doc.record ? ` (${doc.record})` : ""}${doc.gaveUp ? ", stopped retrying" : ", will retry tonight"}`,
    );
  const more = documents.length - shown.length;
  return `Documents the index could not read (${documents.length}; re-upload or check the file): ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

export function officeDigestChunk(digest: OfficeDigestSource): ChunkDraft {
  const content = compact([
    `Office snapshot for ${day(digest.generatedAt)}`,
    `Leads by stage: ${counts(digest.leadsByStage)}`,
    `Active offers by status: ${counts(digest.offersByStatus)}`,
    `Projects by status: ${counts(digest.projectsByStatus)}`,
    digest.awaitingSignature.length
      ? `Out for the client's signature: ${digest.awaitingSignature
          .map(
            (o) =>
              `${o.leadName} (${o.reference}, ${humanizeEnum(o.status)}${o.sentAt ? ` since ${day(o.sentAt)}` : ""})`,
          )
          .join("; ")}`
      : "Out for the client's signature: nothing",
    overdueLine(digest),
    digest.upcomingMeetings.length
      ? `Meetings from today to a week out: ${digest.upcomingMeetings
          .map(
            (m) => `${m.leadName} ${day(m.date)}${m.time ? ` ${m.time}` : ""}`,
          )
          .join("; ")}`
      : "Meetings from today to a week out: none booked",
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
    unreadDocumentsLine(digest.unreadDocuments ?? []),
  ]);
  return {
    content,
    dueAt: null,
    entityId: OFFICE_DIGEST_ENTITY_ID,
    keywords: [],
    kind: "digest",
    section: "record",
    tags: ["kind:digest"],
    title: "Office snapshot",
  };
}
