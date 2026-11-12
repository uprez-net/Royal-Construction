import { ProjectStage } from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

// The six stage checklists every project carries, and what each one is
// copied from (issue #420).
//
// Checklist N verifies contract stage N, in contract order: Deposit, Slab,
// Frame, Lock Up, Interior Fit-Out, Final. A project's milestones vary in
// number, but its stages are always these six, so the stage is what links a
// checklist to the Milestones tab and both routes open the same record.
//
// Only the Final stage's checklist, the handover inspection, has rows in this
// release. Checklists 1-5 are deliberately empty: no questions are invented
// for them, and an empty checklist can be downloaded as a blank, labelled
// template but never closed as if it had been inspected.

/** The contract stages, in order. Checklist number = index + 1. */
export const CHECKLIST_STAGES: readonly ProjectStage[] = [
  ProjectStage.Deposit,
  ProjectStage.Slab,
  ProjectStage.Frame,
  ProjectStage.Lockup,
  ProjectStage.Interior_Fit_Out,
  ProjectStage.Final,
];

export const CHECKLIST_COUNT = CHECKLIST_STAGES.length;

export const HANDOVER_TEMPLATE_KEY = "handover-v1";
export const EMPTY_TEMPLATE_KEY = "empty";

/** One row of a template, before it is copied onto a checklist. */
export type ChecklistTemplateItem = {
  readonly key: string;
  readonly section: string;
  readonly sectionOrder: number;
  readonly label: string;
  readonly order: number;
};

/**
 * Which trades usually did the work a row inspects, by TradeType label
 * (Admin → Trade types). Used only to put the likely tradie first when an
 * issue is raised; every other tradie on the job is still offered.
 */
const TRADES = {
  surfaces: [
    "Plastering",
    "Gyprock",
    "Painting",
    "Carpentry",
    "Fit-out Carpentry",
    "Interior Fit-out",
  ],
  floors: ["Flooring", "Tiling", "Carpentry"],
  electrical: ["Electrician", "Lighting"],
  electricalFans: ["Electrician", "Lighting", "HVAC"],
  openings: ["Windows & Doors", "Glazing", "Carpentry", "Fit-out Carpentry"],
  furnishings: ["Windows & Doors", "Interior Fit-out", "Fit-out Carpentry"],
  joinery: [
    "Joinery",
    "Kitchen Installation",
    "Fit-out Carpentry",
    "Interior Fit-out",
  ],
  hvac: ["HVAC"],
  plumbing: ["Plumbing"],
  appliances: ["Kitchen Installation", "Electrician", "Plumbing"],
  wetAreas: ["Plumbing", "Tiling", "Waterproofing", "Glazing"],
  stairs: ["Carpentry", "Fit-out Carpentry"],
  externalWalls: ["Bricklaying", "Masonry", "Painting"],
  roofDrainage: ["Roofing", "Metal Roofing", "Plumbing"],
  fencing: ["Landscaping", "Masonry", "Concrete"],
  landscaping: ["Landscaping"],
  none: [],
} as const satisfies Record<string, readonly string[]>;

type TradeGroup = keyof typeof TRADES;

const WALLS = "Walls, ceiling, skirting and cornices";
const WALLS_ROBES =
  "Walls, ceiling, skirting and cornices, including robes/shelves";
const WINDOWS =
  "Windows, doors, screens, frames and window sills, including tracks and mirrors";
const FURNISHINGS = "Window and door furnishings";
const LIGHTS_FANS = "Light fittings, GPO’s, fans";
const LIGHTS_GPOS = "Light fittings, GPO’s";
const AC = "A/C or heater filters, wall filters";

/**
 * The handover inspection, transcribed from the client's
 * "RC Handover Checklist.docx". The source prints two columns of rooms side
 * by side; they are read here as one sequence, left column first, and blank
 * spacer rows are dropped. Labels are the source's exact wording.
 */
const HANDOVER_SECTIONS: ReadonlyArray<{
  readonly section: string;
  readonly items: ReadonlyArray<readonly [label: string, trades: TradeGroup]>;
}> = [
  {
    section: "Entry",
    items: [
      ["Front screen door", "openings"],
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      ["Light fittings", "electrical"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
    ],
  },
  {
    section: "Hallway",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      ["Light fittings", "electrical"],
      ["Smoke detectors", "electrical"],
      [FURNISHINGS, "furnishings"],
      ["Storage/cupboards", "joinery"],
    ],
  },
  {
    section: "Lounge",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_FANS, "electricalFans"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
      [AC, "hvac"],
    ],
  },
  {
    section: "Dining",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_FANS, "electricalFans"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
      [AC, "hvac"],
    ],
  },
  {
    section: "Family",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_FANS, "electricalFans"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
      [AC, "hvac"],
    ],
  },
  {
    section: "Kitchen",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_GPOS, "electrical"],
      [WINDOWS, "openings"],
      ["Cupboards, benchtops", "joinery"],
      ["Sink, plugs and plugholes", "plumbing"],
      [
        "All appliances, including stove/cooktop/oven, rangehood, dishwasher, insinkerator, etc",
        "appliances",
      ],
    ],
  },
  {
    section: "Main bed",
    items: [
      ["Walls, ceiling, skirting and cornices, including WIR", "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_FANS, "electricalFans"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
      [AC, "hvac"],
    ],
  },
  {
    section: "Bathrooms, en-suites, and toilets",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      ["Light fittings, GPO’s, exhaust fans", "electricalFans"],
      [WINDOWS, "openings"],
      [FURNISHINGS, "furnishings"],
      ["Vanity, cupboards, drawers and shelving", "joinery"],
      ["Shower cubicles, baths, spas and toilets", "wetAreas"],
    ],
  },
  ...(["Bed 2", "Bed 3", "Bed 4", "Bed 5/Study", "Other Rooms"] as const).map(
    (section) => ({
      section,
      items: [
        [WALLS_ROBES, "surfaces"],
        ["Floors", "floors"],
        [LIGHTS_FANS, "electricalFans"],
        [WINDOWS, "openings"],
        [FURNISHINGS, "furnishings"],
        [AC, "hvac"],
      ] as const,
    }),
  ),
  {
    section: "Patio/verandah",
    items: [
      [WALLS, "surfaces"],
      ["Floors/deck", "floors"],
      [LIGHTS_FANS, "electricalFans"],
      ["Stairs and rails", "stairs"],
    ],
  },
  {
    section: "Garden shed or storage",
    items: [
      [WALLS, "surfaces"],
      ["Floors", "floors"],
      [LIGHTS_GPOS, "electrical"],
      [
        "Windows, doors, screens, frames and window sills including tracks",
        "openings",
      ],
    ],
  },
  {
    section: "External house",
    items: [
      ["Walls", "externalWalls"],
      [
        "Eves, gutters on lowset residences, downpipes and stormwater drain",
        "roofDrainage",
      ],
      [LIGHTS_GPOS, "electrical"],
      ["Windows, doors and screens", "openings"],
      ["Fencing, gates, handrails and retaining walls", "fencing"],
      ["Yard and gardens", "landscaping"],
    ],
  },
  {
    section: "Other",
    items: [["Bins", "none"]],
  },
];

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/’/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const HANDOVER_TRADES = new Map<string, readonly string[]>();

const HANDOVER_ITEMS: readonly ChecklistTemplateItem[] = (() => {
  const items: ChecklistTemplateItem[] = [];
  HANDOVER_SECTIONS.forEach(({ section, items: rows }, sectionOrder) => {
    for (const [label, trades] of rows) {
      const key = `${slug(section)}.${slug(label)}`;
      items.push({
        key,
        label,
        order: items.length,
        section,
        sectionOrder,
      });
      HANDOVER_TRADES.set(key, TRADES[trades]);
    }
  });
  return items;
})();

/** The rows a template copies onto a new checklist. */
export function templateItems(
  templateKey: string,
): readonly ChecklistTemplateItem[] {
  return templateKey === HANDOVER_TEMPLATE_KEY ? HANDOVER_ITEMS : [];
}

/** The trades that usually did the work one row inspects. */
export function tradesForItem(templateKey: string, itemKey: string) {
  if (templateKey !== HANDOVER_TEMPLATE_KEY) return [];
  return HANDOVER_TRADES.get(itemKey) ?? [];
}

export type ChecklistDefinition = {
  readonly number: number;
  readonly stage: ProjectStage;
  readonly templateKey: string;
  readonly title: string;
};

/** What checklist N is, before it exists as a row. */
export function checklistDefinition(number: number): ChecklistDefinition {
  const stage = CHECKLIST_STAGES[number - 1];
  if (!stage) throw new RangeError(`There is no checklist ${number}.`);
  if (stage === ProjectStage.Final) {
    return {
      number,
      stage,
      templateKey: HANDOVER_TEMPLATE_KEY,
      title: "Handover Checklist",
    };
  }
  return {
    number,
    stage,
    templateKey: EMPTY_TEMPLATE_KEY,
    title: `${PROJECT_STAGE_LABELS[stage]} Checklist`,
  };
}

/** The checklist a stage's "Verify checklist" button opens. */
export function checklistNumberForStage(stage: ProjectStage): number {
  return CHECKLIST_STAGES.indexOf(stage) + 1;
}
