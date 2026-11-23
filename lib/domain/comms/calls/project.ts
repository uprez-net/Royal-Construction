import { CallContactKind, OutboxEventKind } from "@prisma/client";

import { assertCanUseProjectCalls } from "../../access/projects";
import { logActionOrThrow } from "../../audit/action-log";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import {
  formatE164ForDisplay,
  normaliseLeadPhone,
} from "../../leads/whatsapp/phone";
import type { CommsChannel, VoicePort } from "../../ports/comms";
import { attributionUserId, type DomainPrincipal } from "../../principal";
import { SMS_REFUSALS } from "../sms/policy";
import { maskNumber } from "../shared";
import { listTeamPhones } from "../team-phones";
import { PROJECT_UNREAD_CALL_WHERE } from "../unread";
import {
  placedDetail,
  placeStaffCall,
  requireCallKey,
  type RequestLeadCallResult,
} from "./outbound";
import { channelCallOptions, type ChannelCallOptions } from "./queries";
import { CALL_SELECT, toCallRecord, type CallRecord } from "./records";

// A project's phone: ringing its people from the project page, and every call
// filed on the project (placed from here, or inbound and matched by
// ./project-matching.ts).
//
// The people are read from the project every time — the site manager, every
// owner on the contract, and every tradie connected to the build — so the
// number that rings is the one on their record now, never one the browser
// sent. A number typed into the keypad is the one exception, and it is still
// only ever placed server side, customer first, exactly like a lead call
// (./outbound.ts): the browser only receives the bridged leg.
//
// ADMIN only (`canUseProjectCalls`). A site manager is never offered the
// dialer, and every command here refuses one.

/** The calls a project's log shows; older ones stay in the database. */
const PROJECT_CALL_LIMIT = 100;

export type ProjectCallContact = {
  /** "user:<id>", "customer:<id>" or "tradie:<id>": what a call is placed to. */
  readonly ref: string;
  readonly kind: CallContactKind;
  readonly name: string;
  /** "Site manager", "Owner", "Owner (2nd)", or the tradie's trade. */
  readonly role: string;
  /** Null when there is no usable number; `problem` says why. */
  readonly e164: string | null;
  readonly problem: string | null;
};

export type ProjectCallsView = {
  readonly calls: readonly CallRecord[];
  readonly contacts: readonly ProjectCallContact[];
  readonly options: ChannelCallOptions;
  /** Matched inbound calls nobody has opened on this project yet. */
  readonly unread: number;
};

export type RequestProjectCallInput = {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly target: "browser" | "mobile";
  readonly phoneId?: string | null;
  /** One of the project's people, by `ref`, or a typed number. */
  readonly to: { readonly contactRef: string } | { readonly number: string };
  readonly now?: Date;
};

export const PROJECT_CALL_REFUSALS = {
  notOnProject:
    "That person isn't on this project any more. Refresh the dialer and pick again.",
  ownNumber:
    "That's one of Royal's own numbers, so it would only ring back into the office.",
  typedInvalid:
    "That doesn't look like a phone number that can be rung. Check the digits, or start with + and the country code.",
} as const;

export function projectCallOutboxKey(projectId: string, key: string): string {
  return `project-call:${projectId}:${key}`;
}

function usableNumber(raw: string | null | undefined): {
  e164: string | null;
  problem: string | null;
} {
  const phone = normaliseLeadPhone(raw);
  if (phone.usable) return { e164: phone.e164, problem: null };
  return {
    e164: null,
    problem: phone.raw ? SMS_REFUSALS.invalidPhone : "No phone number on file.",
  };
}

const ORDINALS = ["", "", "2nd", "3rd", "4th", "5th", "6th"];

/**
 * Everyone on a project who can be rung from it: the site manager, then the
 * owners in contract order, then the connected tradies by name. A tradie is
 * connected when they are on the project, booked on it, or on one of its
 * milestones; an archived tradie is left out.
 */
export async function listProjectCallContacts(
  projectId: string,
  db: DomainDb,
): Promise<ProjectCallContact[]> {
  const tradieSelect = {
    archivedAt: true,
    id: true,
    name: true,
    phone: true,
    trade: true,
  } as const;
  const project = await db.project.findUnique({
    select: {
      customers: {
        orderBy: { position: "asc" },
        select: {
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
      milestones: { select: { tradies: { select: tradieSelect } } },
      siteManager: { select: { id: true, name: true, phone: true } },
      tradieSchedules: { select: { tradie: { select: tradieSelect } } },
      tradies: { select: tradieSelect },
    },
    where: { id: projectId },
  });
  if (!project) throw new DomainNotFoundError("Project not found");

  const contacts: ProjectCallContact[] = [];
  if (project.siteManager) {
    contacts.push({
      kind: CallContactKind.SITE_MANAGER,
      name: project.siteManager.name,
      ref: `user:${project.siteManager.id}`,
      role: "Site manager",
      ...usableNumber(project.siteManager.phone),
    });
  }
  project.customers.forEach(({ customer }, index) => {
    contacts.push({
      kind: CallContactKind.OWNER,
      name: customer.name,
      ref: `customer:${customer.id}`,
      role:
        project.customers.length > 1 && index > 0
          ? `Owner (${ORDINALS[index + 1] ?? `${index + 1}th`})`
          : "Owner",
      ...usableNumber(customer.phone),
    });
  });

  const tradies = new Map<
    string,
    { name: string; phone: string; trade: string }
  >();
  for (const tradie of [
    ...project.tradies,
    ...project.tradieSchedules.map((schedule) => schedule.tradie),
    ...project.milestones.flatMap((milestone) => milestone.tradies),
  ]) {
    if (tradie.archivedAt === null) tradies.set(tradie.id, tradie);
  }
  [...tradies]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .forEach(([id, tradie]) => {
      contacts.push({
        kind: CallContactKind.TRADIE,
        name: tradie.name,
        ref: `tradie:${id}`,
        role: tradie.trade,
        ...usableNumber(tradie.phone),
      });
    });
  return contacts;
}

/** The project's people and calls, and whether a call can be placed now. */
export async function getProjectCalls(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
  context: { readonly channel: CommsChannel | null },
): Promise<ProjectCallsView> {
  assertCanUseProjectCalls(principal);
  const contacts = await listProjectCallContacts(input.projectId, db);
  const [rows, teamPhones, unread] = await Promise.all([
    db.call.findMany({
      orderBy: { startedAt: "desc" },
      select: CALL_SELECT,
      take: PROJECT_CALL_LIMIT,
      where: { projectId: input.projectId },
    }),
    listTeamPhones(principal, db),
    db.call.count({
      where: { ...PROJECT_UNREAD_CALL_WHERE, projectId: input.projectId },
    }),
  ]);
  return {
    calls: rows.map(toCallRecord),
    contacts,
    options: channelCallOptions(context.channel, teamPhones),
    unread,
  };
}

/** Just the number beside the call icon on the project's Comms tab. */
export async function countUnreadProjectCalls(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<number> {
  assertCanUseProjectCalls(principal);
  return db.call.count({
    where: { ...PROJECT_UNREAD_CALL_WHERE, projectId: input.projectId },
  });
}

/** Opening the project's Calls reads its matched inbound calls. */
export async function markProjectCallsSeen(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly at?: Date },
  db: DomainDb,
): Promise<number> {
  assertCanUseProjectCalls(principal);
  const { count } = await db.call.updateMany({
    data: { projectSeenAt: input.at ?? new Date() },
    where: { ...PROJECT_UNREAD_CALL_WHERE, projectId: input.projectId },
  });
  return count;
}

const KIND_LABEL: Record<CallContactKind, string> = {
  [CallContactKind.OTHER]: "a number typed into the dialer",
  [CallContactKind.OWNER]: "owner",
  [CallContactKind.SITE_MANAGER]: "site manager",
  [CallContactKind.TRADIE]: "tradie",
};

/**
 * Ring one of a project's people, or a typed number, from the project page.
 *
 * The same placing rule as a lead call (`placeStaffCall`): keyed per click,
 * customer first, and an ambiguous answer from the carrier is flagged for a
 * person instead of retried. The call is filed on the project with who it
 * was to; a typed number that turns out to be one of the project's people is
 * filed as them.
 */
export async function requestProjectCall(
  principal: DomainPrincipal,
  input: RequestProjectCallInput,
  db: TransactionalDomainDb,
  ports: {
    readonly voice?: VoicePort | null;
    readonly channel?: CommsChannel | null;
  } = {},
): Promise<RequestLeadCallResult> {
  assertCanUseProjectCalls(principal);
  if (principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Calling requires a signed-in member of staff.",
    );
  }
  const now = input.now ?? new Date();
  const outboxKey = projectCallOutboxKey(
    input.projectId,
    requireCallKey(input.idempotencyKey),
  );
  const contacts = await listProjectCallContacts(input.projectId, db);

  // Decided before placing, so the row is filed as who was actually rung.
  let contact: ProjectCallContact | null = null;
  let typed: string | null = null;
  if ("contactRef" in input.to) {
    const ref = input.to.contactRef;
    contact = contacts.find((candidate) => candidate.ref === ref) ?? null;
    if (!contact) {
      throw new DomainValidationError(
        PROJECT_CALL_REFUSALS.notOnProject,
        "contactRef",
      );
    }
  } else {
    const phone = normaliseLeadPhone(input.to.number);
    if (!phone.usable) {
      throw new DomainValidationError(
        PROJECT_CALL_REFUSALS.typedInvalid,
        "number",
      );
    }
    typed = phone.e164;
    contact = contacts.find((candidate) => candidate.e164 === typed) ?? null;
  }
  const to = contact?.e164 ?? typed;
  if (to && ports.channel?.numbers.some((number) => number.e164 === to)) {
    throw new DomainValidationError(PROJECT_CALL_REFUSALS.ownNumber, "number");
  }
  const kind = contact?.kind ?? CallContactKind.OTHER;
  const who = contact?.name ?? (to ? formatE164ForDisplay(to) : "a number");

  return placeStaffCall(
    principal,
    {
      history: async (tx, placed) => {
        await logActionOrThrow(
          {
            authorId: attributionUserId(principal),
            message: `Call placed to ${contact ? `${contact.name} (${KIND_LABEL[kind]})` : `${maskNumber(placed.to)} (${KIND_LABEL[kind]})`}. ${placedDetail(placed)}`,
            projectId: input.projectId,
            timestamp: now,
            type: "call",
          },
          tx,
        );
      },
      kind: OutboxEventKind.PROJECT_CALL_PLACE,
      link: {
        contactKind: kind,
        contactName: contact?.name ?? null,
        contactRef: contact?.ref ?? null,
        projectId: input.projectId,
        // Somebody placed it from here: there is nothing unread about it.
        projectSeenAt: now,
      },
      now,
      outboxKey,
      payload: { contactKind: kind, projectId: input.projectId },
      phoneId: input.phoneId ?? null,
      resolveTo: () => {
        if (to) return to;
        throw new DomainTransitionError(
          contact?.problem
            ? `${who} can't be rung: ${contact.problem}`
            : PROJECT_CALL_REFUSALS.typedInvalid,
        );
      },
      target: input.target,
    },
    db,
    ports,
  );
}
