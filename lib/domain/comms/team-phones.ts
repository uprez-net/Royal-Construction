import { Prisma, Role, type CommsTeamPhone } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import type { CommsChannel } from "../ports/comms";
import {
  isOfficePrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { normaliseLeadPhone } from "../leads/whatsapp/phone";

// The phones a lead call can be put through to.
//
// "Call via phone" used to ring one number, COMMS_STAFF_FORWARD_NUMBER, so
// only whoever carried the office mobile could take a lead call away from a
// browser. An admin now keeps a list of the team's own phones under Admin →
// Phone & SMS, and whoever presses Call picks which one rings.
//
// The env number stays: it is still where an inbound call goes when Mili
// can't take it, and it is offered as "Office mobile" beside the team's
// phones unless one of them is the same number.

const MAX_NICKNAME_LENGTH = 40;

/** What the picker calls the env number. */
export const OFFICE_MOBILE_LABEL = "Office mobile";

export type TeamPhoneRecord = {
  readonly id: string;
  readonly nickname: string;
  readonly e164: string;
};

/** One phone a call can ring. `id` is null for the env office mobile. */
export type CallablePhone = {
  readonly id: string | null;
  readonly nickname: string;
  readonly e164: string;
};

function toRecord(row: CommsTeamPhone): TeamPhoneRecord {
  return { e164: row.e164, id: row.id, nickname: row.nickname };
}

function validNickname(raw: string): string {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (!nickname) {
    throw new DomainValidationError(
      "Give the phone a nickname, like the name of whoever carries it.",
      "nickname",
    );
  }
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    throw new DomainValidationError(
      `Keep the nickname to ${MAX_NICKNAME_LENGTH} characters or fewer.`,
      "nickname",
    );
  }
  return nickname;
}

/**
 * A number a call may be put through to. Never one of Royal's own business
 * numbers: the call would ring straight back into the office line, and Mili
 * would answer the customer's call to us.
 */
function validNumber(
  raw: string,
  channel: Pick<CommsChannel, "numbers"> | null,
): string {
  const phone = normaliseLeadPhone(raw);
  if (!phone.usable || !phone.e164) {
    throw new DomainValidationError(
      phone.raw
        ? "That isn't a valid phone number. Use a mobile like 0412 345 678 or +61 412 345 678."
        : "Enter the phone number.",
      "number",
    );
  }
  if (channel?.numbers.some((number) => number.e164 === phone.e164)) {
    throw new DomainValidationError(
      "That's one of the business numbers. Add the team member's own phone, so calls aren't put back through to the office line.",
      "number",
    );
  }
  return phone.e164;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}

async function assertNumberFree(
  e164: string,
  db: DomainDb,
  exceptId?: string,
): Promise<void> {
  const clash = await db.commsTeamPhone.findFirst({
    select: { nickname: true },
    where: { e164, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) {
    throw new DomainValidationError(
      `That number is already on the list as "${clash.nickname}".`,
      "number",
    );
  }
}

/**
 * May this caller see the team's phone numbers? Staff, but not GUEST: a new
 * sign-up is a GUEST until an admin promotes them, and these are people's own
 * mobiles. GUEST stays inside INTERNAL_ROLES for lead access; this rule is
 * only about the numbers.
 */
export function canSeeTeamPhones(principal: DomainPrincipal): boolean {
  return (
    isOfficePrincipal(principal)
    && !(principal.kind === "user" && principal.role === Role.GUEST)
  );
}

/** The team's phones, by nickname. Staff other than GUEST: the Call picker. */
export async function listTeamPhones(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<TeamPhoneRecord[]> {
  if (!canSeeTeamPhones(principal)) {
    throw new DomainAuthorizationError("Team phones are for members of staff.");
  }
  const rows = await db.commsTeamPhone.findMany({
    orderBy: [{ nickname: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toRecord);
}

/**
 * Every phone a lead call can ring: the team's phones, then the env office
 * mobile unless a team phone already has its number.
 */
export function callablePhones(
  teamPhones: readonly TeamPhoneRecord[],
  channel: Pick<CommsChannel, "staffForwardNumber"> | null,
): CallablePhone[] {
  const phones: CallablePhone[] = teamPhones.map((phone) => ({ ...phone }));
  const office = channel?.staffForwardNumber ?? null;
  if (office && !phones.some((phone) => phone.e164 === office)) {
    phones.push({ e164: office, id: null, nickname: OFFICE_MOBILE_LABEL });
  }
  return phones;
}

/**
 * The phone a call placed now should ring. A `phoneId` names a team phone;
 * none means the office mobile. Refuses a phone removed since the picker
 * loaded, rather than quietly ringing a different one.
 */
export async function resolveCallablePhone(
  principal: DomainPrincipal,
  phoneId: string | null,
  channel: Pick<CommsChannel, "staffForwardNumber" | "numbers">,
  db: DomainDb,
): Promise<CallablePhone | null> {
  if (phoneId) {
    if (!canSeeTeamPhones(principal)) {
      throw new DomainAuthorizationError(
        "Only staff can put a call through to a team phone.",
      );
    }
    const row = await db.commsTeamPhone.findUnique({ where: { id: phoneId } });
    if (!row) {
      throw new DomainValidationError(
        "That phone was taken off the team list. Pick another one.",
        "phoneId",
      );
    }
    if (channel.numbers.some((number) => number.e164 === row.e164)) {
      throw new DomainValidationError(
        `"${row.nickname}" has one of the business numbers, so it can't take calls. Change it under Admin → Phone & SMS.`,
        "phoneId",
      );
    }
    return toRecord(row);
  }
  if (!channel.staffForwardNumber) return null;
  return {
    e164: channel.staffForwardNumber,
    id: null,
    nickname: OFFICE_MOBILE_LABEL,
  };
}

/** Add a team phone. ADMIN only. */
export async function createTeamPhone(
  principal: DomainPrincipal,
  input: { readonly nickname: string; readonly number: string },
  db: DomainDb,
  context: { readonly channel: Pick<CommsChannel, "numbers"> | null },
): Promise<TeamPhoneRecord> {
  requireAdminPrincipal(principal);
  const nickname = validNickname(input.nickname);
  const e164 = validNumber(input.number, context.channel);
  await assertNumberFree(e164, db);
  try {
    return toRecord(
      await db.commsTeamPhone.create({ data: { e164, nickname } }),
    );
  } catch (error) {
    // A double-clicked Add: the first one won.
    if (isUniqueViolation(error)) {
      throw new DomainValidationError(
        "That number is already on the list.",
        "number",
        { cause: error },
      );
    }
    throw error;
  }
}

/** Rename a team phone or change its number. ADMIN only. */
export async function updateTeamPhone(
  principal: DomainPrincipal,
  input: {
    readonly id: string;
    readonly nickname?: string;
    readonly number?: string;
  },
  db: DomainDb,
  context: { readonly channel: Pick<CommsChannel, "numbers"> | null },
): Promise<TeamPhoneRecord> {
  requireAdminPrincipal(principal);
  const nickname =
    input.nickname === undefined ? undefined : validNickname(input.nickname);
  const e164 =
    input.number === undefined
      ? undefined
      : validNumber(input.number, context.channel);
  const current = await db.commsTeamPhone.findUnique({
    where: { id: input.id },
  });
  if (!current)
    throw new DomainNotFoundError("That phone is no longer listed.");
  if (e164 !== undefined) await assertNumberFree(e164, db, current.id);
  try {
    return toRecord(
      await db.commsTeamPhone.update({
        data: { e164, nickname },
        where: { id: current.id },
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainValidationError(
        "That number is already on the list.",
        "number",
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Take a phone off the list. ADMIN only. Calls it already took keep its
 * number and nickname on their own row.
 */
export async function deleteTeamPhone(
  principal: DomainPrincipal,
  input: { readonly id: string },
  db: DomainDb,
): Promise<void> {
  requireAdminPrincipal(principal);
  const removed = await db.commsTeamPhone.deleteMany({
    where: { id: input.id },
  });
  if (removed.count === 0) {
    throw new DomainNotFoundError("That phone is no longer listed.");
  }
}
