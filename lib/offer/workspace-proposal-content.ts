import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";

// Standard, reusable proposal content (welcome letter, inclusions schedule,
// includes/excludes). This is boilerplate shared across offers — the same way
// the Royal proposal reuses one inclusions list — interpolated with the job's
// client/site where needed. Per-offer specifics live on the job/draft.

export type OfferInclusionRow = {
  readonly group: string;
  readonly category: string;
  readonly specification: string;
  readonly highlight?: boolean;
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
    specification: "Engineered prefabricated roof trusses to suit approved plans.",
  },
  {
    group: "Structure & Envelope",
    category: "External Walls",
    specification: "Render to all elevations — both levels. Arched feature entry included.",
  },
  {
    group: "Structure & Envelope",
    category: "Rendering — Full Facade",
    specification:
      "Full acrylic render to entire external facade — ground floor AND first floor — as per architectural plans. Colour selection included. Premium inclusion priced into your fixed contract.",
    highlight: true,
  },
  {
    group: "Structure & Envelope",
    category: "Feature Facade",
    specification: "Entry columns, rendered surrounds, feature cladding per 3D renders.",
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
    specification: "Feature arched front entry door. All external doors, locks and hardware.",
  },
  {
    group: "Structure & Envelope",
    category: "Garage Door",
    specification: "Double panel-lift garage door — remote operated — facade matched.",
  },
  {
    group: "Structure & Envelope",
    category: "Scaffolding",
    specification: "Full perimeter scaffolding — both levels.",
  },
  {
    group: "Kitchen — Luxury",
    category: "Kitchen Cabinetry",
    specification:
      "Custom shaker door kitchen — overhead + base cabinets, soft-close. Butler's pantry with full shelving, bench and sink.",
    highlight: true,
  },
  {
    group: "Kitchen — Luxury",
    category: "Stone Benchtops",
    specification: `${OFFER_SPEC_FACTS.stoneBenchtopThickness} engineered stone — kitchen island, perimeter bench and butler's pantry. Choice from range.`,
  },
  {
    group: "Kitchen — Luxury",
    category: "Splashback",
    specification: "Full-height tiled splashback above cooktop. Stone to match benchtops.",
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
    specification: "Engineered stone tops to all vanities. Choice at colour selection.",
  },
  {
    group: "Bathrooms",
    category: "Tiling",
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
    specification: "Quality tapware package — basin mixers, shower sets. All wet areas.",
  },
  {
    group: "Bathrooms",
    category: "Waterproofing",
    specification: "Full AS3740 waterproofing — all wet areas.",
  },
  {
    group: "Internal Finishes",
    category: "Internal Doors",
    specification: "Hollow core internal doors throughout. All door hardware included.",
  },
  {
    group: "Internal Finishes",
    category: "Door Hardware",
    specification: "Smart lock to front entry.",
  },
  {
    group: "Internal Finishes",
    category: "Staircase",
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
    specification: "R2.5 wall batts + R4.1 ceiling batts — full thermal and acoustic insulation.",
  },
  {
    group: "Internal Finishes",
    category: "Skirting",
    specification: "90mm skirting and 90mm architraves throughout — timber, paint-grade.",
  },
  {
    group: "Internal Finishes",
    category: "Flooring — Living",
    specification: `${OFFER_SPEC_FACTS.livingFloorFinish}. $30/m² allowance.`,
  },
  {
    group: "Internal Finishes",
    category: "Flooring — Bedrooms",
    specification: "Timber-look hybrid flooring all bedrooms, rumpus and office.",
  },
  {
    group: "Electrical & HVAC",
    category: "Electrical",
    specification:
      "Full rough-in, final fit-out. Smoke alarms, data and camera wiring included.",
  },
  {
    group: "Electrical & HVAC",
    category: "Lighting",
    specification: "LED downlights throughout. Feature pendant provisions to kitchen and dining.",
  },
  {
    group: "Electrical & HVAC",
    category: "Ducted Air Con",
    specification: `${OFFER_SPEC_FACTS.ductedAirConditioning} ducted reverse-cycle. All living areas and bedrooms.`,
    highlight: true,
  },
  {
    group: "Electrical & HVAC",
    category: "Hot Water",
    specification: "2 × 31L gas continuous flow hot water systems — BASIX compliant.",
  },
  {
    group: "Electrical & HVAC",
    category: "Rainwater Tank",
    specification: "2,000L rainwater tank — toilet/laundry reuse. BASIX compliance.",
  },
  {
    group: "External & Completion",
    category: "Driveway",
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
    specification: "Professional builders clean prior to handover.",
  },
  {
    group: "External & Completion",
    category: "HBCF",
    specification: "Home Building Compensation Fund warranty insurance — included. iCare registered.",
  },
];

// Investment-summary bullet lists (customer-facing includes / excludes).
export const OFFER_INCLUDES_BULLETS: readonly string[] = [
  "All structural works — slab, frame, roof",
  "Full render to ALL elevations — both levels",
  "All plumbing & electrical to completion",
  "Luxury shaker kitchen + butler's pantry",
  `${OFFER_SPEC_FACTS.stoneBenchtopThickness} stone benchtops throughout`,
  `${OFFER_SPEC_FACTS.ductedAirConditioning} ducted air conditioning`,
  `${OFFER_SPEC_FACTS.livingFloorFinish} — living areas`,
  "Floor-to-ceiling tiles — all wet areas",
  "Feature staircase with glass balustrade",
  "All PC items per inclusions schedule",
  "Council certifier and approval fees",
  "Driveway — both vehicle crossings",
  "HBCF home warranty insurance",
  "Final clean & defects period",
];

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
  const totalArea = Math.round(
    job.groundFloorSqm +
      job.firstFloorSqm +
      job.garageSqm +
      job.alfrescoPorchSqm +
      job.porchSqm +
      job.grannyFlatSqm,
  );
  // Only assert what we can derive from this job (client, site, area). Specific
  // design features, "photos match your home", and finish guarantees were
  // hard-coded and often wrong (e.g. "double storey" on a single-storey build),
  // so they're omitted rather than promised.
  return [
    `Thank you for trusting Royal Constructions to build your forever home at ${shortLocation(job.siteAddress)}. We don't take that lightly.`,
    `We have reviewed your plans carefully — all ${totalArea} square metres of them — and we're genuinely excited to build your home with the care a proper custom build deserves.`,
    "Every finish described in this proposal is part of your inclusions, locked into the fixed price below.",
    "We are here every step of the way.",
  ];
}

function shortLocation(siteAddress: string): string {
  // "13 Binalong Road, Pendle Hill NSW 2145" -> "Pendle Hill"
  const parts = siteAddress.split(",");
  if (parts.length < 2) {
    return siteAddress;
  }
  const locality = parts[1].trim().replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b.*$/i, "");
  return locality || siteAddress;
}
