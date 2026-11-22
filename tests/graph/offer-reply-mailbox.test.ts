import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// #585: a client's reply to an offer can land in admin@ as well as info@. The
// webhook gated the [RCOFR-…] lookup on the business mailbox, so an admin@
// reply was filed on the lead's trail and the offer stayed "SENT". The route
// is too large to run here, so these pin the source the way the other
// architecture tests do.
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("offer replies in either mailbox (#585)", () => {
  const route = read("app/api/graph/notifications/route.ts");

  test("the offer token is read whichever mailbox the message is in", () => {
    assert.match(
      route,
      /const offerReplyToken = extractOfferReplyToken\(message\.subject\);/,
    );
    assert.doesNotMatch(route, /mailbox === "business"\s*\?\s*extractOfferReplyToken/);
  });

  test("the attachment workflow is told which mailbox holds the message", () => {
    const start = route.indexOf("start(storeOfferReplyAttachments");
    assert.ok(start > 0);
    assert.match(route.slice(start, start + 200), /mailbox,/);
  });

  test("the workflow opens that mailbox, defaulting to business for a queued run", () => {
    const wf = read("lib/workflow/offer-reply-attachments.ts");
    assert.match(wf, /mailbox: GraphMailbox = "business"/);
    assert.match(wf, /getGraphConfig\(mailbox\)/);
    assert.doesNotMatch(wf, /getGraphConfig\("business"\)/);
  });
});
