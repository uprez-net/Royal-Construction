import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { Prisma, type PhoneVerification, type User } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainStaleVersionError,
  DomainValidationError,
} from "../errors";
import { commsDefinitelyNotSent, type SmsPort } from "../ports/comms";
import type { DomainPrincipal, UserPrincipal } from "../principal";
import { requireAvailableTeamPhone } from "./team";
import { findUserById } from "./users";

// A person's own phone number, and proving they hold it.
//
// The number lives on `User.phone`, the record the rest of the app reads
// (calls, the team screen, a site manager's details on a project). Clerk's
// own phone numbers are not used, for the reason the team screen gives: their
// rules are for signing in, not for a contact number. Proving the number is a
// code texted from Royal's Telnyx number and typed back on the profile page.
//
// `User.verifiedPhone` holds the number that was proved. The phone counts as
// verified only while it equals `User.phone`, so the team screen and the Clerk
// webhook, which both write `phone`, drop the badge without knowing it exists.
//
// Every texted code costs money and lands on somebody's phone, so sending is
// limited: one code per 30 seconds, five an hour. The limits are on the
// account, not the number, so changing the number does not reset them.

export const PHONE_CODE_LENGTH = 6;
export const PHONE_CODE_TTL_MS = 10 * 60_000;
export const PHONE_CODE_RESEND_MS = 30_000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
export const PHONE_CODE_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

/** Writes Clerk's `publicMetadata.phone`, which the `user.updated` webhook copies back. */
export type OwnPhoneIdentityPort = (input: {
  clerkUserId: string;
  phone: string;
}) => Promise<void>;

export type PhoneCodeSender = {
  /** The carrier's SMS capability, or null when texting is switched off. */
  readonly sms: SmsPort | null;
  /** The Royal number the code is sent from, E.164, or null. */
  readonly from: string | null;
};

export type OwnPhoneStatus = {
  readonly phone: string;
  readonly verified: boolean;
  readonly verifiedAt: Date | null;
  /** The code waiting to be typed in for this number, if one is. */
  readonly pendingCode: PendingPhoneCode | null;
};

export type PendingPhoneCode = {
  readonly sentTo: string;
  readonly expiresAt: Date;
  readonly resendAvailableAt: Date;
};

export type ConfirmPhoneResult = {
  readonly phone: string;
  readonly verifiedAt: Date;
  /** The number was already verified — a second press of Verify. */
  readonly alreadyVerified: boolean;
};

/** Only a signed-in person has a phone of their own to change or prove. */
function requireSelf(principal: DomainPrincipal): UserPrincipal {
  if (principal.kind !== "user") {
    throw new DomainAuthorizationError("Sign in to manage your phone number.");
  }
  return principal;
}

async function requireOwnUser(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<User> {
  const self = requireSelf(principal);
  const user = await findUserById(self.userId, db);
  if (!user) throw new DomainNotFoundError("Your account could not be found.");
  return user;
}

/** Verified means the number on the account is the number that was proved. */
export function isPhoneVerified(
  user: Pick<User, "phone" | "verifiedPhone">,
): boolean {
  return Boolean(user.verifiedPhone) && user.verifiedPhone === user.phone;
}

function hashCode(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function codeMatches(pending: PhoneVerification, code: string): boolean {
  const expected = Buffer.from(pending.codeHash, "hex");
  const actual = Buffer.from(hashCode(pending.salt, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function randomCode(): string {
  return String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(
    PHONE_CODE_LENGTH,
    "0",
  );
}

function pendingFor(
  user: Pick<User, "phone">,
  pending: PhoneVerification | null,
  now: Date,
): PendingPhoneCode | null {
  if (
    !pending
    || pending.phone !== user.phone
    || pending.expiresAt <= now
    || pending.attempts >= PHONE_CODE_MAX_ATTEMPTS
  ) {
    return null;
  }
  return {
    expiresAt: pending.expiresAt,
    resendAvailableAt: new Date(
      pending.sentAt.getTime() + PHONE_CODE_RESEND_MS,
    ),
    sentTo: pending.phone,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The caller's phone, whether it is verified, and any code waiting for it. */
export async function readOwnPhone(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
): Promise<OwnPhoneStatus> {
  const user = await requireOwnUser(principal, db);
  const verified = isPhoneVerified(user);
  const pending = verified
    ? null
    : await db.phoneVerification.findUnique({ where: { userId: user.id } });
  return {
    pendingCode: pendingFor(user, pending, now),
    phone: user.phone,
    verified,
    verifiedAt: verified ? user.phoneVerifiedAt : null,
  };
}

/**
 * Change the caller's own phone number.
 *
 * The same order as the team screen's `updateTeamMemberProfile`: the
 * uniqueness check first, so the commonest refusal touches nothing; Clerk's
 * metadata next, because the webhook copies that back onto `User.phone` on
 * every Clerk update and a stale copy there would undo this change the next
 * time the name is edited; the local row last, with Clerk put back if it fails.
 *
 * The new number is unverified unless it is the one already proved.
 */
export async function updateOwnPhone(
  principal: DomainPrincipal,
  input: { readonly phone: string },
  db: DomainDb,
  updateIdentity: OwnPhoneIdentityPort,
): Promise<{
  phone: string;
  changed: boolean;
  verified: boolean;
  /** For the caller to expire the cached user row, changed or not. */
  clerkUserId: string;
}> {
  const user = await requireOwnUser(principal, db);
  const phone = await requireAvailableTeamPhone(input.phone, user.id, db);

  if (phone === user.phone) {
    return {
      changed: false,
      clerkUserId: user.clerkId,
      phone,
      verified: isPhoneVerified(user),
    };
  }

  try {
    await updateIdentity({ clerkUserId: user.clerkId, phone });
  } catch (error) {
    throw new DomainSideEffectError(
      error instanceof Error && error.message
        ? `Clerk refused the change: ${error.message}`
        : "Clerk refused the change; your number was not saved.",
      "clerk",
      false,
      { cause: error },
    );
  }

  try {
    await db.user.update({ data: { phone }, where: { id: user.id } });
  } catch (error) {
    await updateIdentity({
      clerkUserId: user.clerkId,
      phone: user.phone,
    }).catch((compensationError) => {
      console.error(
        "[phone] Could not restore Clerk after the local phone write failed",
        compensationError,
      );
    });
    if (isUniqueViolation(error)) {
      throw new DomainValidationError(
        "That phone number already belongs to another team member.",
        "phone",
      );
    }
    throw error;
  }

  return {
    changed: true,
    clerkUserId: user.clerkId,
    phone,
    verified: isPhoneVerified({ phone, verifiedPhone: user.verifiedPhone }),
  };
}

/**
 * Text a verification code to the caller's phone.
 *
 * The row is claimed before the text goes: the write is conditional on the
 * `sentAt` that was read, so a double-click (or a second tab) gets the
 * cooldown refusal instead of a second text. If the carrier says definitely
 * not sent, the claim is undone so the person can try again straight away; if
 * it cannot say, the code stays live, because it may yet arrive.
 */
export async function sendPhoneVerificationCode(
  principal: DomainPrincipal,
  db: DomainDb,
  sender: PhoneCodeSender,
  options: { now?: Date; generateCode?: () => string } = {},
): Promise<PendingPhoneCode> {
  const user = await requireOwnUser(principal, db);
  if (isPhoneVerified(user)) {
    throw new DomainValidationError(
      "This number is already verified.",
      "phone",
    );
  }
  if (!sender.sms || !sender.from) {
    throw new DomainSideEffectError(
      "Text messages aren't switched on for this site, so no code could be sent.",
      "sms",
      false,
    );
  }

  const now = options.now ?? new Date();
  const existing = await db.phoneVerification.findUnique({
    where: { userId: user.id },
  });

  // On the account, not the number: changing the number between sends must
  // not skip the wait.
  if (existing) {
    const waitMs =
      existing.sentAt.getTime() + PHONE_CODE_RESEND_MS - now.getTime();
    if (waitMs > 0) {
      throw new DomainValidationError(
        `A code was just sent. Wait ${plural(Math.ceil(waitMs / 1000), "second", "seconds")} before asking for another.`,
        "code",
      );
    }
  }

  const windowOpen =
    existing !== null
    && now.getTime() - existing.windowStartedAt.getTime() < HOUR_MS;
  if (windowOpen && existing.windowSends >= PHONE_CODE_SENDS_PER_HOUR) {
    const minutes = Math.ceil(
      (existing.windowStartedAt.getTime() + HOUR_MS - now.getTime()) / 60_000,
    );
    throw new DomainValidationError(
      `That's ${PHONE_CODE_SENDS_PER_HOUR} codes in the last hour. Try again in ${plural(minutes, "minute", "minutes")}.`,
      "code",
    );
  }

  const code = (options.generateCode ?? randomCode)();
  const salt = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + PHONE_CODE_TTL_MS);
  const claim = {
    attempts: 0,
    codeHash: hashCode(salt, code),
    expiresAt,
    phone: user.phone,
    salt,
    sentAt: now,
    windowSends: windowOpen ? existing.windowSends + 1 : 1,
    windowStartedAt: windowOpen ? existing.windowStartedAt : now,
  };
  const raced = new DomainValidationError(
    "A code was just sent. Wait a moment before asking for another.",
    "code",
  );

  if (existing) {
    const claimed = await db.phoneVerification.updateMany({
      data: claim,
      where: { sentAt: existing.sentAt, userId: user.id },
    });
    if (claimed.count !== 1) throw raced;
  } else {
    try {
      await db.phoneVerification.create({
        data: { ...claim, userId: user.id },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw raced;
      throw error;
    }
  }

  // The row exactly as this call claimed it. A guess counted against it since
  // then means it is no longer ours to put back.
  const claimedRow = {
    attempts: claim.attempts,
    codeHash: claim.codeHash,
    sentAt: now,
    userId: user.id,
  };

  try {
    await sender.sms.sendSms({
      body: `${code} is your Royal Constructions verification code. It expires in ${PHONE_CODE_TTL_MS / 60_000} minutes.`,
      from: sender.from,
      to: user.phone,
    });
  } catch (error) {
    if (commsDefinitelyNotSent(error)) {
      // Nothing reached the phone. Put the row back as it was, so the person
      // is not told to wait for a code that is not coming.
      if (existing) {
        await db.phoneVerification.updateMany({
          data: {
            attempts: existing.attempts,
            codeHash: existing.codeHash,
            expiresAt: existing.expiresAt,
            phone: existing.phone,
            salt: existing.salt,
            sentAt: existing.sentAt,
            windowSends: existing.windowSends,
            windowStartedAt: existing.windowStartedAt,
          },
          where: claimedRow,
        });
      } else {
        await db.phoneVerification.deleteMany({ where: claimedRow });
      }
      throw new DomainSideEffectError(
        "The code couldn't be texted to this number. Check the number is a mobile and try again.",
        "sms",
        true,
        { cause: error },
      );
    }
    throw new DomainSideEffectError(
      "The text may not have gone through. If no code arrives within a minute, ask for another.",
      "sms",
      false,
      { cause: error },
    );
  }

  return {
    expiresAt,
    resendAvailableAt: new Date(now.getTime() + PHONE_CODE_RESEND_MS),
    sentTo: user.phone,
  };
}

/**
 * Check the code the caller typed and, if it is right, mark their phone
 * verified.
 *
 * Every write is conditional on the challenge as it was read — same code,
 * same count — so two guesses sent together cannot share one try. A wrong
 * guess is counted; a right one consumes the challenge and marks the phone in
 * one transaction, conditional on the number still being the one the code
 * went to.
 */
export async function confirmPhoneVerification(
  principal: DomainPrincipal,
  input: { readonly code: string },
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<ConfirmPhoneResult> {
  const user = await requireOwnUser(principal, db);
  const code = input.code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`).test(code)) {
    throw new DomainValidationError(
      `Enter the ${PHONE_CODE_LENGTH}-digit code from the text.`,
      "code",
    );
  }

  if (isPhoneVerified(user)) {
    return {
      alreadyVerified: true,
      phone: user.phone,
      verifiedAt: user.phoneVerifiedAt ?? now,
    };
  }

  const pending = await db.phoneVerification.findUnique({
    where: { userId: user.id },
  });
  if (!pending || pending.phone !== user.phone) {
    throw new DomainValidationError(
      "There's no code waiting for this number. Ask for a new one.",
      "code",
    );
  }
  if (pending.expiresAt <= now) {
    throw new DomainValidationError(
      "That code has expired. Ask for a new one.",
      "code",
    );
  }
  if (pending.attempts >= PHONE_CODE_MAX_ATTEMPTS) {
    throw new DomainValidationError(
      "Too many wrong tries for that code. Ask for a new one.",
      "code",
    );
  }

  // The challenge exactly as it was read: the same code, with no guess
  // counted against it since. A write conditional on this is one try.
  const challenge = {
    attempts: pending.attempts,
    codeHash: pending.codeHash,
    sentAt: pending.sentAt,
    userId: user.id,
  };
  const stale = new DomainStaleVersionError(
    "That code was just checked or replaced. Try again.",
  );

  if (!codeMatches(pending, code)) {
    // A wrong guess is counted and stays counted.
    const counted = await db.phoneVerification.updateMany({
      data: { attempts: { increment: 1 } },
      where: challenge,
    });
    if (counted.count !== 1) throw stale;
    const left = PHONE_CODE_MAX_ATTEMPTS - (pending.attempts + 1);
    throw new DomainValidationError(
      left > 0
        ? `That code isn't right. ${plural(left, "try", "tries")} left.`
        : "That code isn't right, and that was the last try. Ask for a new one.",
      "code",
    );
  }

  // A right guess consumes the challenge and marks the phone in one commit,
  // or neither. Consuming expires the code and blanks its hash rather than
  // deleting the row: `sentAt` and the hourly window are the account's send
  // history, and changing the number afterwards must not reset them.
  await db.$transaction(async (tx) => {
    const consumed = await tx.phoneVerification.updateMany({
      data: { codeHash: "", expiresAt: now },
      where: challenge,
    });
    if (consumed.count !== 1) throw stale;
    const marked = await tx.user.updateMany({
      data: { phoneVerifiedAt: now, verifiedPhone: pending.phone },
      where: { id: user.id, phone: pending.phone },
    });
    if (marked.count !== 1) {
      throw new DomainValidationError(
        "Your phone number changed while the code was on its way. Ask for a new one.",
        "code",
      );
    }
  });

  return { alreadyVerified: false, phone: pending.phone, verifiedAt: now };
}
