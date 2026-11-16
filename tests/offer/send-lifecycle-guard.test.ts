import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { effectiveLifecycleBusy } from "@/lib/offer/lifecycle-busy";

// A recall or revision started while a DocuSign envelope is being created, or a
// send started while a lifecycle action runs, races the envelope on a signed
// document. The server copes (claim-before-write, cancelRacedSend) but the
// screen used to let a person start it (#286).

test("a send in flight locks the lifecycle buttons", () => {
  assert.equal(effectiveLifecycleBusy(null, true), "send");
});

test("a running lifecycle action keeps reporting itself", () => {
  assert.equal(effectiveLifecycleBusy("revision", false), "revision");
  assert.equal(effectiveLifecycleBusy("recall-offer", true), "recall-offer");
});

test("nothing running leaves everything enabled", () => {
  assert.equal(effectiveLifecycleBusy(null, false), null);
});

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("each send handler takes and releases the lifecycle guard", () => {
  const source = read("components/offers/new-workflow/new-offer-workspace.tsx");
  for (const [setter, name] of [
    ["setOfferSignSending", "sendOfferAccept"],
    ["setTenderSending", "sendTender"],
    ["setContractSending", "sendContract"],
  ] as const) {
    const start = source.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, `no ${name}`);
    const end = source.indexOf("\n  }, [", start);
    const body = source.slice(start, end);
    const guard = body.indexOf("if (transitioningRef.current)");
    const sending = body.indexOf(`${setter}(true)`);
    assert.ok(
      guard >= 0 && sending > guard,
      `${name} must check the guard before it starts sending`,
    );
    assert.match(body, /transitioningRef\.current = true/);
    assert.match(
      body,
      new RegExp(
        `finally \\{\\s*${setter}\\(false\\);\\s*transitioningRef\\.current = false;`,
      ),
    );
  }
});

test("every send button is disabled while a lifecycle action runs", () => {
  for (const [file, needle] of [
    [
      "components/offers/new-workflow/offer-workspace-send-negotiate.tsx",
      /offerSignSending\s*\|\|\s*lifecycleBusy !== null/,
    ],
    [
      "components/offers/new-workflow/offer-workspace-tender.tsx",
      /sending\s*\|\|\s*lifecycleBusy !== null/,
    ],
    [
      "components/offers/new-workflow/offer-workspace-contract.tsx",
      /sending\s*\|\|\s*confirming\s*\|\|\s*lifecycleBusy !== null/,
    ],
  ] as const) {
    assert.match(read(file), needle, file);
  }
});
