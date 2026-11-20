import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { Role } from "@prisma/client";
import { describe, test } from "vitest";

import { phoneCodeSender } from "@/lib/comms/phone-code-sender";
import type { CommsRuntime } from "@/lib/comms/factory";
import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  confirmPhoneVerification,
  isPhoneVerified,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_RESEND_MS,
  PHONE_CODE_TTL_MS,
  readOwnPhone,
  sendPhoneVerificationCode,
  updateOwnPhone,
  type PhoneCodeSender,
} from "@/lib/domain/identity/phone-verification";
import { CommsError, type SmsPort } from "@/lib/domain/ports/comms";
import { systemPrincipal } from "@/lib/domain/principal";
import { recordingDb } from "../architecture/domain-harness";

const NOW = new Date("2026-11-20T01:00:00.000Z");
const ME = { kind: "user", role: Role.ADMIN, userId: "user_me" } as const;
const USER = {
  clerkId: "clerk_me",
  email: "me@example.com",
  id: "user_me",
  name: "Me",
  phone: "+61412345678",
  phoneVerifiedAt: null,
  role: Role.ADMIN,
  verifiedPhone: null,
};

function sender(failWith?: Error) {
  const sent: Parameters<SmsPort["sendSms"]>[0][] = [];
  const port: PhoneCodeSender = {
    from: "+61290001234",
    sms: {
      provider: "telnyx",
      sendSms: async (message) => {
        sent.push(message);
        if (failWith) throw failWith;
        return { providerMessageId: "msg_1" };
      },
    },
  };
  return { port, sent };
}

/** A stored code for USER, made by the real send so the hash is real. */
async function storedCode(code = "123456") {
  const recorder = recordingDb({
    "phoneVerification.findUnique": null,
    "user.findUnique": USER,
  });
  await sendPhoneVerificationCode(ME, recorder.db, sender().port, {
    generateCode: () => code,
    now: NOW,
  });
  const created = recorder.calls.find(
    (call) => call.operation === "phoneVerification.create",
  )?.args as { data: Record<string, unknown> };
  return created.data;
}

describe("whether a phone is verified", () => {
  test("only while the proved number is the number on the account", () => {
    assert.equal(
      isPhoneVerified({ phone: "+61412345678", verifiedPhone: null }),
      false,
    );
    assert.equal(
      isPhoneVerified({ phone: "+61412345678", verifiedPhone: "+61412345678" }),
      true,
    );
    // The team screen changed the number: the old proof no longer counts.
    assert.equal(
      isPhoneVerified({ phone: "+61499999999", verifiedPhone: "+61412345678" }),
      false,
    );
  });
});

describe("texting a verification code", () => {
  test("claims the code, then texts it from the Telnyx number to the account's phone", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": null,
      "user.findUnique": USER,
    });
    const { port, sent } = sender();
    const realSend = port.sms!.sendSms;
    let claimedBeforeSend = false;
    const orderedPort: PhoneCodeSender = {
      ...port,
      sms: {
        ...port.sms!,
        // Checked at the moment the text goes: the claim is already written.
        sendSms: async (message) => {
          claimedBeforeSend = recorder
            .operations()
            .includes("phoneVerification.create");
          return realSend(message);
        },
      },
    };
    const pending = await sendPhoneVerificationCode(
      ME,
      recorder.db,
      orderedPort,
      { generateCode: () => "042817", now: NOW },
    );

    assert.equal(claimedBeforeSend, true);
    assert.deepEqual(recorder.operations(), [
      "user.findUnique",
      "phoneVerification.findUnique",
      "phoneVerification.create",
    ]);
    const data = (recorder.calls[2]?.args as { data: Record<string, unknown> })
      .data;
    assert.deepEqual(Object.keys(data).sort(), [
      "attempts",
      "codeHash",
      "expiresAt",
      "phone",
      "salt",
      "sentAt",
      "userId",
      "windowSends",
      "windowStartedAt",
    ]);
    assert.equal(data.phone, USER.phone);
    // A salted hash of the code, never the code itself.
    assert.equal(
      data.codeHash,
      createHash("sha256")
        .update(`${String(data.salt)}:042817`)
        .digest("hex"),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.from, "+61290001234");
    assert.equal(sent[0]?.to, USER.phone);
    assert.match(sent[0]?.body ?? "", /042817/);
    assert.equal(
      pending.resendAvailableAt.getTime(),
      NOW.getTime() + PHONE_CODE_RESEND_MS,
    );
    assert.equal(
      pending.expiresAt.getTime(),
      NOW.getTime() + PHONE_CODE_TTL_MS,
    );
  });

  test("a second press within 30 seconds is refused and texts nobody", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": {
        ...(await storedCode()),
        sentAt: new Date(NOW.getTime() - 10_000),
      },
      "user.findUnique": USER,
    });
    const { port, sent } = sender();
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      /Wait 20 seconds/,
    );
    assert.deepEqual(recorder.writes(), []);
    assert.equal(sent.length, 0);
  });

  test("changing the number does not skip the 30-second wait", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": {
        ...(await storedCode()),
        phone: "+61499999999",
        sentAt: new Date(NOW.getTime() - 10_000),
      },
      "user.findUnique": USER,
    });
    const { port, sent } = sender();
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      /Wait 20 seconds/,
    );
    assert.equal(sent.length, 0);
  });

  test("a double-click that loses the claim gets the cooldown, not a second text", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": {
        ...(await storedCode()),
        sentAt: new Date(NOW.getTime() - 60_000),
      },
      "phoneVerification.updateMany": { count: 0 },
      "user.findUnique": USER,
    });
    const { port, sent } = sender();
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      DomainValidationError,
    );
    assert.equal(sent.length, 0);
  });

  test("five codes an hour, then a refusal saying how long to wait", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": {
        ...(await storedCode()),
        sentAt: new Date(NOW.getTime() - 5 * 60_000),
        windowSends: 5,
        windowStartedAt: new Date(NOW.getTime() - 20 * 60_000),
      },
      "user.findUnique": USER,
    });
    const { port, sent } = sender();
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      /Try again in 40 minutes/,
    );
    assert.equal(sent.length, 0);
  });

  test("a carrier refusal undoes the claim, so the person can try again now", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": null,
      "user.findUnique": USER,
    });
    const { port } = sender(new CommsError("Invalid number", "rejected"));
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      (error: unknown) =>
        error instanceof DomainSideEffectError && error.retryable,
    );
    assert.deepEqual(recorder.operations().slice(-1), [
      "phoneVerification.deleteMany",
    ]);
    // Only the row as this call claimed it: a guess counted since leaves it.
    const created = recorder.calls.find(
      (call) => call.operation === "phoneVerification.create",
    )?.args as { data: Record<string, unknown> };
    const undone = recorder.calls.at(-1)?.args as { where: unknown };
    assert.deepEqual(undone.where, {
      attempts: 0,
      codeHash: created.data.codeHash,
      sentAt: NOW,
      userId: USER.id,
    });
  });

  test("an uncertain send keeps the code live: it may still arrive", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": null,
      "user.findUnique": USER,
    });
    const { port } = sender(new CommsError("Timed out", "uncertain"));
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      (error: unknown) =>
        error instanceof DomainSideEffectError && !error.retryable,
    );
    assert.ok(!recorder.operations().includes("phoneVerification.deleteMany"));
  });

  test("with texting switched off it says so and writes nothing", async () => {
    const recorder = recordingDb({ "user.findUnique": USER });
    await assert.rejects(
      sendPhoneVerificationCode(
        ME,
        recorder.db,
        { from: null, sms: null },
        { now: NOW },
      ),
      DomainSideEffectError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("an already verified number is not texted again", async () => {
    const recorder = recordingDb({
      "user.findUnique": { ...USER, verifiedPhone: USER.phone },
    });
    const { port, sent } = sender();
    await assert.rejects(
      sendPhoneVerificationCode(ME, recorder.db, port, { now: NOW }),
      /already verified/,
    );
    assert.equal(sent.length, 0);
  });

  test("a cron or an anonymous caller has no phone of its own", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      sendPhoneVerificationCode(
        systemPrincipal("test"),
        recorder.db,
        sender().port,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.calls, []);
  });
});

describe("typing the code back", () => {
  test("the right code marks the number verified and consumes the code", async () => {
    const stored = await storedCode("123456");
    const recorder = recordingDb({
      "phoneVerification.findUnique": stored,
      "user.findUnique": USER,
    });
    const result = await confirmPhoneVerification(
      ME,
      { code: "123 456" },
      recorder.transactionalDb,
      new Date(NOW.getTime() + 60_000),
    );
    assert.equal(result.alreadyVerified, false);
    assert.equal(result.phone, USER.phone);
    const marked = recorder.calls.find(
      (call) => call.operation === "user.updateMany",
    )?.args as { where: unknown; data: { verifiedPhone: string } };
    // Conditional on the number still being the one the code went to.
    assert.deepEqual(marked.where, { id: USER.id, phone: USER.phone });
    assert.equal(marked.data.verifiedPhone, USER.phone);
    // Consumed, not deleted: the send history stays with the account, and a
    // right guess is not counted as a try.
    assert.ok(!recorder.operations().includes("phoneVerification.deleteMany"));
    const consumed = recorder.calls.filter(
      (call) => call.operation === "phoneVerification.updateMany",
    );
    assert.equal(consumed.length, 1);
    const consume = consumed[0]?.args as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    assert.deepEqual(consume.where, {
      attempts: stored.attempts,
      codeHash: stored.codeHash,
      sentAt: stored.sentAt,
      userId: USER.id,
    });
    assert.deepEqual(Object.keys(consume.data).sort(), [
      "codeHash",
      "expiresAt",
    ]);
  });

  test("a code replaced or checked since it was read is stale, and nothing is marked", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": await storedCode("123456"),
      "phoneVerification.updateMany": { count: 0 },
      "user.findUnique": USER,
    });
    await assert.rejects(
      confirmPhoneVerification(
        ME,
        { code: "123456" },
        recorder.transactionalDb,
        NOW,
      ),
      /just checked or replaced/,
    );
    assert.ok(!recorder.operations().includes("user.updateMany"));
  });

  test("a wrong code uses up one try and says how many are left", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": await storedCode("123456"),
      "user.findUnique": USER,
    });
    await assert.rejects(
      confirmPhoneVerification(
        ME,
        { code: "654321" },
        recorder.transactionalDb,
        NOW,
      ),
      new RegExp(`${PHONE_CODE_MAX_ATTEMPTS - 1} tries left`),
    );
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["phoneVerification.updateMany"],
    );
  });

  test("an expired code, or one out of tries, is refused before it is compared", async () => {
    const stored = await storedCode("123456");
    for (const pending of [
      { ...stored, expiresAt: new Date(NOW.getTime() - 1) },
      { ...stored, attempts: PHONE_CODE_MAX_ATTEMPTS },
    ]) {
      const recorder = recordingDb({
        "phoneVerification.findUnique": pending,
        "user.findUnique": USER,
      });
      await assert.rejects(
        confirmPhoneVerification(
          ME,
          { code: "123456" },
          recorder.transactionalDb,
          NOW,
        ),
        /Ask for a new one/,
      );
      assert.deepEqual(recorder.writes(), []);
    }
  });

  test("a code sent to a number the account no longer has proves nothing", async () => {
    const recorder = recordingDb({
      "phoneVerification.findUnique": await storedCode("123456"),
      "user.findUnique": { ...USER, phone: "+61499999999" },
    });
    await assert.rejects(
      confirmPhoneVerification(
        ME,
        { code: "123456" },
        recorder.transactionalDb,
        NOW,
      ),
      /no code waiting/,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a second press after it worked answers verified, without writing", async () => {
    const recorder = recordingDb({
      "user.findUnique": {
        ...USER,
        phoneVerifiedAt: NOW,
        verifiedPhone: USER.phone,
      },
    });
    const result = await confirmPhoneVerification(
      ME,
      { code: "123456" },
      recorder.transactionalDb,
      NOW,
    );
    assert.equal(result.alreadyVerified, true);
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("changing your own number", () => {
  test("Clerk's metadata copy is written before the record, in E.164", async () => {
    const recorder = recordingDb({
      "user.findFirst": null,
      "user.findUnique": USER,
    });
    const written: unknown[] = [];
    const result = await updateOwnPhone(
      ME,
      { phone: "0499 111 222" },
      recorder.db,
      async (input) => {
        written.push({ ...input, writesSoFar: recorder.writes().length });
      },
    );
    assert.deepEqual(result, {
      changed: true,
      clerkUserId: "clerk_me",
      phone: "+61499111222",
      verified: false,
    });
    assert.deepEqual(written, [
      { clerkUserId: "clerk_me", phone: "+61499111222", writesSoFar: 0 },
    ]);
    assert.deepEqual(
      recorder.writes().map((call) => call.args),
      [{ data: { phone: "+61499111222" }, where: { id: USER.id } }],
    );
  });

  test("someone else's number is refused before Clerk hears of it", async () => {
    const recorder = recordingDb({
      "user.findFirst": { id: "user_other" },
      "user.findUnique": USER,
    });
    let called = false;
    await assert.rejects(
      updateOwnPhone(ME, { phone: "0499 111 222" }, recorder.db, async () => {
        called = true;
      }),
      /already belongs/,
    );
    assert.equal(called, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("saving the same number writes nothing", async () => {
    const recorder = recordingDb({
      "user.findFirst": null,
      "user.findUnique": USER,
    });
    const result = await updateOwnPhone(
      ME,
      { phone: "0412 345 678" },
      recorder.db,
      async () => assert.fail("Clerk should not be written"),
    );
    assert.equal(result.changed, false);
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("reading your own phone", () => {
  test("a live code for this number is reported; a verified number has none", async () => {
    const stored = await storedCode();
    const recorder = recordingDb({
      "phoneVerification.findUnique": stored,
      "user.findUnique": USER,
    });
    const status = await readOwnPhone(ME, recorder.db, NOW);
    assert.equal(status.verified, false);
    assert.equal(status.pendingCode?.sentTo, USER.phone);

    const verified = recordingDb({
      "user.findUnique": {
        ...USER,
        phoneVerifiedAt: NOW,
        verifiedPhone: USER.phone,
      },
    });
    const done = await readOwnPhone(ME, verified.db, NOW);
    assert.equal(done.verified, true);
    assert.equal(done.pendingCode, null);
  });
});

describe("where the code is texted from", () => {
  const telnyxSms = sender().port.sms;
  const twilioSms = sender().port.sms;

  function runtime(numbers: { e164: string; provider: "telnyx" | "twilio" }[]) {
    return {
      adapterFor: (provider: "telnyx" | "twilio") => ({
        sms: provider === "telnyx" ? telnyxSms : twilioSms,
      }),
      config: { numbers: numbers.map((n) => ({ ...n, label: "Office" })) },
    } as unknown as CommsRuntime;
  }

  test("the Telnyx number, even when Twilio's is listed first", () => {
    const chosen = phoneCodeSender(
      runtime([
        { e164: "+61280001234", provider: "twilio" },
        { e164: "+61290001234", provider: "telnyx" },
      ]),
    );
    assert.equal(chosen.from, "+61290001234");
    // Telnyx's SMS port with Telnyx's number, not whichever adapter is first.
    assert.equal(chosen.sms, telnyxSms);
  });

  test("no Telnyx number, no sender", () => {
    assert.deepEqual(
      phoneCodeSender(runtime([{ e164: "+61280001234", provider: "twilio" }])),
      { from: null, sms: null },
    );
  });
});
