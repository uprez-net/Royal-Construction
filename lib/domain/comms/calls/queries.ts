import { CommsDirection } from "@prisma/client";

import { authorizeLead, canAccessLead } from "../../access/leads";
import type { DomainDb } from "../../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../../errors";
import type { CommsChannel } from "../../ports/comms";
import { isOfficePrincipal, type DomainPrincipal } from "../../principal";
import { normaliseLeadPhone } from "../../leads/whatsapp/phone";
import { SMS_REFUSALS } from "../sms/policy";
import {
  callablePhones,
  canSeeTeamPhones,
  listTeamPhones,
  type CallablePhone,
  type TeamPhoneRecord,
} from "../team-phones";
import { CALL_REFUSALS } from "./outbound";
import { CALL_SELECT, toCallRecord, type CallRecord } from "./records";
import {
  fromTeam,
  listTeamCallers,
  notFromTeam,
  type TeamCaller,
} from "../team-callers";

export type LeadCallOptions = {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly to: string | null;
  readonly browser: boolean;
  readonly mobile: boolean;
  /** The phones "Call via phone" can ring: the team's, then the office mobile. */
  readonly phones: readonly CallablePhone[];
};

/** Whether this runtime can place a call at all, and how it can be taken. */
export type ChannelCallOptions = Omit<LeadCallOptions, "to">;

/**
 * The half of "can this be rung?" that is about the phone system rather than
 * who is being rung: is calling on, is there a number to call from, and can
 * the person take it in a browser or on a phone. Shared by a lead's Call
 * button and the project dialer so they cannot disagree.
 */
export function channelCallOptions(
  channel: CommsChannel | null,
  teamPhones: readonly TeamPhoneRecord[] = [],
): ChannelCallOptions {
  const browser = Boolean(channel?.browserCalling);
  const phones = callablePhones(teamPhones, channel);
  const mobile = phones.length > 0;
  const reason = !channel?.callsAvailable
    ? CALL_REFUSALS.noCalls
    : !channel.defaultNumber
      ? CALL_REFUSALS.noSender
      : !browser && !mobile
        ? CALL_REFUSALS.noMobile
        : null;
  return { allowed: reason === null, browser, mobile, phones, reason };
}

/** Whether this lead can be rung now, and how — for the Call button. */
export function evaluateLeadCallOptions(
  lead: { readonly phone: string; readonly isArchived: boolean },
  channel: CommsChannel | null,
  teamPhones: readonly TeamPhoneRecord[] = [],
): LeadCallOptions {
  const phone = normaliseLeadPhone(lead.phone);
  const options = channelCallOptions(channel, teamPhones);
  const reason = lead.isArchived
    ? CALL_REFUSALS.archived
    : !phone.usable
      ? phone.raw
        ? SMS_REFUSALS.invalidPhone
        : SMS_REFUSALS.noPhone
      : options.reason;
  return {
    ...options,
    allowed: reason === null,
    reason,
    to: phone.e164,
  };
}

export async function getLeadCalls(
  principal: DomainPrincipal,
  input: { readonly leadId: number },
  db: DomainDb,
  context: { readonly channel: CommsChannel | null },
): Promise<{ calls: CallRecord[]; options: LeadCallOptions }> {
  await authorizeLead(principal, input.leadId, db);
  const lead = await db.lead.findUnique({
    select: { isArchived: true, phone: true },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  const [rows, teamPhones] = await Promise.all([
    db.call.findMany({
      orderBy: { startedAt: "desc" },
      select: CALL_SELECT,
      take: 50,
      where: { leadId: input.leadId },
    }),
    // A GUEST gets the office mobile only, as before the team list existed.
    canSeeTeamPhones(principal) ? listTeamPhones(principal, db) : [],
  ]);
  return {
    calls: rows.map(toCallRecord),
    options: evaluateLeadCallOptions(lead, context.channel, teamPhones),
  };
}

/** One call, for the dialer (who is ringing?) and the call modal. */
export async function getCall(
  principal: DomainPrincipal,
  input: { readonly callId: string },
  db: DomainDb,
): Promise<CallRecord> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError("Calls are for members of staff.");
  }
  const row = await db.call.findUnique({
    select: {
      ...CALL_SELECT,
      lead: { select: { assignedId: true, id: true, name: true } },
    },
    where: { id: input.callId },
  });
  if (!row || (row.lead && !canAccessLead(principal, row.lead))) {
    throw new DomainNotFoundError("Call not found");
  }
  return toCallRecord(row);
}

const ADMIN_CALL_LIMIT = 50;

export type TeamCallRecord = {
  readonly call: CallRecord;
  readonly caller: TeamCaller;
};

export type AdminInboundCalls = {
  /** From numbers that matched no single lead, and not the team's. */
  readonly unknown: readonly CallRecord[];
  /** From the team's own numbers, with whose number it was. */
  readonly team: readonly TeamCallRecord[];
};

/**
 * Recent inbound calls for the admin Phone & SMS page: those from numbers no
 * single lead owns, and those from the team (./team-callers), each under the
 * team member's name. A team member's call is never "unknown".
 */
export async function listAdminInboundCalls(
  principal: DomainPrincipal,
  db: DomainDb,
  context: {
    readonly channel?: Pick<CommsChannel, "staffForwardNumber"> | null;
  } = {},
): Promise<AdminInboundCalls> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError("Calls are for members of staff.");
  }
  const callers = await listTeamCallers(db, context);
  const [unknown, team] = await Promise.all([
    db.call.findMany({
      orderBy: { startedAt: "desc" },
      select: CALL_SELECT,
      take: ADMIN_CALL_LIMIT,
      where: {
        direction: CommsDirection.INBOUND,
        leadId: null,
        ...notFromTeam(callers),
      },
    }),
    callers.length === 0
      ? []
      : db.call.findMany({
          orderBy: { startedAt: "desc" },
          select: CALL_SELECT,
          take: ADMIN_CALL_LIMIT,
          where: { direction: CommsDirection.INBOUND, ...fromTeam(callers) },
        }),
  ]);
  const byNumber = new Map(callers.map((caller) => [caller.e164, caller]));
  return {
    team: team.flatMap((row) => {
      const caller = byNumber.get(row.customerNumber);
      return caller ? [{ call: toCallRecord(row), caller }] : [];
    }),
    unknown: unknown.map(toCallRecord),
  };
}
