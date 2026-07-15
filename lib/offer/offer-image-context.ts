import type { OfferImageSlotKey } from "./workspace-images";
import type {
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "./workspace-model";

// Turn the offer's actual selections (included cost lines, allowances, build
// scope) into short VISUAL descriptors per image slot, so the AI inspiration
// images reflect this build's façade + finishes instead of generic defaults.
//
// The cost-line/allowance text is construction spec, not visual language, so we
// scan it for signal keywords and emit image-ready phrases rather than passing
// the raw sentences into the prompt.
type Signal = readonly [test: RegExp, phrase: string];

const SLOT_SIGNALS: Record<OfferImageSlotKey, readonly Signal[]> = {
  hero: [
    [/\brender(ing|ed)?\b/i, "rendered feature panels"],
    [/face brick|common brick|\bbrick\b/i, "face brick facade"],
    [/double garage/i, "double garage"],
    [/\bgarage\b/i, "garage"],
    [/balcon/i, "first-floor balcony"],
    [/porch|entry|portico/i, "feature entry"],
  ],
  exterior: [
    [/\brender(ing|ed)?\b/i, "rendered feature panels"],
    [/face brick|common brick|\bbrick\b/i, "face brick facade"],
    [/double garage/i, "double garage"],
    [/\bgarage\b/i, "garage"],
    [/balcon/i, "first-floor balcony"],
    [/porch|entry|portico/i, "feature entry"],
    [/alfresco/i, "alfresco"],
  ],
  render: [
    [/\brender(ing|ed)?\b/i, "rendered feature panels"],
    [/face brick|common brick|\bbrick\b/i, "face brick"],
    [/double garage/i, "double garage"],
    [/balcon/i, "first-floor balcony"],
  ],
  kitchen: [
    [/stone|benchtop|caesar|quartz/i, "stone island benchtop"],
    [/butler|pantry/i, "butler's pantry"],
    [/joiner|cabinet|cupboard/i, "custom cabinetry joinery"],
    [/appliance|oven|cooktop|rangehood/i, "integrated appliances"],
    [/splashback/i, "tiled splashback"],
    [/waterfall/i, "waterfall stone ends"],
  ],
  living: [
    [/herringbone/i, "herringbone timber flooring"],
    [/timber floor|floor ?board|flooring|hybrid floor/i, "timber flooring"],
    [/\bvoid\b/i, "double-height void"],
    [/stair/i, "feature staircase"],
    [/rumpus/i, "spacious rumpus"],
  ],
  bedroom: [
    [/carpet/i, "plush carpet"],
    [/wardrobe|\brobe|\bwir\b|walk[- ]?in/i, "built-in wardrobes"],
    [/shutter/i, "plantation shutters"],
    [/ensuite/i, "ensuite access"],
  ],
  bathroom: [
    [/floor[- ]?to[- ]?ceiling|\btile/i, "floor-to-ceiling tiles"],
    [/freestanding|\bbath\b/i, "freestanding bath"],
    [/tapware|mixer/i, "designer tapware"],
    [/semi[- ]?frameless|shower screen|\bshower\b/i, "semi-frameless shower"],
    [/niche/i, "tiled niche"],
    [/vanity/i, "stone-top vanity"],
  ],
};

const ALL_SLOTS = Object.keys(SLOT_SIGNALS) as OfferImageSlotKey[];

export function buildOfferImageContext(input: {
  job: OfferWorkspaceJob;
  lines: readonly OfferWorkspaceCostLine[];
  allowances: readonly OfferWorkspaceScopeItem[];
}): Record<OfferImageSlotKey, string> {
  // Corpus of customer-facing text the client actually selected/included.
  const parts: string[] = [];
  for (const line of input.lines) {
    if (!line.includedInContract) continue;
    parts.push(line.itemName, line.offerTenderLineItem, line.notesOrSpec);
  }
  for (const allowance of input.allowances) {
    if (!allowance.includedInOfferDocument) continue;
    parts.push(allowance.label, allowance.description);
  }
  parts.push(...input.job.buildScope, input.job.buildType);
  const corpus = parts.filter(Boolean).join(" • ").toLowerCase();

  const result = {} as Record<OfferImageSlotKey, string>;
  for (const slot of ALL_SLOTS) {
    const phrases: string[] = [];
    for (const [test, phrase] of SLOT_SIGNALS[slot]) {
      if (!test.test(corpus)) {
        continue;
      }
      // Skip a phrase already subsumed by (or subsuming) one we have — e.g.
      // don't add "garage" once "double garage" is present.
      if (phrases.some((p) => p.includes(phrase) || phrase.includes(p))) {
        continue;
      }
      phrases.push(phrase);
    }
    // Cap to keep the image prompt focused.
    result[slot] = phrases.slice(0, 4).join(", ");
  }
  return result;
}
