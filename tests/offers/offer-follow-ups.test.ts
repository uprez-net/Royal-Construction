import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  assessOfferFollowUp,
  sendOfferFollowUp,
  type OfferFollowUpSource,
} from "@/lib/domain/offers/follow-ups";
import { offerFollowUpDraft } from "@/lib/offer/follow-up-template";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";

// Issue #449: an unanswered offer is due a follow-up a day after the last
// contact, and the email only goes when an administrator sends the draft.

const SENT = new Date("2026-11-10T00:00:00Z");
const HOUR = 60 * 60 * 1000;

function source(
  overrides: Partial<OfferFollowUpSource> = {},
): OfferFollowUpSource {
  return {
    offerStatus: "SENT",
    sentAt: SENT,
    awaitingSince: SENT,
    followUpTimes: [],
    lastReplyAt: null,
    ...overrides,
  };
}

describe("when an offer is due a follow-up", () => {
  test("not before 24 hours", () => {
    const now = new Date(SENT.getTime() + 23 * HOUR);
    assert.equal(assessOfferFollowUp(source(), now), null);
  });

  test("at 24 hours with no reply", () => {
    const now = new Date(SENT.getTime() + 24 * HOUR);
    const assessed = assessOfferFollowUp(source(), now);
    assert.equal(assessed?.state, "DUE");
    assert.equal(assessed?.followUpCount, 0);
  });

  test("an offer out for signature is waiting on the client too", () => {
    const now = new Date(SENT.getTime() + 30 * HOUR);
    assert.equal(
      assessOfferFollowUp(source({ offerStatus: "OFFER_SENT" }), now)?.state,
      "DUE",
    );
  });

  test("never for an offer that is accepted, rejected, declined or superseded", () => {
    const now = new Date(SENT.getTime() + 72 * HOUR);
    for (const offerStatus of [
      "PENDING",
      "AGREED",
      "OFFER_SIGNED",
      "REJECTED",
      "OFFER_DECLINED",
      "SUPERSEDED",
      "TENDER_SENT",
    ] as const) {
      assert.equal(
        assessOfferFollowUp(source({ offerStatus }), now),
        null,
        offerStatus,
      );
    }
  });

  test("a client reply since the last contact is a response", () => {
    const now = new Date(SENT.getTime() + 72 * HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({ lastReplyAt: new Date(SENT.getTime() + 5 * HOUR) }),
        now,
      ),
      null,
    );
  });

  test("a follow-up restarts the clock rather than raising a second alert", () => {
    const followedUp = new Date(SENT.getTime() + 30 * HOUR);
    const soon = new Date(followedUp.getTime() + 2 * HOUR);
    const assessed = assessOfferFollowUp(
      source({ followUpTimes: [followedUp] }),
      soon,
    );
    assert.equal(assessed?.state, "FOLLOWED_UP");
    assert.equal(assessed?.followUpCount, 1);
    assert.equal(
      assessed?.nextDueAt,
      new Date(followedUp.getTime() + 24 * HOUR).toISOString(),
    );

    const nextDay = new Date(followedUp.getTime() + 25 * HOUR);
    assert.equal(
      assessOfferFollowUp(source({ followUpTimes: [followedUp] }), nextDay)
        ?.state,
      "DUE",
    );
  });

  test("a reply to a follow-up closes it; a reply before it does not", () => {
    const followedUp = new Date(SENT.getTime() + 30 * HOUR);
    const later = new Date(followedUp.getTime() + 48 * HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({
          followUpTimes: [followedUp],
          lastReplyAt: new Date(followedUp.getTime() + HOUR),
        }),
        later,
      ),
      null,
    );
  });

  test("days pending is counted from the original send", () => {
    const now = new Date(SENT.getTime() + 5 * 24 * HOUR);
    assert.equal(assessOfferFollowUp(source(), now)?.daysPending, 5);
  });
});

describe("the follow-up draft", () => {
  test("names the client, the site and the day it was sent", () => {
    const draft = offerFollowUpDraft({
      clientName: "Sam Smith",
      projectAddress: "1 Example St, Parramatta",
      sentAt: "2026-11-10T00:00:00Z",
      reference: "RC-Q-2026-014",
      senderName: "Alex",
    });
    assert.match(draft.subject, /1 Example St, Parramatta/);
    assert.match(draft.body, /^Hi Sam,/);
    assert.match(draft.body, /Tue 10 Nov 2026/);
    assert.match(draft.body, /RC-Q-2026-014/);
    assert.match(draft.body, /review the offer/);
    assert.match(draft.body, /Alex\nRoyal Constructions$/);
  });
});

describe("sending a follow-up", () => {
  const input = {
    offerId: "offer-1",
    to: "sam@example.com",
    subject: "Following up",
    body: "Hi Sam",
    html: "<p>Hi Sam</p>",
    attemptKey: "attempt-1",
  };

  function scripted(offerStatus = "SENT") {
    return recordingDb({
      "offer.findUnique": {
        isActive: true,
        leadId: 7,
        offerStatus,
        lead: { email: "Sam@Example.com", secondaryEmail: null },
      },
      "lead.findUnique": { id: 7, assignedId: null },
      "outboxEvent.upsert": {
        id: "evt-1",
        key: "k",
        status: "PENDING",
        result: null,
      },
      "outboxEvent.findUnique": {
        id: "evt-1",
        key: "k",
        status: "PENDING",
        attempts: 0,
        kind: "OFFER_FOLLOW_UP_SEND",
        payload: {},
      },
      "offerFollowUp.create": {
        id: "fu-1",
        sentAt: new Date("2026-11-13T00:00:00Z"),
      },
    });
  }

  test("sends once and records it against the offer", async () => {
    const recorder = scripted();
    const sent: unknown[] = [];
    const result = await sendOfferFollowUp(
      adminPrincipal(),
      input,
      recorder.db,
      {
        sendMail: async (message) => {
          sent.push(message);
        },
      },
    );
    assert.deepEqual(sent, [
      { to: "sam@example.com", subject: "Following up", body: "<p>Hi Sam</p>" },
    ]);
    assert.equal(result.replayed, false);
    assert.equal(result.followUpId, "fu-1");
    const record = recorder
      .writes()
      .find((call) => call.operation === "offerFollowUp.create");
    assert.ok(record, "the follow-up is recorded");
    assert.equal(
      (record.args as { data: { attemptKey: string } }).data.attemptKey,
      "offer-follow-up:offer-1:attempt-1",
    );
  });

  test("refuses a closed offer before anything is sent or written", async () => {
    const recorder = scripted("OFFER_SIGNED");
    let sent = 0;
    await assert.rejects(
      sendOfferFollowUp(adminPrincipal(), input, recorder.db, {
        sendMail: async () => {
          sent += 1;
        },
      }),
      /no longer waiting on the client/,
    );
    assert.equal(sent, 0);
    assert.deepEqual(recorder.writes(), []);
  });

  test("refuses an address that is not on the lead", async () => {
    const recorder = scripted();
    await assert.rejects(
      sendOfferFollowUp(
        adminPrincipal(),
        { ...input, to: "someone@else.com" },
        recorder.db,
        { sendMail: async () => {} },
      ),
      /not on this lead/,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("refuses a caller who is not staff, and a send with no attempt key", async () => {
    const recorder = scripted();
    await assert.rejects(
      sendOfferFollowUp(customerPrincipal(), input, recorder.db, {
        sendMail: async () => {},
      }),
      /internal staff/,
    );
    await assert.rejects(
      sendOfferFollowUp(
        adminPrincipal(),
        { ...input, attemptKey: "  " },
        recorder.db,
        { sendMail: async () => {} },
      ),
      /attempt key/,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a replayed attempt says so and sends nothing", async () => {
    const recorder = recordingDb({
      "offer.findUnique": {
        isActive: true,
        leadId: 7,
        offerStatus: "SENT",
        lead: { email: "sam@example.com", secondaryEmail: null },
      },
      "lead.findUnique": { id: 7, assignedId: null },
      "outboxEvent.upsert": {
        id: "evt-1",
        key: "k",
        status: "SUCCEEDED",
        result: { followUpId: "fu-1", sentAt: "2026-11-13T00:00:00.000Z" },
      },
    });
    let sent = 0;
    const result = await sendOfferFollowUp(
      adminPrincipal(),
      input,
      recorder.db,
      {
        sendMail: async () => {
          sent += 1;
        },
      },
    );
    assert.equal(sent, 0);
    assert.equal(result.replayed, true);
  });
});
