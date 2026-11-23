import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  TeamCallsSection,
  UnknownCallsSection,
  UnmatchedTextsSection,
} from "@/components/admin/comms-inbound-sections";
import type { CallDto, SmsMessageDto } from "@/lib/leads/comms-types";

// The admin Phone & SMS page's inbound lists render as cards with what each
// item is: a team call under the person's name and role, an unknown call with
// its outcome, a text with why it found no lead.

function call(overrides: Partial<CallDto> = {}): CallDto {
  return {
    agentTranscript: "Caller: Hi, it's Sam.\nMili: Thanks Sam.",
    answeredAt: null,
    answeredBy: "AGENT",
    businessNumber: "+61280001234",
    candidateLeadIds: [],
    connectedAt: "2026-11-23T01:00:05Z",
    contactKind: null,
    contactName: null,
    customerNumber: "+61422222222",
    direction: "INBOUND",
    durationSeconds: 75,
    endedAt: "2026-11-23T01:01:20Z",
    flowStep: "ENDED",
    hangupCause: null,
    id: "call-1",
    leadId: null,
    leadName: null,
    needsReconciliation: false,
    problem: null,
    projectId: null,
    projectMatch: null,
    projectMatchReason: null,
    projectName: null,
    projectUnread: false,
    provider: "telnyx",
    recordingConsent: "DECLARED",
    recordings: [],
    seenAt: null,
    staffName: null,
    staffPhoneLabel: null,
    staffTarget: null,
    startedAt: "2026-11-23T01:00:00Z",
    status: "COMPLETED",
    unread: false,
    ...overrides,
  };
}

const noop = () => {};

test("a team call shows the team member's name, role and the call's outcome", () => {
  const html = renderToStaticMarkup(
    createElement(TeamCallsSection, {
      calls: [
        {
          call: call(),
          caller: {
            e164: "+61422222222",
            kind: "staff",
            name: "Sam Site",
            role: "SITE_MANAGER",
          },
        },
      ],
      onRetried: noop,
    }),
  );
  assert.match(html, /Calls from the team/);
  assert.match(html, /Sam Site/);
  assert.match(html, /Site manager/);
  assert.match(html, /Answered by Mili/);
  assert.match(html, /1:15/);
  assert.match(html, />SS</, "initials avatar");
});

test("an unknown call shows its number, outcome and any project it was filed on", () => {
  const html = renderToStaticMarkup(
    createElement(UnknownCallsSection, {
      calls: [
        call({
          answeredBy: "VOICEMAIL",
          customerNumber: "+61499999999",
          projectName: "12 Smith St",
        }),
        call({
          answeredBy: null,
          connectedAt: null,
          id: "c2",
          customerNumber: "withheld",
        }),
      ],
      onRetried: noop,
    }),
  );
  assert.match(html, /Voicemail/);
  assert.match(html, /12 Smith St/);
  assert.match(html, /Missed/);
  assert.match(html, /Withheld number/);
});

test("a text says why it found no lead, and empty sections say so", () => {
  const message = {
    body: "Hi, is this Royal?",
    candidateLeadIds: [3, 7],
    customerNumber: "+61499999999",
    id: "sms-1",
    mediaCount: 0,
    occurredAt: "2026-11-23T01:00:00Z",
    unmatchedReason: "AMBIGUOUS",
  } as SmsMessageDto;
  const html = renderToStaticMarkup(
    createElement(UnmatchedTextsSection, {
      messages: [message],
      onFiled: noop,
    }),
  );
  assert.match(html, /Matches leads 3, 7/);
  assert.match(html, /Hi, is this Royal\?/);
  assert.match(html, /File onto lead/);

  const empty = renderToStaticMarkup(
    createElement(TeamCallsSection, { calls: [], onRetried: noop }),
  );
  assert.match(empty, /No calls from the team yet/);
});
