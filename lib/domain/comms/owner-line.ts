import type { CommsOwnerLine } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import type { CommsBusinessNumber } from "../ports/comms";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { normaliseLeadPhone } from "../leads/whatsapp/phone";
import { canSeeTeamPhones } from "./team-phones";

// The owner line: the business owner's own phone, where Mili rings with a
// briefing that Hermes — the owner's assistant, on its own server — asks for
// (calls/owner-call.ts). One number, set by an admin under Admin → Phone &
// SMS. It is the only number a briefing call can ever ring: Hermes names
// what to say, never who to call, so a leaked Hermes secret can bother the
// owner but cannot dial anyone else on Royal's account.

const OWNER_LINE_ID = "owner";
const MAX_NICKNAME_LENGTH = 40;

export type OwnerLineRecord = {
  /** How Mili greets whoever answers: "Raj". */
  readonly nickname: string;
  readonly e164: string;
  readonly updatedAt: Date;
};

function toRecord(row: CommsOwnerLine): OwnerLineRecord {
  return { e164: row.e164, nickname: row.nickname, updatedAt: row.updatedAt };
}

function validNickname(raw: string): string {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (!nickname) {
    throw new DomainValidationError(
      "Give the owner line a name: the first name Mili should greet them by.",
      "nickname",
    );
  }
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    throw new DomainValidationError(
      `Keep the name to ${MAX_NICKNAME_LENGTH} characters or fewer.`,
      "nickname",
    );
  }
  return nickname;
}

type BusinessNumbers = readonly Pick<CommsBusinessNumber, "e164">[];

/**
 * Never one of Royal's own business numbers: Mili would ring the office line,
 * and on an inbound call she would answer herself. Checked when the line is
 * saved and again when a call is placed, since the business numbers can
 * change after the line was set.
 */
export function isBusinessNumber(
  e164: string,
  businessNumbers: BusinessNumbers,
): boolean {
  return businessNumbers.some((number) => number.e164 === e164);
}

function validNumber(raw: string, businessNumbers: BusinessNumbers): string {
  const phone = normaliseLeadPhone(raw);
  if (!phone.usable || !phone.e164) {
    throw new DomainValidationError(
      phone.raw
        ? "That isn't a valid phone number. Use a mobile like 0412 345 678 or +61 412 345 678."
        : "Enter the owner's phone number.",
      "number",
    );
  }
  if (isBusinessNumber(phone.e164, businessNumbers)) {
    throw new DomainValidationError(
      "That's one of the business numbers. Use the owner's own phone, so Mili doesn't ring the office line.",
      "number",
    );
  }
  return phone.e164;
}

/** The owner line as an admin screen shows it. Staff other than GUEST. */
export async function getOwnerLine(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<OwnerLineRecord | null> {
  if (!canSeeTeamPhones(principal)) {
    throw new DomainAuthorizationError(
      "The owner line is for members of staff.",
    );
  }
  return readOwnerLine(db);
}

/**
 * The owner line for placing a call. No principal: the caller of this has
 * already been authorised for the call it is placing.
 */
export async function readOwnerLine(
  db: DomainDb,
): Promise<OwnerLineRecord | null> {
  const row = await db.commsOwnerLine.findUnique({
    where: { id: OWNER_LINE_ID },
  });
  return row ? toRecord(row) : null;
}

/** Set (or change) the owner line. ADMIN only. */
export async function setOwnerLine(
  principal: DomainPrincipal,
  input: { readonly nickname: string; readonly number: string },
  db: DomainDb,
  /**
   * Every configured business number, whether or not SMS or calls are on
   * right now: a line saved while they are off must still not be one.
   */
  context: { readonly businessNumbers: BusinessNumbers },
): Promise<OwnerLineRecord> {
  requireAdminPrincipal(principal);
  const nickname = validNickname(input.nickname);
  const e164 = validNumber(input.number, context.businessNumbers);
  // An upsert on a fixed id: a double-clicked Save writes the same row twice.
  const row = await db.commsOwnerLine.upsert({
    create: { e164, id: OWNER_LINE_ID, nickname },
    update: { e164, nickname },
    where: { id: OWNER_LINE_ID },
  });
  return toRecord(row);
}

/**
 * Clear the owner line. ADMIN only. Briefing calls are refused until it is set
 * again; a call already placed keeps the number it rang on its own row.
 */
export async function clearOwnerLine(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<void> {
  requireAdminPrincipal(principal);
  await db.commsOwnerLine.deleteMany({ where: { id: OWNER_LINE_ID } });
}
