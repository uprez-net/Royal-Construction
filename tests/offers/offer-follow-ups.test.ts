import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  assessOfferFollowUp,
  markOfferFollowUpDone,
  sendOfferFollowUp,
  withReplyToken,
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
    markedDoneTimes: [],
    lastSentAt: null,
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

  test("a re-sent proposal is contact too, and restarts the clock", () => {
    const resent = new Date(SENT.getTime() + 40 * HOUR);
    const soon = new Date(resent.getTime() + 2 * HOUR);
    assert.equal(
      assessOfferFollowUp(source({ lastSentAt: resent }), soon),
      null,
    );
    // A reply to the first send, before the re-send, is not an answer to it.
    const later = new Date(resent.getTime() + 25 * HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({
          lastSentAt: resent,
          lastReplyAt: new Date(SENT.getTime() + HOUR),
        }),
        later,
      )?.state,
      "DUE",
    );
  });

  test("marking it done takes it off the list for a day, then it is due again", () => {
    const markedDone = new Date(SENT.getTime() + 30 * HOUR);
    const soon = new Date(markedDone.getTime() + 2 * HOUR);
    assert.equal(
      assessOfferFollowUp(source({ markedDoneTimes: [markedDone] }), soon),
      null,
    );

    const nextDay = new Date(markedDone.getTime() + 25 * HOUR);
    const assessed = assessOfferFollowUp(
      source({ markedDoneTimes: [markedDone] }),
      nextDay,
    );
    assert.equal(assessed?.state, "DUE");
    // A mark is not an email: the count is of follow-ups actually sent.
    assert.equal(assessed?.followUpCount, 0);
    assert.equal(
      assessed?.nextDueAt,
      new Date(markedDone.getTime() + 24 * HOUR).toISOString(),
    );
  });

  test("marking done after an emailed follow-up hides it too", () => {
    const followedUp = new Date(SENT.getTime() + 30 * HOUR);
    const markedDone = new Date(followedUp.getTime() + HOUR);
    const soon = new Date(markedDone.getTime() + HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({ followUpTimes: [followedUp], markedDoneTimes: [markedDone] }),
        soon,
      ),
      null,
    );
  });

  test("an email sent after the mark shows as followed up again", () => {
    const markedDone = new Date(SENT.getTime() + 30 * HOUR);
    const followedUp = new Date(markedDone.getTime() + HOUR);
    const soon = new Date(followedUp.getTime() + HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({ followUpTimes: [followedUp], markedDoneTimes: [markedDone] }),
        soon,
      )?.state,
      "FOLLOWED_UP",
    );
  });

  test("a client reply after the mark closes it", () => {
    const markedDone = new Date(SENT.getTime() + 30 * HOUR);
    const later = new Date(markedDone.getTime() + 48 * HOUR);
    assert.equal(
      assessOfferFollowUp(
        source({
          markedDoneTimes: [markedDone],
          lastReplyAt: new Date(markedDone.getTime() + HOUR),
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

describe("the reply token on a follow-up's subject", () => {
  const token = "RCOFR-0123456789AB";

  test("is added so the client's reply is matched to the offer's send", () => {
    assert.equal(
      withReplyToken("Following up", token),
      "Following up [RCOFR-0123456789AB]",
    );
  });

  test("is left alone when the administrator kept it", () => {
    const subject = `Re: your offer [${token}] — any questions?`;
    assert.equal(withReplyToken(subject, token), subject);
  });

  test("replaces another send's token rather than carrying two", () => {
    assert.equal(
      withReplyToken("Following up [RCOFR-FFFFFFFFFFFF]", token),
      "Following up [RCOFR-0123456789AB]",
    );
  });

  test("leaves the subject as written when there is no send to match", () => {
    assert.equal(withReplyToken("Following up", null), "Following up");
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

  const proposalSend = {
    sentAt: SENT,
    lastReplyAt: null as Date | null,
    recipientEmail: "Sam@Example.com",
    trackedLinkToken: "RCOFR-0123456789AB",
  };

  /** The offer row the command reads: authorizeOffer's fields and the rule's. */
  function offerRow(overrides: Record<string, unknown> = {}) {
    return {
      isActive: true,
      leadId: 7,
      id: "offer-1",
      baseReference: "RC-Q-2026-014",
      revisionNumber: 1,
      offerStatus: "SENT",
      sentAt: SENT,
      updatedAt: SENT,
      lead: {
        name: "Sam Smith",
        email: "Sam@Example.com",
        secondaryEmail: null,
        location: "1 Example St",
      },
      statusEvents: [],
      followUps: [],
      followUpsDone: [],
      documentSends: [proposalSend],
      ...overrides,
    };
  }

  function scripted(overrides: Record<string, unknown> = {}) {
    return recordingDb({
      "offer.findUnique": offerRow(overrides),
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

  test("sends once, with the send's reply token, and records it against the offer", async () => {
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
    // The address the proposal went to, and its token, so recordOfferReply
    // matches the client's reply to this follow-up like a reply to the offer.
    assert.deepEqual(sent, [
      {
        to: "sam@example.com",
        subject: "Following up [RCOFR-0123456789AB]",
        body: "<p>Hi Sam</p>",
      },
    ]);
    assert.equal(result.replayed, false);
    assert.equal(result.followUpId, "fu-1");
    const record = recorder
      .writes()
      .find((call) => call.operation === "offerFollowUp.create");
    assert.ok(record, "the follow-up is recorded");
    const data = (
      record.args as { data: { attemptKey: string; subject: string } }
    ).data;
    assert.equal(data.attemptKey, "offer-follow-up:offer-1:attempt-1");
    assert.equal(data.subject, "Following up [RCOFR-0123456789AB]");
  });

  test("an address the offer was never emailed to gets no token", async () => {
    const recorder = scripted({
      lead: {
        name: "Sam Smith",
        email: "Sam@Example.com",
        secondaryEmail: "partner@example.com",
        location: "1 Example St",
      },
    });
    const sent: { subject: string }[] = [];
    await sendOfferFollowUp(
      adminPrincipal(),
      { ...input, to: "partner@example.com" },
      recorder.db,
      {
        sendMail: async (message) => {
          sent.push(message);
        },
      },
    );
    assert.equal(sent[0]?.subject, "Following up");
  });

  test("refuses a closed offer before anything is sent or written", async () => {
    const recorder = scripted({ offerStatus: "OFFER_SIGNED" });
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

  test("refuses when the client replied while the draft was open", async () => {
    const recorder = scripted({
      documentSends: [
        { ...proposalSend, lastReplyAt: new Date(SENT.getTime() + 30 * HOUR) },
      ],
    });
    let sent = 0;
    await assert.rejects(
      sendOfferFollowUp(adminPrincipal(), input, recorder.db, {
        sendMail: async () => {
          sent += 1;
        },
      }),
      /client has replied/,
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
      "offer.findUnique": offerRow(),
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

  describe("marking a follow-up done", () => {
    const DONE_AT = new Date("2026-11-13T00:00:00Z");

    function markScripted(overrides: Record<string, unknown> = {}) {
      return recordingDb({
        "offer.findUnique": offerRow(overrides),
        "lead.findUnique": { id: 7, assignedId: null },
        "offerFollowUpDone.create": { doneAt: DONE_AT },
      });
    }

    test("records the mark, sends nothing, and says when it comes back", async () => {
      const recorder = markScripted();
      const result = await markOfferFollowUpDone(
        adminPrincipal(),
        { offerId: "offer-1" },
        recorder.db,
      );
      assert.equal(result.doneAt, DONE_AT.toISOString());
      assert.equal(
        result.nextDueAt,
        new Date(DONE_AT.getTime() + 24 * HOUR).toISOString(),
      );
      const writes = recorder.writes();
      assert.deepEqual(
        writes.map((call) => call.operation),
        ["offerFollowUpDone.create"],
      );
      assert.equal(
        (writes[0]?.args as { data: { offerId: string } }).data.offerId,
        "offer-1",
      );
    });

    test("refuses a closed offer, a replied client and a non-staff caller", async () => {
      await assert.rejects(
        markOfferFollowUpDone(
          adminPrincipal(),
          { offerId: "offer-1" },
          markScripted({ offerStatus: "OFFER_SIGNED" }).db,
        ),
        /no longer waiting on the client/,
      );
      const replied = markScripted({
        documentSends: [
          {
            ...proposalSend,
            lastReplyAt: new Date(SENT.getTime() + 30 * HOUR),
          },
        ],
      });
      await assert.rejects(
        markOfferFollowUpDone(
          adminPrincipal(),
          { offerId: "offer-1" },
          replied.db,
        ),
        /client has replied/,
      );
      assert.deepEqual(replied.writes(), []);
      const stranger = markScripted();
      await assert.rejects(
        markOfferFollowUpDone(
          customerPrincipal(),
          { offerId: "offer-1" },
          stranger.db,
        ),
        /internal staff/,
      );
      assert.deepEqual(stranger.writes(), []);
    });
  });
});
