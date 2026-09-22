import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { lifecycleActionFor } from "../../lib/offer/lifecycle-busy";

// While a status change, recall or revision ran, the workspace's guard dropped
// any other lifecycle click, yet every lifecycle button stayed enabled, so the
// click looked accepted and did nothing. The running action is now threaded to
// the panels as one prop. No pure seam reaches the buttons, so the wiring is
// pinned in source.

const W = "components/offers/new-workflow";
const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("a recall is named by its document, a transition by its target", () => {
  assert.equal(lifecycleActionFor("agreed"), "agreed");
  assert.equal(lifecycleActionFor("tender_draft"), "tender_draft");
  assert.equal(lifecycleActionFor("tender_draft", "tender"), "recall-tender");
});

test("the workspace records which action holds its one guard", () => {
  const workspace = read(`${W}/new-offer-workspace.tsx`);

  assert.match(
    workspace,
    /setLifecycleBusy\(lifecycleActionFor\(next, recallScope\)\)/,
  );
  assert.match(workspace, /setLifecycleBusy\("revision"\)/);
  assert.equal(workspace.match(/setLifecycleBusy\(null\)/g)?.length, 2);
  // Still one guard: the ref set in transition and in createRevision.
  assert.equal(
    workspace.match(/transitioningRef\.current = true;/g)?.length,
    2,
  );
  assert.doesNotMatch(workspace, /setTransitioning\(/);
  assert.match(workspace, /lifecycleBusy=\{lifecycleBusy\}/);
});

test("the screen passes the running action to every lifecycle panel", () => {
  const screen = read(`${W}/offer-workspace-screen.tsx`);

  for (const panel of [
    "OfferLockBanner",
    "SendNegotiatePanel",
    "TenderGatePanel",
    "TenderPanel",
    "ContractPanel",
    "ProjectHandoffPanel",
  ]) {
    const start = screen.indexOf(`<${panel}\n`);
    assert.ok(start >= 0, `the screen does not render ${panel}`);
    const props = screen.slice(start, screen.indexOf("/>", start));
    assert.match(props, /lifecycleBusy=\{lifecycleBusy\}/, panel);
  }
});

// Each lifecycle button, by its click handler, and the action that marks it busy.
const BUTTONS: ReadonlyArray<
  readonly [file: string, handler: string, action: string]
> = [
  ["offer-workspace-send-negotiate.tsx", "onMarkSent", "sent"],
  ["offer-workspace-send-negotiate.tsx", "onMarkOfferSigned", "offer_signed"],
  ["offer-workspace-send-negotiate.tsx", "onRecallOffer", "recall-offer"],
  ["offer-workspace-send-negotiate.tsx", "onCreateRevision", "revision"],
  // The lock banner and the tender gate show Create revision beside the panels.
  ["offer-workspace-step-section.tsx", "onCreateRevision", "revision"],
  ["offer-workspace-tender-gate.tsx", "onCreateRevision", "revision"],
  ["offer-workspace-send-negotiate.tsx", "onMarkAgreed", "agreed"],
  ["offer-workspace-send-negotiate.tsx", "onMarkRejected", "rejected"],
  ["offer-workspace-tender.tsx", "onGenerateTender", "tender_draft"],
  ["offer-workspace-tender.tsx", "onMarkTenderSigned", "tender_signed"],
  ["offer-workspace-tender.tsx", "onRecallTender", "recall-tender"],
  ["offer-workspace-contract.tsx", "onGenerateContract", "contract_draft"],
  ["offer-workspace-contract.tsx", "onMarkContractSigned", "contract_signed"],
  ["offer-workspace-contract.tsx", "onRecallContract", "recall-contract"],
];

// The opening <Button ...> tag whose onClick is exactly this handler.
function buttonTag(source: string, handler: string): string {
  const click = source.indexOf(`onClick={${handler}}`);
  assert.ok(click >= 0, `no button calls ${handler}`);
  return source.slice(source.lastIndexOf("<Button", click), click);
}

for (const [file, handler, action] of BUTTONS) {
  test(`${handler} in ${file} disables while any action runs and reports its own`, () => {
    const tag = buttonTag(read(`${W}/${file}`), handler);
    const normalizedTag = tag.replace(/\s+/g, " ");

    assert.match(
      normalizedTag,
      /disabled=\{[^}]*lifecycleBusy !== null/,
      normalizedTag,
    );
    assert.match(
      normalizedTag,
      new RegExp(
        `aria-busy=\\{\\s*lifecycleBusy === "${action}" \\|\\| undefined\\s*\\}`,
      ),
      normalizedTag,
    );
  });
}

test("Create Project disables while any action runs and reports its own", () => {
  const tag = buttonTag(
    read(`${W}/offer-workspace-project-handoff.tsx`),
    "onCreateProject",
  );

  assert.match(tag, /disabled=\{projectCreating \|\| lifecycleBusy !== null\}/);
  assert.match(tag, /aria-busy=\{projectCreating \|\| undefined\}/);
});
