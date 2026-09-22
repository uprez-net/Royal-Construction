import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nonEmptyConnectText,
  parseConnectPayload,
} from "../../lib/docusign/connect-payload";

test("accepts a Connect void reason and falls back from blank summary text", () => {
  const payload = parseConnectPayload({
    event: "envelope-voided",
    data: {
      envelopeId: "envelope-1",
      voidedReason: "Builder recall",
      envelopeSummary: { voidedReason: "  " },
    },
  });

  assert.equal(
    nonEmptyConnectText(payload?.data?.envelopeSummary?.voidedReason) ??
      nonEmptyConnectText(payload?.data?.voidedReason),
    "Builder recall",
  );
});

test("rejects malformed recipient and void-reason fields", () => {
  assert.equal(
    parseConnectPayload({
      event: "envelope-voided",
      data: { envelopeId: "envelope-1", voidedReason: 42 },
    }),
    null,
  );
  assert.equal(
    parseConnectPayload({
      event: "envelope-sent",
      data: {
        envelopeId: "envelope-1",
        envelopeSummary: { recipients: { signers: [{ status: 42 }] } },
      },
    }),
    null,
  );
});
