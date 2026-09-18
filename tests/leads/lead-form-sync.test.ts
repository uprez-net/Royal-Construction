import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { rebaseTrackedFields } from "../../lib/leads/lead-form-sync";

// The lead detail page edits one lead from two places at once. The header badge
// writes the stage on its own; the overview sections each save independently.
// The overview form seeded itself from the lead at mount and never moved, so
// after a header stage change the Source and stage section still showed the old
// stage, flagged itself `Unsaved`, and offered a Save primed to write that
// stale stage back over the new one — a QUOTED lead with a Save that would have
// written DISCOVERY.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

type Form = {
  stage: string;
  sourceDetail: string;
  urgent: boolean;
  name: string;
};

const TRACKED: readonly (keyof Form)[] = [
  "stage",
  "sourceDetail",
  "urgent",
  "name",
];

const form = (over: Partial<Form> = {}): Form => ({
  stage: "Discovery",
  sourceDetail: "Referral",
  urgent: false,
  name: "Sandhu",
  ...over,
});

test("an untouched field follows the lead", () => {
  const mounted = form();
  const next = rebaseTrackedFields(
    mounted,
    mounted,
    form({ stage: "Qualified" }),
    TRACKED,
  );

  assert.equal(next.stage, "Qualified");
});

test("the section stops reading as dirty once it has followed", () => {
  const mounted = form();
  const nextBaseline = form({ stage: "Qualified" });
  const next = rebaseTrackedFields(mounted, mounted, nextBaseline, TRACKED);

  // This is the comparison isSectionDirty makes.
  const dirty = TRACKED.some((f) => !Object.is(next[f], nextBaseline[f]));
  assert.equal(dirty, false, "the Unsaved chip would still be showing");
});

test("three stage changes in a row all land, not just the first", () => {
  // The reported failure was not "one hop behind" — the section was frozen at
  // its mount value through Contacted -> Discovery -> Qualified -> Quoted.
  let current = form({ stage: "Contacted" });
  let baseline = current;

  for (const stage of ["Discovery", "Qualified", "Quoted"]) {
    const nextBaseline = form({ stage });
    current = rebaseTrackedFields(current, baseline, nextBaseline, TRACKED);
    baseline = nextBaseline;
  }

  assert.equal(current.stage, "Quoted");
});

test("an edit the operator made is not discarded by a change elsewhere", () => {
  const mounted = form();
  // They have typed a new name but not saved it.
  const edited = { ...mounted, name: "Sandhu Family Trust" };
  // Meanwhile the header moves the stage.
  const next = rebaseTrackedFields(
    edited,
    mounted,
    form({ stage: "Qualified" }),
    TRACKED,
  );

  assert.equal(
    next.name,
    "Sandhu Family Trust",
    "their typing was thrown away",
  );
  assert.equal(next.stage, "Qualified", "the stage did not follow");
});

test("a field the operator edited to the same value the lead now has is not dirty", () => {
  const mounted = form();
  const edited = { ...mounted, stage: "Qualified" };
  const next = rebaseTrackedFields(
    edited,
    mounted,
    form({ stage: "Qualified" }),
    TRACKED,
  );

  assert.equal(next.stage, "Qualified");
  assert.equal(next, edited, "an identical value should not force a re-render");
});

test("nothing to do returns the same object, so no render is forced", () => {
  const mounted = form();
  assert.equal(rebaseTrackedFields(mounted, mounted, form(), TRACKED), mounted);
});

test("untracked fields are left alone", () => {
  const mounted = { ...form(), notes: "keep me" };
  const next = rebaseTrackedFields(
    mounted,
    mounted,
    { ...form({ stage: "Qualified" }), notes: "server copy" },
    TRACKED,
  );

  assert.equal(next.notes, "keep me");
  assert.equal(next.stage, "Qualified");
});

test("a stage the operator chose themselves still wins, and still reads as dirty", () => {
  // Moving a lead backwards is legitimate, so this is not something to block —
  // the fix is that it can only happen deliberately, never from a stale seed.
  const mounted = form({ stage: "Negotiating" });
  const chosen = { ...mounted, stage: "Qualified" };
  const nextBaseline = form({ stage: "Quoted" });
  const next = rebaseTrackedFields(chosen, mounted, nextBaseline, TRACKED);

  assert.equal(next.stage, "Qualified");
  assert.ok(TRACKED.some((f) => !Object.is(next[f], nextBaseline[f])));
});

// ── The component uses it ──

test("the overview tab rebases instead of freezing at mount", () => {
  const source = read("components/leads/detail/lead-overview-tab.tsx");

  assert.ok(
    source.includes(
      "rebaseTrackedFields(prev, syncedBaseline, baseline, TRACKED_FIELDS)",
    ),
    "the overview form is no longer following the lead",
  );
  assert.ok(
    source.includes(
      "const [syncedBaseline, setSyncedBaseline] = useState(baseline)",
    ),
    "the previous baseline is not being tracked, so nothing can be rebased",
  );
  // TRACKED_FIELDS must stay derived from SECTION_FIELDS: a field that can be
  // saved but is not rebased is exactly the stale-Save bug again.
  assert.ok(
    source.includes("Object.values(SECTION_FIELDS).flat()"),
    "TRACKED_FIELDS has drifted from the fields the sections actually save",
  );
});
