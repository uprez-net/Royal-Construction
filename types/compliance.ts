import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceMeetingStatus,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  type Prisma,
} from "@prisma/client";

/**
 * What a compliance read pulls in.
 *
 * Declared here rather than beside the queries because both the data layer and
 * the project detail payload use it, and `lib/data/compliance.ts` is a
 * `"use server"` module — importing a type out of one into a file a client
 * component reads would drag the whole action module along with it.
 */
export const certifierEngagementInclude = {
  documents: {
    include: { files: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  },
  /**
   * The certifier's own thread, and only it.
   *
   * The surveyor, architect and council threads share this table — same shape,
   * same components render them — and are told apart by `outreachId`. Without
   * the filter every message on the file landed in the certifier transcript,
   * which is both wrong and, on a job with three live threads, unreadable.
   */
  emails: { where: { outreachId: null }, orderBy: { sentAt: "asc" } },
  outreaches: {
    include: {
      emails: { orderBy: { sentAt: "asc" } },
      /**
       * The architect's client meetings, newest first.
       *
       * Every one of them, including the reschedules. The tab only ever renders
       * the latest, but "what is this meeting up to" is answered by the row
       * before it as often as by the row itself — a meeting that has moved twice
       * is a different conversation with the architect from one booked for next
       * Tuesday, and the sweep reads the held one to start the plans clock.
       */
      meetings: { orderBy: { scheduledFor: "desc" } },
      /**
       * Rounds of client feedback on the plans, newest first.
       *
       * Loaded whole rather than filtered to the outstanding one. The card
       * shows how many rounds this set has been through, which is the honest
       * answer to "why are we still waiting", and the outstanding round is
       * found off the same array.
       */
      revisions: { orderBy: { requestedAt: "desc" } },
    },
    orderBy: { createdAt: "asc" },
  },
  /**
   * The 10.7 certificate as a thing being obtained.
   *
   * Null until somebody answers "do you already have it?". Included on the main
   * read rather than fetched by the council block on its own: it decides which
   * of four states that block renders, and a card that has to fetch before it
   * can decide what it is flickers through all four.
   */
  planningCertificate: true,
  /**
   * Open first, then newest.
   *
   * Resolved alerts stay on the read rather than being filtered out here: the
   * tab shows what was raised and settled as well as what is outstanding, and
   * a second query to find that out would be a second query on every render of
   * the project page.
   */
  alerts: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
} satisfies Prisma.CertifierEngagementInclude;

/** The engagement plus everything the Compliance tab renders, in one read. */
export type CertifierEngagementDetail = Prisma.CertifierEngagementGetPayload<{
  include: typeof certifierEngagementInclude;
}>;

export type ComplianceDocumentWithFiles =
  CertifierEngagementDetail["documents"][number];

export type CertifierEmailRecord = CertifierEngagementDetail["emails"][number];

/** One party's engagement plus its own mail trail, meetings and revisions. */
export type ComplianceOutreachDetail =
  CertifierEngagementDetail["outreaches"][number];

export type ComplianceMeetingRecord =
  ComplianceOutreachDetail["meetings"][number];

export type CompliancePlanRevisionRecord =
  ComplianceOutreachDetail["revisions"][number];

/** The 10.7 certificate application, or null before the question is answered. */
export type PlanningCertificateRecord =
  CertifierEngagementDetail["planningCertificate"];

export type ComplianceAlertRecord =
  CertifierEngagementDetail["alerts"][number];

/**
 * The outreach for one party, or undefined.
 *
 * There is at most one per party per file — the unique index says so — but
 * every caller was writing the same `.find` and the same enum comparison, and
 * a caller that forgets the file may have none at all is the caller that
 * crashes the tab.
 */
export function outreachForParty(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  party: CompliancePartyType,
): ComplianceOutreachDetail | undefined {
  return engagement?.outreaches.find((outreach) => outreach.party === party);
}

/**
 * Whether a party has been dealt with, one way or the other.
 *
 * Deliberately not "did the mail go out". A file where the client arrived with
 * their own survey has no mail and is nonetheless finished with the surveyor,
 * which is the whole point of SELF_SUPPLIED.
 *
 * Equally deliberately not "is there a row". An OUTREACH row still sitting at
 * NOT_SENT is what a send that threw after writing its row leaves behind, and
 * counting that as engaged unlocked the section, hid the button that would have
 * retried it, and told the architect the surveyor was under way — over a
 * surveyor who had never been written to at all.
 */
export function isPartyEngaged(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  party: CompliancePartyType,
): boolean {
  const outreach = outreachForParty(engagement, party);
  if (!outreach) return false;
  return (
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
    outreach.status !== ComplianceOutreachStatus.NOT_SENT
  );
}

/** Alerts still waiting on somebody. */
export function openAlerts(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
): ComplianceAlertRecord[] {
  return (engagement?.alerts ?? []).filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );
}

/**
 * Whether an alert of this type is open on the file.
 *
 * The shape most callers want, because an alert's effect on the flow lasts
 * exactly as long as it is open: a DA_APPROVAL_REQUIRED that has been resolved
 * is history, and history must not still be suppressing the 10.7 certificate.
 */
export function hasOpenAlert(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
  type: ComplianceAlertType,
): boolean {
  return openAlerts(engagement).some((alert) => alert.type === type);
}

/**
 * Whether the planning certificate is still part of this file.
 *
 * An open DA_APPROVAL_REQUIRED takes it out: a development application is
 * assessed by the council itself, so ordering a 10.7 certificate to hand to a
 * certifier is no longer the path this job is on. It comes back if the alert
 * is resolved as not applying after all.
 *
 * One predicate rather than the condition repeated, because it is read by the
 * section that renders the row, the progress count beside it, and the outreach
 * that refuses to send an incomplete pack — and any two of those disagreeing
 * strands the engagement.
 */
export function requiresPlanningCertificate(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
): boolean {
  return !hasOpenAlert(engagement, ComplianceAlertType.DA_APPROVAL_REQUIRED);
}

/**
 * Which step the planning certificate block is on.
 *
 * A derived value rather than a stored column, because every one of these is
 * already implied by the fields underneath it and a second, stored account of
 * the same thing is a second thing to get out of step. The order is the order
 * the block walks through, and each step is the previous one plus one fact.
 *
 * - `unanswered` — nobody has said whether the builder already holds one.
 * - `held` — they do; the row is just waiting for the file.
 * - `to-order` — they do not, and nothing has been lodged. This is the portal
 *   link.
 * - `lodged` — an application is with the portal. This is where the three-to-
 *   five-day clock runs.
 * - `received` — it has come back, whether or not the file is on the row yet.
 */
export type PlanningCertificateStep =
  | "unanswered"
  | "held"
  | "to-order"
  | "lodged"
  | "received";

export function planningCertificateStep(
  application: PlanningCertificateRecord,
): PlanningCertificateStep {
  if (!application || application.alreadyHeld === null) return "unanswered";
  if (application.receivedAt) return "received";
  if (application.alreadyHeld) return "held";
  return application.appliedAt ? "lodged" : "to-order";
}

/**
 * The meeting the architect card is currently about, or null.
 *
 * The newest one that has not been superseded, which is either a booking still
 * to happen or the one that took place. A RESCHEDULED row is deliberately never
 * it: rescheduling writes the replacement, so the moved row is history the
 * moment its successor exists.
 */
export function currentMeeting(
  outreach: Pick<ComplianceOutreachDetail, "meetings"> | null | undefined,
): ComplianceMeetingRecord | null {
  return (
    outreach?.meetings.find(
      (meeting) =>
        meeting.status === ComplianceMeetingStatus.SCHEDULED ||
        meeting.status === ComplianceMeetingStatus.HELD,
    ) ?? null
  );
}

/**
 * When the client and the architect actually sat down, or null.
 *
 * The start of the preliminary-plans clock. Read off the meetings rather than
 * off the outreach, and off `heldAt` rather than off the booking, because a
 * meeting booked for a date and then held on another is common and the clock
 * has to run from the second.
 */
export function meetingHeldAt(
  outreach: Pick<ComplianceOutreachDetail, "meetings"> | null | undefined,
): Date | null {
  const held = (outreach?.meetings ?? []).filter(
    (meeting) => meeting.status === ComplianceMeetingStatus.HELD,
  );
  if (held.length === 0) return null;

  // The earliest one. A second meeting after the plans have been through a
  // round of revisions must not restart a clock that the first meeting began.
  return held.reduce<Date>(
    (earliest, meeting) => {
      const at = meeting.heldAt ?? meeting.scheduledFor;
      return at < earliest ? at : earliest;
    },
    held[0].heldAt ?? held[0].scheduledFor,
  );
}

/**
 * The round of client revisions still waiting on the architect, or null.
 *
 * Null is the common case and means one of two very different things — no
 * revisions were ever asked for, or the last round was answered — which is why
 * callers testing this always test something else alongside it.
 */
export function outstandingRevision(
  outreach: Pick<ComplianceOutreachDetail, "revisions"> | null | undefined,
): CompliancePlanRevisionRecord | null {
  return (
    (outreach?.revisions ?? []).find((revision) => !revision.respondedAt) ?? null
  );
}

/**
 * One attachment as stored on `CertifierEmail.attachments`.
 *
 * A name and a url, nothing else. The bytes live in blob storage; the row only
 * has to be enough to render a download link inside a thread bubble.
 */
export interface CertifierEmailAttachment {
  name: string;
  url: string;
}

/**
 * Reads the attachments off an email row.
 *
 * The column is `Json`, so it is whatever was written there — including, for
 * rows predating a shape change, something that is not an array at all. Parsed
 * defensively so one malformed row renders an empty bubble rather than taking
 * the whole thread down.
 */
export function certifierEmailAttachments(
  value: unknown,
): CertifierEmailAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      const { name, url } = item as { name: string; url: string };
      return [{ name, url }];
    }
    return [];
  });
}

/**
 * What the extraction read about one checklist line beyond its name.
 *
 * Stored on `ComplianceDocument.detail` for a CHECKLIST_ITEM row. Every field is
 * optional and every field is the certifier's own words: this is transcription,
 * not our summary of their document, and a field the certifier did not write is
 * absent rather than invented.
 *
 * `version` follows `ProjectRequirementsPayload` (types/project-flow.ts) — the
 * shape will widen, and a stored blob has to say which shape it is. A new field
 * is added as optional with a comment saying why, never by migrating rows.
 */
export interface ChecklistItemDetail {
  version: 1;
  /**
   * The certifier's own numbering — "4a", "2", "14".
   *
   * Three jobs, which is why it is extracted rather than derived from position:
   * it is shown to the admin, it is the tie-break when a revised checklist is
   * matched against existing rows, and it is how a trailing note that names an
   * item by number is attached back to it.
   */
  clause?: string;
  /** The heading this item sat under — "Design Documentation". Stored so a row
   *  can say where it came from once the checklist card groups by it. */
  group?: string;
  /**
   * What the item actually is, where the label alone does not say.
   *
   * "Long Service Levy" is really "provide receipt of payments made to the Long
   * Service Payments Corporation for 0.25% of the construction cost" — the
   * label is the certifier's shorthand and this is the sentence explaining it.
   * Absent when the label already says everything.
   */
  description?: string;
  /**
   * The conditions this file has to satisfy, verbatim and in order.
   *
   * The nine amendments under "Architectural Plans" are the reason this column
   * exists: without them the admin uploads the plans, and the certifier sends
   * them back because the GFA sheet on A17 was never corrected.
   */
  requirements?: string[];
  /**
   * Standards, code clauses and external instruments the item cites.
   *
   * Never used as a lookup key. OCR misreads "section 88B" as "section 888" on
   * the checklist this was built against — legible to a person, wrong to a
   * matcher.
   */
  references?: string[];
  /**
   * The tracked type this line is asking for, where it is one we already hold.
   *
   * Display only: it is what lets a row say the certifier already has this,
   * next to the control that marks it not required. Nothing acts on it — the
   * decision to skip an item is the admin's, never inferred.
   */
  mapsToType?: ComplianceDocumentType;
}

/**
 * The checklist document's own metadata — what belongs to no single item.
 *
 * Stored on `ComplianceDocument.detail` for the CHECKLIST row, which is the
 * document these came off. Kept there rather than on the engagement so that
 * re-extracting a revised checklist overwrites them in the same step that
 * rewrites the items, instead of leaving a second place to remember.
 */
export interface ChecklistDocumentDetail {
  version: 1;
  /** The header block — project number, reference, site address, scope of works. */
  header?: { label: string; value: string }[];
  /** The trailing notes: full assessment does not start until everything lands;
   *  a CDC does not authorise commencement without an NOC and a PC appointment. */
  notes?: string[];
  certifier?: { name?: string; contact?: string; dated?: string };
}

/** Trims a value to a non-empty string, or null. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Trims a Json array to its non-empty strings. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const text = optionalString(item);
    return text ? [text] : [];
  });
}

/**
 * Reads the detail off a checklist item row.
 *
 * Defensive in the shape of `certifierEmailAttachments` above, and for the same
 * reason: the column is `Json`, so it holds whatever was written there —
 * including null for every row predating it, and whatever an older shape wrote.
 * A row that cannot be read renders as a plain row rather than taking the
 * compliance tab down.
 *
 * Returns null when there is nothing worth showing, so a caller can test the
 * result rather than testing each field.
 */
export function checklistItemDetail(value: unknown): ChecklistItemDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;

  const detail: ChecklistItemDetail = { version: 1 };
  const clause = optionalString(raw.clause);
  if (clause) detail.clause = clause;
  const group = optionalString(raw.group);
  if (group) detail.group = group;
  const description = optionalString(raw.description);
  if (description) detail.description = description;

  const requirements = stringList(raw.requirements);
  if (requirements.length) detail.requirements = requirements;
  const references = stringList(raw.references);
  if (references.length) detail.references = references;

  // Validated against the live enum rather than trusted: the blob may predate a
  // type being renamed, and an unknown string would otherwise reach the UI as a
  // document type nothing can render.
  const mapsToType = optionalString(raw.mapsToType);
  if (mapsToType && mapsToType in ComplianceDocumentType) {
    detail.mapsToType = mapsToType as ComplianceDocumentType;
  }

  // `version` alone is not content. A blob holding nothing else is the same as
  // no blob, and saying so here keeps every caller to one emptiness check.
  return Object.keys(detail).length > 1 ? detail : null;
}

/** Reads the checklist document's own metadata. Defensive, as above. */
export function checklistDocumentDetail(
  value: unknown,
): ChecklistDocumentDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const detail: ChecklistDocumentDetail = { version: 1 };

  if (Array.isArray(raw.header)) {
    const header = raw.header.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const label = optionalString(entry.label);
      const value = optionalString(entry.value);
      return label && value ? [{ label, value }] : [];
    });
    if (header.length) detail.header = header;
  }

  const notes = stringList(raw.notes);
  if (notes.length) detail.notes = notes;

  if (raw.certifier && typeof raw.certifier === "object") {
    const source = raw.certifier as Record<string, unknown>;
    const certifier: NonNullable<ChecklistDocumentDetail["certifier"]> = {};
    const name = optionalString(source.name);
    if (name) certifier.name = name;
    const contact = optionalString(source.contact);
    if (contact) certifier.contact = contact;
    const dated = optionalString(source.dated);
    if (dated) certifier.dated = dated;
    if (Object.keys(certifier).length) detail.certifier = certifier;
  }

  return Object.keys(detail).length > 1 ? detail : null;
}
