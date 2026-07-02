export type OfferSequenceMapping = {
  readonly taskName: string;
  readonly buildingSequenceTasks: readonly string[];
  readonly offerTenderWording: string;
  readonly tradesToBook: readonly string[];
  readonly milestoneStages: readonly string[];
};

type OfferSequenceMappingTuple = readonly [
  taskName: string,
  buildingSequenceTasks: readonly string[],
  offerTenderWording: string,
  tradesToBook: readonly string[],
  milestoneStages: readonly string[],
];

const OFFER_SEQUENCE_MAPPING_ROWS = [
  ["GENERAL REQUIREMENTS", [], "Comprehensive on-site project management, dedicated builder supervision, and HBCF home warranty insurance.", [], []],
  ["Plans & Specifications Architect or Draftsman", [], "Architectural drafting, planning design, and final site working plans/elevations.", [], []],
  ["Basix/nathers", [], "BASIX energy assessment, thermal comfort analysis, and NatHERS energy ratings compliance.", [], []],
  ["Permits: Zoning, Building, Environemental, CDC Certifier Other", ["Sydney Water co-ordinator Inspection", "Certifier Inspection", "Follow Up Certificates Issued (Slab prep)", "Certifier conducts inspection for stormwater plumbing", "Follow Up Certificates Issued (Stormwater)", "Frame Inspection Certifier", "Follow Up Certificates Issued (Frame)", "Waterproofing Inspection", "Follow Up Certificates Issued (Waterproofing)", "Council driveway inspection", "Final inspection"], "Council DA/CDC development submissions, certifier consultation, environmental site controls, and execution of mandatory critical stage building inspections.", ["Builder / Coordinator", "Certifier / Builder", "Certifier / Inspector", "Certifier / Waterproofer", "Council Inspector"], ["(2) Slab 15%", "(3) Frame 25%", "(5) Interior Fit 20%", "(6) Final 10%"]],
  ["Survey", ["Surveyor comes to do peg out survey", "Final Survey"], "Licensed surveyor site peg-out boundary checks and post-construction final identification surveys.", ["Surveyor"], ["(1) Deposit 5%", "(6) Final 10%"]],
  ["Engineering Fees", ["Engineer Inspection (Slab pre-pour)", "Engineer Inspection (Slab steel)", "Frame Inspection Engineer"], "Structural engineering drawings, concrete slab engineering certifications, and critical pre-pour engineering site inspections.", ["Engineer"], ["(2) Slab 15%", "(3) Frame 25%"]],
  ["Council Costs", [], "Payment of municipal development application fees, environmental fees, and long service levies.", [], []],
  ["Legal Fees", [], "Builder contract preparation, statutory documentation review, and administrative setup fees.", [], []],
  ["Long Serivce Fee", [], "Mandatory Long Service Leave Levy contributions paid prior to construction commencement.", [], []],
  ["Home Warranty Insurance", [], "Provision of Home Building Compensation Fund (HBCF) insurance certificate cover.", [], []],
  ["Other", [], "Sundry statutory authority compliance fees and planning adjustments.", [], []],
  ["ON-SITE WATER/SEWER/SYDNEY WATER APPROVAL", ["Sydney Water co-ordinator Inspection"], "Sydney Water sewer connections coordinator checks and tap-in compliance approvals.", ["Sydney Water"], ["(2) Slab 15%"]],
  ["SLAB", ["Piering & Pouring", "Steel reinforcement", "Formwork Check", "Slab gets poured"], "Excavation, structural piering, perimeter timber formwork, steel reinforcement mesh laying, concrete pump hire, and pouring of H1-class structural slab.", ["Concretor"], ["(2) Slab 15%"]],
  ["DROP EDGE BEEM", [], "Structural drop edge beams designed to contain the foundation on sloping site sections.", [], []],
  ["PEST CONTROL After Pier and Before Frame x2", ["Termite pipe penetration", "Termite Barrier", "Termite Guys Book to Glue"], "Pest control protections including slab penetration pipe collars, perimeter chemical termite barrier system, and perimeter timber brick-junction glue seals.", ["Pest Control (Booking 1 of 3)", "Pest Control (Booking 2 of 3)", "Pest Control (Booking 3 of 3)"], ["(2) Slab 15%", "(3) Frame 25%", "(4) Lock Up 25%"]],
  ["FRAME", ["Frame", "Eaves", "Timbers for Vanities + Cavities"], "Prefabricated timber structural wall frames, floor joists system (double-story), structural roof trusses, cavity sliding frames, vanity timber wall framing support, and FC eaves linings.", ["Frame (Booking 1 of 1)"], ["(3) Frame 25%"]],
  ["STEEL", ["Steel reinforcement"], "Supply, delivery, and installation of structural steel beams, posts, columns, and structural window lintels.", [], []],
  ["WINDOW", ["Windows", "Window Glazing"], "Residential aluminium lockable window frames, sliding glass doors, window glazing, insect mesh screens, and sliding security door screens.", ["Windows & Door (Booking 1 of 3)", "Windows & Door (Booking 2 of 3)"], ["(3) Frame 25%", "(4) Lock Up 25%"]],
  ["TEMPORARY FENCE", ["Fence & Sedimentation Booking"], "Delivery, hire, and erection of temporary site security fencing and mandatory sedimentation control fencing.", ["Builder / Coordinator"], ["(1) Deposit 5%"]],
  ["ROOFING", ["Roof"], "Colorbond corrugated metal roofing sheets over structural framing with safety roof guardrail protection.", ["Metal Roofing"], ["(4) Lock Up 25%"]],
  ["BRICK LAYER MATERIAL WITH BARS", ["Order Bricks"], "Selection, procurement, and delivery of PGH face bricks or render-grade common bricks with structural reinforcing bars.", ["Builder / Procurement"], ["(3) Frame 25%"]],
  ["COMMON BRICK / FACE BRICK", [], "Allowance for premium exterior face bricks or structural common brick supply.", [], []],
  ["BRICK LAYER", ["Brick laying", "Brick Joint Silicone + Window Angles"], "Perimeter bricklaying, brick wall ties, damp proof course (DPC) installation, joint mortar tooling, external gap caulking, and window galvanised steel angle irons.", ["Brick Layer", "Brick Layer / Caulker"], ["(4) Lock Up 25%"]],
  ["BRICK WASH", ["Brick Wash"], "High-pressure acid cleaning of all external perimeter brickwork walls.", ["Brick Layer / Washer"], ["(4) Lock Up 25%"]],
  ["PLUMBER", ["Internal Plumbing (underground)", "Stormwater plumbing", "Plumbing Schedule (hot, cold, stack work)", "Final plumbing fit out"], "Underground sewer connections, stormwater pipe layout, hot and cold internal plumbing line rough-ins, sewer waste stacks, and final vanity/kitchen sanitaryware fit-off.", ["Builder / Coordinator", "Plumber (Booking 1 of 3)", "Plumber (Booking 2 of 3)", "Plumber (Booking 3 of 3)"], ["(2) Slab 15%", "(3) Frame 25%", "(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["ELECTRICAL", ["Apply for Electricity Connection", "Electrical Level 2 Work", "Electrical wiring schedule", "Camera wiring (if applicable)"], "Three-phase underground mains setup, electrical meter box installation, level 2 electrical connection works, internal wiring rough-in, NBN conduit prep, and camera wiring.", ["Electrician (Booking 1 of 3)", "Electrician (Booking 2 of 3)", "Electrician / Security"], ["(3) Frame 25%", "(4) Lock Up 25%"]],
  ["SCAFFOLDING", ["Scaffolding (If double story)"], "Hire, transport, and erection of external perimeter safety scaffolding to meet WorkCover requirements on multi-level structures.", ["Scaffolding"], ["(3) Frame 25%"]],
  ["INSULATION", ["Insulation"], "High-density thermal and acoustic insulation wall and ceiling batts installed in accordance with BASIX specifications.", ["Interior Fit Out (Insulation)"], ["(5) Interior Fit 20%"]],
  ["GYPROCK / BULKHEAD", ["Gyprock", "Sanding"], "Supply and hanging of 13mm plasterboard to walls, 10mm plasterboard to ceilings, cornice application, joint setting, and high-finish sanding.", ["Gyprock (Plasterer)"], ["(5) Interior Fit 20%"]],
  ["STAIRS IF APPLICABLE", ["Select stairs", "Stairs (If double story)"], "Custom MDF internal staircase construction with glass balustrade detailing.", ["Fit out Carpenter", "Fit out Carpenter / Client"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["WATERPROOFING", ["Waterproofing"], "Wet-area waterproofing membranes applied to all bathroom, ensuite, and laundry floors and walls, with structural compliance certification.", ["Waterproofer"], ["(5) Interior Fit 20%"]],
  ["DOORS AND LOCKS", ["Door & handle selection", "Doors + Carpet Skirting if applicable"], "Heavy-duty external entry door frame, external laundry doors, hollow/semi-solid internal doors, handle levers, and privacy latches.", ["Client Selection", "Fit out Carpenter"], ["(5) Interior Fit 20%"]],
  ["CARPENTER", ["Select Skirting/Cornice/Pelmets/Architraves", "Wet Areas Architraves"], "Fixing carpentry including pre-primed pine skirting boards, door architraves, window liners, pelmets, and bathroom/laundry trims.", ["Carpenter", "Client Selection", "Fit out Carpenter"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["AIR CONDITIONING", ["Aircon rough-in", "Aircon Machine"], "Daikin 16kW ducted reverse-cycle multi-zone air conditioning system rough-in and outdoor condenser unit commission.", ["Electrician / HVAC"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["GARAGE DOOR", ["Garage door to be selected and ordered", "Garage Door"], "Colorbond sectional overhead automated panel-lift garage door with dual remote-control handsets.", ["Windows & Door", "Windows & Door (Booking 3 of 3)"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["RENDERING", [], "Acrylic rendering finishes applied to selected areas of front facade as per plans.", [], []],
  ["TILES", ["Tiles to be selected and ordered before insulation"], "Client wet-area tile select allowance prior to tiler booking.", ["Client / Tiler"], ["(4) Lock Up 25%"]],
  ["TILING", ["Tiling"], "Tiling works including wet area waterproofing preps, bathroom floor-to-ceiling tiling, laundry, front porch, and tiled alfresco areas.", ["Tiler"], ["(5) Interior Fit 20%"]],
  ["SAND AND CEMENT FOR TILING", [], "Delivery of raw materials for wet-area tiler screeding beds.", [], []],
  ["TILE ANGLE", [], "Supply and installation of aluminium or brass tile angles on tiled terminations.", [], []],
  ["BALCONY AND VOIDS", [], "Structural balcony sub-floor setup, waterproofing, tiling, and glass/stainless steel balustrades to void openings.", [], []],
  ["PC ITEMS INSPIRE", ["PC items selected and ordered before plumbing schedule"], "Selection and procurement of major bathroom/kitchen sanitary fixtures (baths, toilets, basins, and tapware).", ["Client Selection"], ["(4) Lock Up 25%"]],
  ["LIGHT ITEMS", ["Electrician installs all lights"], "Final electrical fit-off including downlight fittings, GPOs, light switches, and safety smoke alarm testing.", ["Electrician (Booking 3 of 3)"], ["(5) Interior Fit 20%"]],
  ["PAINTER", ["Select paint colour for eaves internal & external", "Paint Eaves", "Painting", "Floor Board Skirting Painting (if applicable)"], "Taubmans 3-coat paint system applied to all internal walls, ceilings, timber doors, window architraves, skirting boards, and external eaves.", ["Client / Painter", "Painter", "Painter / Interior Fit Out"], ["(3) Frame 25%", "(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["WARDROBES", ["Wardrobes"], "Custom built-in bedroom wardrobes and walk-in-robe fit-outs with melamine shelves, hanging rails, and sliding glass panel doors.", ["Windows & Door / Wardrobe"], ["(5) Interior Fit 20%"]],
  ["SHOWER", ["Shower & Wardrobe Measurements", "Showers"], "Semi-frameless shower screens, shower floor base niches, and screen layout measurements.", ["Windows & Door / Glazier", "Windows & Door / Wardrobe"], ["(5) Interior Fit 20%"]],
  ["FLOORING", ["Select flooring", "Floor Board (if applicable)"], "Internal flooring installation including ground floor large-format tiles, first-floor laminate boards, and staircase flooring.", ["Client Selection", "Flooring Installer / Fit Out"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["HOT WATER GAS SYSTEM", ["Apply for Gas connection"], "Supply and installation of continuous-flow gas hot water system (HWS).", ["Plumber / Builder"], ["(3) Frame 25%"]],
  ["KITCHEN", ["Kitchen design + joinery + appliances to order and be finished", "Joinery Measurement", "Kitchen & Joinery installation"], "Custom kitchen and Butler's pantry joinery, cabinetry design, measurement, and final cupboard installation.", ["Grade Joinery"], ["(4) Lock Up 25%", "(5) Interior Fit 20%"]],
  ["KITCHEN & BATH STONE", [], "40mm premium stone benchtops with waterfall edges to kitchen island bench, pantry, and wet-area vanities.", [], []],
  ["APPLIANCES", [], "Westinghouse appliance package including 900mm cooktop, rangehood, 600mm oven, and dishwasher.", [], []],
  ["SILICON", [], "Color-matched sealant detailing to tiling expansion joints, kitchen splashbacks, and wet area fixtures.", [], []],
  ["DRIVEWAY", ["Driveway steel reinforcement", "Driveway gets poured"], "Excavation, base compaction, steel mesh reinforcing, and coloured plain concrete driveway pour.", ["Concretor"], ["(6) Final 10%"]],
  ["BINS", [], "Continuous skip bin hire and site rubbish clearing throughout construction.", [], []],
  ["FRONT PILLAR", [], "Construction and finish detailing of brick or rendered front boundary piers.", [], []],
  ["CENTER VACUUM", [], "Provision and pipeline rough-in for built-in central ducted vacuum system.", [], []],
  ["CLADDING", [], "Lightweight first-floor architectural wall cladding panels.", [], []],
  ["SPLASHBACK", [], "Kitchen splashback wall tiling or stone matching benchtops.", [], []],
  ["GRANNY Flat if Applicable", [], "Attached granny flat build concurrent with main structure.", [], []],
  ["FACADE", [], "Delivery of rendered front facade elevations as per chosen options.", [], []],
  ["SAMSUNG DOOR LOCK", [], "Samsung digital electronic lock fitting to front entry door.", [], []],
  ["RAIN WATER TANK", [], "Supply and installation of rainwater tank with stormwater connections.", [], []],
  ["EXCAVATION CLEAN SITE DURNING CONSTRUCTION", ["Cut & Fill - Concretor (Land Leveling)"], "Site clearing, mechanical machine earthworks, cut/fill levels, and soil cartage.", ["Concretor"], ["(2) Slab 15%"]],
  ["CLEANER", [], "Complete final commercial professional interior/exterior builder's clean before client walk-through.", [], []],
  ["BLINDS IF APPLICABLE", [], "Supply and installation of custom-fit internal window roller blinds.", [], []],
  ["POOL IF APPLICABLE", [], "Structural pool shell excavation, plumbing connection, and steel reinforcement installation.", [], []],
  ["LANDSCPING IF APPLICABLE", ["Landscaping & fencing"], "Soft landscaping including site leveling, garden beds, turf, and retaining walls.", ["Landscaper / Fencer"], ["(6) Final 10%"]],
  ["FENCE IF APPLICABLE", ["Landscaping & fencing"], "Erection of timber or colorbond boundary fencing.", [], []],
  ["BUNNING / MISC", [], "Flexible contingency material purchases and site consumables.", [], []],
  ["WEBSITE / MARKETING", [], "Royal Constructions corporate head-office administrative and marketing costs.", [], []],
  ["TEMPORARY CAMERA", [], "Installation of active on-site mobile security surveillance cameras.", [], []],
  ["Builder Licence Fees", [], "NSW Builder licensing and regulatory compliance costs.", [], []],
  ["Adminstrative Costs", [], "Head office administrative processing, contracts development, and project operations.", [], []],
  ["LABOUR COST", [], "Direct project carpentry and frame erection labour crews.", [], []],
] as const satisfies readonly OfferSequenceMappingTuple[];

export const OFFER_SEQUENCE_MAPPINGS: readonly OfferSequenceMapping[] =
  OFFER_SEQUENCE_MAPPING_ROWS.map(
    ([
      taskName,
      buildingSequenceTasks,
      offerTenderWording,
      tradesToBook,
      milestoneStages,
    ]) => ({
      taskName,
      buildingSequenceTasks,
      offerTenderWording,
      tradesToBook,
      milestoneStages,
    }),
  );

function normalizeTaskName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getOfferSequenceMappingByTask(
  taskName: string,
): OfferSequenceMapping | null {
  const normalizedTaskName = normalizeTaskName(taskName);

  return (
    OFFER_SEQUENCE_MAPPINGS.find(
      (mapping) => normalizeTaskName(mapping.taskName) === normalizedTaskName,
    ) ?? null
  );
}

export type OfferSequenceMappingStats = {
  readonly totalTasks: number;
  readonly sequenceLinkedTasks: number;
  readonly projectHandoffTasks: number;
};

export function getOfferSequenceMappingStats(
  mappings: readonly OfferSequenceMapping[],
): OfferSequenceMappingStats {
  return {
    totalTasks: mappings.length,
    sequenceLinkedTasks: mappings.filter(
      (mapping) => mapping.buildingSequenceTasks.length > 0,
    ).length,
    projectHandoffTasks: mappings.filter(
      (mapping) =>
        mapping.tradesToBook.length > 0 || mapping.milestoneStages.length > 0,
    ).length,
  };
}
