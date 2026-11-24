import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { UserPrincipal } from "../../principal";
import { recordCallerAccess } from "./audit";
import type { VoiceCallerClass, VoiceCallerPrincipal } from "./identity";
import {
  bookingsBetween,
  leadSummary,
  offerStatus,
  pipelineSummary,
  projectFinancials,
  projectStatus,
  tradieBookings,
  type VoiceLookupPorts,
} from "./lookup-reads";
import { currentVoiceStaff } from "./relationships";

// The read-only questions a verified admin can ask Mili mid-call.
//
// GPT-Live cannot call tools, and its own delegation fires unreliably, so the
// call desk — which already reads the conversation after everything Mili says
// — is offered these as tools when (and only when) the caller is an ADMIN. It
// calls one; the server runs it here, under the caller's re-checked identity,
// and hands Mili the answer to read out.
//
// A catalogue, not a query language: each entry is one purpose-specific read
// with a bounded, speakable answer, built on the domain's own reads
// (`listProjectsForLookup`, `getProjectFinancials`, `searchLeads`,
// `searchTradies`) so the scope and the Admin-only financial rule (#158) are
// the app's, not a copy. Records are found by the words the caller used and
// resolved in the database — never by an id the model supplies. Nothing here
// writes, and nothing here reaches credentials, secrets or raw tables.
//
// This file is the catalogue and the gate: which lookups exist, who may run
// them, the identity re-check and the audit. The reads themselves are in
// lookup-reads.ts.

export type VoiceLookupWhen = "today" | "tomorrow" | "this_week" | "next_week";

export type VoiceLookupRequest =
  | { readonly name: "project_status"; readonly project: string }
  | { readonly name: "project_financials"; readonly project: string }
  | { readonly name: "lead_summary"; readonly lead: string }
  | { readonly name: "offer_status"; readonly offer: string }
  | { readonly name: "tradie_bookings"; readonly tradie: string }
  | { readonly name: "bookings_between"; readonly when: VoiceLookupWhen }
  | { readonly name: "pipeline_summary" };

export type VoiceLookupName = VoiceLookupRequest["name"];

export type VoiceLookupDefinition = {
  readonly name: VoiceLookupName;
  readonly description: string;
  /** JSON Schema for the call desk's tool. */
  readonly parameters: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
  /** Who may run it. Only admins today. */
  readonly classes: readonly VoiceCallerClass[];
};

const text = (description: string) => ({
  description,
  maxLength: 80,
  type: "string",
});

export const VOICE_LOOKUPS: readonly VoiceLookupDefinition[] = [
  {
    classes: ["admin"],
    description:
      "A project's status, stages in progress and coming up, site manager and the next trade bookings. Use when the caller asks how a job is going.",
    name: "project_status",
    parameters: {
      additionalProperties: false,
      properties: {
        project: text("The project's name or suburb, as the caller said it."),
      },
      required: ["project"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A project's money: contract value, trade costs quoted and invoiced, forecast profit, and the client's progress claims paid and outstanding.",
    name: "project_financials",
    parameters: {
      additionalProperties: false,
      properties: {
        project: text("The project's name or suburb, as the caller said it."),
      },
      required: ["project"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A lead's stage, who it is assigned to, its value and the next meeting or follow-up.",
    name: "lead_summary",
    parameters: {
      additionalProperties: false,
      properties: {
        lead: text("The lead's name or suburb, as the caller said it."),
      },
      required: ["lead"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A client's current offer: its reference, status, when it went out and its value. Use when the caller asks about an offer, a quote or a reference number.",
    name: "offer_status",
    parameters: {
      additionalProperties: false,
      properties: {
        offer: text(
          "The client's name, the site, or the offer reference, as the caller said it.",
        ),
      },
      required: ["offer"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A tradie's trades, phone number and their bookings over the next month.",
    name: "tradie_bookings",
    parameters: {
      additionalProperties: false,
      properties: {
        tradie: text(
          "The tradie's name or business name, as the caller said it.",
        ),
      },
      required: ["tradie"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description: "Every trade booking for a period, across all projects.",
    name: "bookings_between",
    parameters: {
      additionalProperties: false,
      properties: {
        when: {
          enum: ["today", "tomorrow", "this_week", "next_week"],
          type: "string",
        },
      },
      required: ["when"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description: "Open leads by stage, and how many came in this week.",
    name: "pipeline_summary",
    parameters: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    },
  },
];

/** The lookups this caller's class may run. Empty for everyone but admins. */
export function voiceLookupsFor(
  caller: VoiceCallerPrincipal,
): readonly VoiceLookupDefinition[] {
  return VOICE_LOOKUPS.filter((lookup) =>
    lookup.classes.includes(caller.identity.class),
  );
}

export type VoiceLookupResult = {
  /** What Mili may say: bounded, one fact per line. */
  readonly text: string;
  readonly recordIds: readonly string[];
};

/**
 * Run one catalogue lookup for this caller.
 *
 * Refuses — and audits the refusal — when the caller's class may not run it;
 * re-checks the caller's identity on every call; audits the record ids it
 * read before returning. Throws on refusal or failure: the adapter tells Mili
 * she could not check, never that something was found.
 */
export async function runVoiceLookup(
  caller: VoiceCallerPrincipal,
  request: VoiceLookupRequest,
  db: DomainDb,
  input: { readonly now: Date },
  ports: VoiceLookupPorts = {},
): Promise<VoiceLookupResult> {
  const allowed = voiceLookupsFor(caller).some(
    (lookup) => lookup.name === request.name,
  );
  if (!allowed) {
    await recordCallerAccess(
      caller,
      { kind: "REFUSED", outcome: "not_permitted", queryName: request.name },
      db,
    );
    throw new DomainAuthorizationError(
      "That lookup is not available to this caller.",
    );
  }
  let principal: UserPrincipal;
  try {
    principal = await currentVoiceStaff(caller, db);
  } catch (error) {
    await recordCallerAccess(
      caller,
      { kind: "REFUSED", outcome: "identity_changed", queryName: request.name },
      db,
    );
    throw error;
  }
  const { now } = input;
  const result =
    request.name === "project_status"
      ? await projectStatus(principal, request.project, db, now, ports)
      : request.name === "project_financials"
        ? await projectFinancials(principal, request.project, db, ports)
        : request.name === "lead_summary"
          ? await leadSummary(principal, request.lead, db, now, ports)
          : request.name === "offer_status"
            ? await offerStatus(principal, request.offer, db, now, ports)
            : request.name === "tradie_bookings"
              ? await tradieBookings(principal, request.tradie, db, now)
              : request.name === "bookings_between"
                ? await bookingsBetween(principal, request.when, db, now)
                : await pipelineSummary(principal, db, now);
  await recordCallerAccess(
    caller,
    {
      kind: "LOOKUP",
      outcome: "ok",
      queryName: request.name,
      recordIds: result.recordIds,
    },
    db,
  );
  return result;
}
