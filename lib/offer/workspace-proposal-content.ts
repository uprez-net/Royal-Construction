import type {
  OfferInclusionEntry,
  OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import {
  offerAreaBasisFromJob,
  rawTotalAreaSqm,
} from "@/lib/offer/workspace-area";

// Standard, reusable proposal content (welcome letter, inclusions schedule,
// includes/excludes). This is boilerplate shared across offers — the same way
// the Royal proposal reuses one inclusions list — interpolated with the job's
// client/site where needed. Per-offer specifics live on the job/draft.

export type OfferInclusionRow = {
  readonly group: string;
  readonly category: string;
  readonly specification: string;
  readonly highlight?: boolean;
  // The short form printed beside the price on the Investment Summary page.
  // Present only on the rows worth selling on. Stated HERE, next to the spec it
  // summarises, so the two can never contradict each other — which is exactly
  // what happened when page 4 and the schedule were separate hand-edited lists.
  readonly summary?: string;
};

// Spec facts quoted on more than one page of the proposal.
//
// The Investment Summary bullets, the Inclusions Schedule and the gallery blurb
// each stated these independently and had already drifted: the schedule priced
// 40mm stone and a $30/m² porcelain tile allowance for the living areas, while
// the bullets sold 60mm stone and herringbone timber. Those are different
// materials on different cost bases, so the client could not tell which contract
// they were signing. The schedule is the priced, contractual statement, so its
// values win — and anything printed on two pages is now defined here once, where
// the two surfaces cannot disagree.
export const OFFER_SPEC_FACTS = {
  stoneBenchtopThickness: "40mm",
  livingFloorFinish: "600 x 1200 porcelain tiles",
  ductedAirConditioning: "18kW 4-zone",
} as const;

// Full inclusions schedule (category -> specification), grouped by trade area.
// Mirrors the Royal "Full Inclusions Schedule".
export const STANDARD_INCLUSIONS_SCHEDULE: readonly OfferInclusionRow[] = [
  {
    group: "Structure & Envelope",
    category: "Design & Plans",
    specification:
      "Architectural drawings provided by owner / owner's architect. All construction costs fixed as per the approved plans. No design fees in this contract.",
  },
  {
    group: "Structure & Envelope",
    category: "Concrete Slab",
    summary: "All structural works — slab, frame, roof",
    specification:
      "Engineered slab — piering to engineer spec. Drop edge beam to sloped boundary.",
  },
  {
    group: "Structure & Envelope",
    category: "Frame",
    specification:
      "Double storey structural timber frame — steel beams, lintels and columns to engineer spec.",
  },
  {
    group: "Structure & Envelope",
    category: "Roof",
    specification:
      "Colorbond metal roofing — full hip/gable profile. Gutters, downpipes, eaves lining included.",
  },
  {
    group: "Structure & Envelope",
    category: "Roof Trusses",
    specification:
      "Engineered prefabricated roof trusses to suit approved plans.",
  },
  {
    group: "Structure & Envelope",
    category: "External Walls",
    specification:
      "Render to all elevations — both levels. Arched feature entry included.",
  },
  {
    group: "Structure & Envelope",
    category: "Rendering — Full Facade",
    summary: "Full render to ALL elevations — both levels",
    specification:
      "Full acrylic render to entire external facade — ground floor AND first floor — as per architectural plans. Colour selection included. Premium inclusion priced into your fixed contract.",
    highlight: true,
  },
  {
    group: "Structure & Envelope",
    category: "Feature Facade",
    specification:
      "Entry columns, rendered surrounds, feature cladding per 3D renders.",
  },
  {
    group: "Structure & Envelope",
    category: "Windows",
    specification:
      "Aluminium double-glazed windows throughout. Fly screens included.",
  },
  {
    group: "Structure & Envelope",
    category: "External Doors",
    specification:
      "Feature arched front entry door. All external doors, locks and hardware.",
  },
  {
    group: "Structure & Envelope",
    category: "Garage Door",
    specification:
      "Double panel-lift garage door — remote operated — facade matched.",
  },
  {
    group: "Structure & Envelope",
    category: "Scaffolding",
    specification: "Full perimeter scaffolding — both levels.",
  },
  {
    group: "Kitchen — Luxury",
    category: "Kitchen Cabinetry",
    summary: "Luxury shaker kitchen + butler's pantry",
    specification:
      "Custom shaker door kitchen — overhead + base cabinets, soft-close. Butler's pantry with full shelving, bench and sink.",
    highlight: true,
  },
  {
    group: "Kitchen — Luxury",
    category: "Stone Benchtops",
    summary: `${OFFER_SPEC_FACTS.stoneBenchtopThickness} stone benchtops throughout`,
    specification: `${OFFER_SPEC_FACTS.stoneBenchtopThickness} engineered stone — kitchen island, perimeter bench and butler's pantry. Choice from range.`,
  },
  {
    group: "Kitchen — Luxury",
    category: "Splashback",
    specification:
      "Full-height tiled splashback above cooktop. Stone to match benchtops.",
  },
  {
    group: "Kitchen — Luxury",
    category: "Appliances",
    specification:
      "Westinghouse package: 90cm cooktop, electric oven, rangehood and dishwasher.",
  },
  {
    group: "Bathrooms",
    category: "Vanity Cabinetry",
    specification:
      "Custom vanity cabinetry to main bathroom, master ensuite, second ensuite, powder toilet.",
  },
  {
    group: "Bathrooms",
    category: "Vanity Benchtops",
    specification:
      "Engineered stone tops to all vanities. Choice at colour selection.",
  },
  {
    group: "Bathrooms",
    category: "Tiling",
    summary: "Floor-to-ceiling tiles — all wet areas",
    specification: "Floor-to-ceiling wall tiles — all bathrooms and laundry.",
  },
  {
    group: "Bathrooms",
    category: "Shower Screens",
    specification: "Semi-frameless shower screens to all showers.",
  },
  {
    group: "Bathrooms",
    category: "Tapware",
    specification:
      "Quality tapware package — basin mixers, shower sets. All wet areas.",
  },
  {
    group: "Bathrooms",
    category: "Waterproofing",
    specification: "Full AS3740 waterproofing — all wet areas.",
  },
  {
    group: "Internal Finishes",
    category: "Internal Doors",
    specification:
      "Hollow core internal doors throughout. All door hardware included.",
  },
  {
    group: "Internal Finishes",
    category: "Door Hardware",
    specification: "Smart lock to front entry.",
  },
  {
    group: "Internal Finishes",
    category: "Staircase",
    summary: "Feature staircase with glass balustrade",
    specification:
      "Feature staircase — MDF treads with glass/void balustrade per section drawings.",
  },
  {
    group: "Internal Finishes",
    category: "Void",
    specification: "Feature void to first floor. Balustrade to void included.",
  },
  {
    group: "Internal Finishes",
    category: "Wardrobes",
    specification:
      "Built-in robes — master WIR full fitout, second bedroom WIR. Soft-close fitout.",
  },
  {
    group: "Internal Finishes",
    category: "Gyprock",
    specification:
      "13mm plasterboard throughout. Bulkheads to kitchen and bathrooms. Cornice to all rooms.",
  },
  {
    group: "Internal Finishes",
    category: "Insulation",
    specification:
      "R2.5 wall batts + R4.1 ceiling batts — full thermal and acoustic insulation.",
  },
  {
    group: "Internal Finishes",
    category: "Skirting",
    specification:
      "90mm skirting and 90mm architraves throughout — timber, paint-grade.",
  },
  {
    group: "Internal Finishes",
    category: "Flooring — Living",
    summary: `${OFFER_SPEC_FACTS.livingFloorFinish} — living areas`,
    specification: `${OFFER_SPEC_FACTS.livingFloorFinish}. $30/m² allowance.`,
  },
  {
    group: "Internal Finishes",
    category: "Flooring — Bedrooms",
    specification:
      "Timber-look hybrid flooring all bedrooms, rumpus and office.",
  },
  {
    group: "Electrical & HVAC",
    category: "Electrical",
    summary: "All plumbing & electrical to completion",
    specification:
      "Full rough-in, final fit-out. Smoke alarms, data and camera wiring included.",
  },
  {
    group: "Electrical & HVAC",
    category: "Lighting",
    specification:
      "LED downlights throughout. Feature pendant provisions to kitchen and dining.",
  },
  {
    group: "Electrical & HVAC",
    category: "Ducted Air Con",
    summary: `${OFFER_SPEC_FACTS.ductedAirConditioning} ducted air conditioning`,
    specification: `${OFFER_SPEC_FACTS.ductedAirConditioning} ducted reverse-cycle. All living areas and bedrooms.`,
    highlight: true,
  },
  {
    group: "Electrical & HVAC",
    category: "Hot Water",
    specification:
      "2 × 31L gas continuous flow hot water systems — BASIX compliant.",
  },
  {
    group: "Electrical & HVAC",
    category: "Rainwater Tank",
    specification:
      "2,000L rainwater tank — toilet/laundry reuse. BASIX compliance.",
  },
  {
    group: "External & Completion",
    category: "Driveway",
    summary: "Driveway — both vehicle crossings",
    specification:
      "Exposed aggregate or brushed concrete driveway — both vehicle crossings.",
  },
  {
    group: "External & Completion",
    category: "Painting",
    specification: "Full internal and external painting — two coats.",
  },
  {
    group: "External & Completion",
    category: "Front Pillars",
    specification: "Feature entry pillars per 3D renders.",
  },
  {
    group: "External & Completion",
    category: "Final Clean",
    summary: "Final clean & defects period",
    specification: "Professional builders clean prior to handover.",
  },
  {
    group: "External & Completion",
    category: "HBCF",
    summary: "HBCF home warranty insurance",
    specification:
      "Home Building Compensation Fund warranty insurance — included. iCare registered.",
  },
  // These two were sold on the Investment Summary page but had no schedule row
  // of their own, so collapsing the two lists would have quietly dropped them
  // from page 4. They are real inclusions, so they get real specs.
  {
    group: "External & Completion",
    category: "PC & Provisional Items",
    summary: "All PC items per inclusions schedule",
    specification:
      "All prime-cost and provisional-sum items as listed in this schedule, confirmed at colour selection.",
  },
  {
    group: "External & Completion",
    category: "Approvals",
    summary: "Council certifier and approval fees",
    specification:
      "Council certifier fees, development application and construction certificate approval fees.",
  },
];

// The single inclusions list a new offer starts from. The grouped/categorised
// rows above are SEED DATA — they are never rendered directly. Category
// headings and the `highlight` flag are deliberately not carried: the printed
// schedule is a plain numbered list, and each entry's optional `summary` is
// what the Investment Summary page prints beside the price.
export const STANDARD_INCLUSION_ENTRIES: readonly OfferInclusionEntry[] =
  STANDARD_INCLUSIONS_SCHEDULE.map((row) => ({
    spec: row.specification,
    category: row.category,
  }));

// The seeded "This price includes" list. `summary` on a template row is the
// SEED for this list, not a field on the entry: one selling line covers several
// schedule rows, so it cannot live on any one of them.
export const STANDARD_INCLUSION_HIGHLIGHTS: readonly string[] =
  STANDARD_INCLUSIONS_SCHEDULE.map((row) => row.summary).filter(
    (summary): summary is string => Boolean(summary?.trim()),
  );

// Page-4 exclusions. The includes side of this pair is gone — it is now the
// `summary` on each inclusion entry, so it cannot drift from the schedule.
export const OFFER_EXCLUDES_BULLETS: readonly string[] = [
  "Landscaping & turf beyond driveway",
  "Boundary or pool fencing",
  "Swimming pool or spa",
  "Blinds & window furnishings",
  "Solar panels (variation on request)",
  "Granny flat (not in current scope)",
  "Developer / estate infrastructure levies",
  "Rock excavation or abnormal fill beyond standard",
];

// Personal welcome letter, interpolated with the client + site.
export function buildWelcomeParagraphs(
  job: OfferWorkspaceJob,
): readonly string[] {
  // The same total the cover and the Tender print; this one left out balcony and
  // void, so the letter quoted a smaller home than the page before it.
  // Up to two decimals, like formatArea on the cover and in the Tender, so a
  // 435.5 m² home is not quoted here as 436.
  const totalAreaSqm = rawTotalAreaSqm(offerAreaBasisFromJob(job));
  const totalArea =
    totalAreaSqm > 0
      ? new Intl.NumberFormat("en-AU", {
          maximumFractionDigits: 2,
        }).format(totalAreaSqm)
      : null;
  // Only assert what we can derive from this job (client, site, area). Specific
  // design features, "photos match your home", and finish guarantees were
  // hard-coded and often wrong (e.g. "double storey" on a single-storey build),
  // so they're omitted rather than promised. So is "we have reviewed your
  // plans": an area typed into job setup is not evidence anyone read a plan,
  // and nothing on the offer records that they did.
  const excitedLine =
    totalArea !== null
      ? `We're genuinely excited to build your home — all ${totalArea} square metres of it — with the care a proper custom build deserves.`
      : "We're genuinely excited to build your home with the care a proper custom build deserves.";
  return [
    `Thank you for trusting Royal Constructions to build your forever home${siteLocationPhrase(job.siteAddress)}. We don't take that lightly.`,
    excitedLine,
    "Every finish described in this proposal is part of your inclusions, locked into the fixed price below.",
    "We are here every step of the way.",
  ];
}

const AU_STATES =
  "NSW|VIC|QLD|SA|WA|TAS|NT|ACT|New South Wales|Victoria|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory";

// "Pendle Hill NSW 2145" -> "Pendle Hill"; also a bare "NSW 2145", and the
// state spelt out, as some geocoders do ("Pendle Hill New South Wales 2145").
const LOCALITY_STATE = new RegExp(
  String.raw`^(.*?)\s*\b(?:${AU_STATES})\b(?:\s+\d{4})?$`,
  "i",
);
const STATE_THEN_COUNTRY = new RegExp(
  String.raw`\b(${AU_STATES})\s+australia$`,
  "i",
);

// The country, as its own segment or trailing a postcode or a state ("NSW
// 2145 Australia", "New South Wales Australia"). Never the end of a state
// name: "South Australia" stays whole.
function withoutCountry(segment: string): string {
  const trimmed = segment.trim();
  if (/^australia$/i.test(trimmed)) return "";
  return trimmed
    .replace(/(\d{4})\s+australia$/i, "$1")
    .replace(STATE_THEN_COUNTRY, "$1");
}

/**
 * The suburb of a site address, or `null` when it cannot be picked out
 * reliably. Addresses arrive as typed or as a geocoder formatted them:
 *
 *   "13 Binalong Road, Pendle Hill NSW 2145"         -> "Pendle Hill"
 *   "Kellyville NSW 2155, Australia"                  -> "Kellyville"
 *   "Unit 3, 13 Binalong Road, Pendle Hill NSW 2145"  -> "Pendle Hill"
 *   "13 Binalong Road, Pendle Hill, NSW 2145"         -> "Pendle Hill"
 *   "13 Binalong Road, Pendle Hill, New South Wales"  -> "Pendle Hill"
 *   "1 King William St, Adelaide, South Australia"    -> "Adelaide"
 *   "13 Binalong Road Pendle Hill NSW 2145"           -> null (street and
 *                                                        suburb run together)
 *
 * The old rule took the second comma segment, which for a geocoded
 * "Kellyville NSW 2155, Australia" was the country.
 */
export function siteLocality(siteAddress: string): string | null {
  const segments = siteAddress.split(",").map(withoutCountry).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const match = LOCALITY_STATE.exec(segments[i]);
    if (!match) continue;
    let locality = match[1].trim();
    if (!locality) {
      // A bare state ("NSW 2145", "South Australia"): the suburb is the
      // segment before it — unless that segment carries a state of its own
      // ("Adelaide SA 5000, South Australia"), which the next pass reads.
      const previous = i > 0 ? segments[i - 1] : "";
      if (LOCALITY_STATE.test(previous)) continue;
      locality = previous;
    }
    // A digit means the street is still attached ("13 Binalong Road Pendle
    // Hill"), and there is no reliable place to cut it.
    return locality && !/\d/.test(locality) ? locality : null;
  }
  // No state at all: "13 Binalong Road, Pendle Hill".
  const last = segments.at(-1);
  return segments.length >= 2 && last && !/\d/.test(last) ? last : null;
}

// " at Kellyville", or the whole address when no suburb can be picked out,
// or nothing at all when the job has no address yet.
function siteLocationPhrase(siteAddress: string): string {
  const address = siteAddress.trim();
  if (!address) return "";
  return ` at ${siteLocality(address) ?? address}`;
}
