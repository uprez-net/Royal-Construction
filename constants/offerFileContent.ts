// ─── Static data objects (edit here for future changes) ─────────────────────

export const COMPANY_INFO = {
    name: "Royal Constructions Pty Ltd",
    licenceNo: "383992C",
    accreditation: "MBA Accredited",
    website: "royalconstructions.com.au",
    tagline: "Builder · South West Sydney",
    director: "Gurpinder Singh Uppal — Director",
    directorRole: "Director, Royal Constructions",
};

export const PROMOTIONAL_PACKAGE = {
    amount: "$50,000",
    label: "OF PREMIUM UPGRADES INCLUDED IN YOUR FIXED PRICE",
    inclusionCreditAmount: "$6,000",
    inclusionCreditLabel:
        "Inclusion Credit — spend it on any item in the house or upgrade your kitchen stone selection",
    upgradeValueLabel: "Upgrade value added",
    youSaveLabel: "You save",
    netPriceLabel: "Net price increase",
};

export const FIXED_PRICE_INCLUDES_ITEMS = [
    "Main dwelling — double storey (approx 34 sq)",
    "Attached 2-bedroom granny flat (approx 6 sq)",
    "Working drawings, site plan and elevations",
    "Site survey by licensed surveyor",
    "Soil test by geotechnical engineer",
    "Structural engineering certification",
    "BASIX certificate",
    "CDC or CC certification managed by us",
    "Council contributions and statutory fees",
    "NSW Long Service Levy",
    "HBCF Home Warranty Insurance",
    "Occupation Certificate on completion",
    "Statutory home warranty (NSW Home Building Act)",
    "Site preparation, levelling and excavation",
    "Engineer-designed concrete slab (M or H1 class)",
    "Full service connections within property boundary for Both",
    "Temporary site fencing and sediment control",
];

export const TIMELINE_STAGES = [
    {
        stage: "Tender Authority signed",
        description:
            "$5,000 design deposit (fully credited to build) — locks in your build slot and starts the design process",
    },
    {
        stage: "Site survey & soil test",
        description: "1–2 weeks. We arrange surveyor and geotechnical engineer.",
    },
    {
        stage: "Concept design",
        description:
            "2–4 weeks. Floor plans drafted to suit your block — incorporating the void, outdoor kitchen and revised layout agreed in our meeting.",
    },
    {
        stage: "Design refinement",
        description: "2–4 weeks. Up to 3 rounds of revisions until you are happy.",
    },
    {
        stage: "Final plans & engineering",
        description:
            "4–6 weeks. Structural engineering, void design confirmed, and final drawings.",
    },
    {
        stage: "Fixed-price contract",
        description: "MBA Building Contract signed. 5% contract deposit.",
    },
    {
        stage: "CDC / Council approval",
        description: "6–10 weeks via private certifier (CDC pathway preferred).",
    },
    {
        stage: "Pre-construction",
        description:
            "4 weeks. Colour selections, $6,000 credit applied, trades booked, materials ordered.",
    },
    {
        stage: "Construction",
        description:
            "8–10 months. Standard MBA payment milestones (slab, frame, lock-up, fixing, completion).",
    },
    {
        stage: "Practical completion & handover",
        description: "Final inspection, defects walk-through, keys handed over.",
    },
];

export const TIMELINE_FOOTNOTE =
    "Total project: approximately 10–14 months from today to handover, subject to council approval timing and site conditions.";

export const NEXT_STEPS = [
    {
        title: "Review this proposal",
        description:
            "Take it home, review the full inclusions and the upgrade package. Call us with any questions — we are always available.",
    },
    {
        title: "Sign the Tender Authority",
        description:
            "Pay the $5,000 design deposit to lock in your build slot and this promotional pricing. Fully credited toward your final contract.",
    },
    {
        title: "We get to work",
        description:
            "Site survey and soil test arranged within two weeks. Concept design begins immediately, incorporating the void and all agreed upgrades from our meeting.",
    },
];

export const NOTES_AND_TERMS = [
    {
        title: "Indicative Pricing",
        body: "This proposal provides indicative pricing based on the scope agreed and Royal Constructions' completed projects of similar size and specification. The final fixed-price contract will be confirmed following site survey and soil classification, final concept and detailed plans approved by you, engineering design, and certifier pre-lodgement review.",
    },
    {
        title: "Site Cost Allowance",
        body: "Our proposal includes a site cost allowance suitable for a standard residential block. If soil classification returns P-class or worse, or if unusual site conditions emerge (rock, sloping land, easements, existing structures), additional site costs may apply. These are always flagged transparently before contract signing.",
    },
    {
        title: "Validity",
        body: "This proposal and the $50,000 promotional upgrade package are valid for 28 days from the original proposal date. Pricing is subject to material cost movements beyond that period.",
    },
    {
        title: "Void Design",
        body: "The void above the family and kitchen area is included in the scope. Exact void dimensions, structural treatment and balustrade design will be confirmed during the concept design phase with your architect. Void area is not counted as additional floor area.",
    },
    {
        title: "Solar System",
        body: "13kW solar system with battery-ready inverter is included. Panel layout, inverter brand, and system configuration to be confirmed at the colour and specification selection stage to suit your roof orientation.",
    },
    {
        title: "$6,000 Inclusion Credit",
        body: "The $6,000 credit may be applied toward any item in the inclusions schedule, a kitchen stone upgrade, or any other specification upgrade of your choice. Credit is confirmed at the colour selection stage before contract.",
        highlight: true,
    },
    {
        title: "Insurance & Warranty",
        body: "Your build is fully protected by HBCF Home Warranty Insurance, our 6-year statutory structural warranty under the NSW Home Building Act, and public liability and construction insurance throughout the build.",
    },
];

export const ACCEPTANCE_BODY = (customerName: string, siteLocation?: string) =>
    `I, ${customerName}, accept this revised proposal in principle and wish to proceed to the Tender Authority and design phase${siteLocation ? ` for the build at ${siteLocation}` : ""}.`;

export const SAMPLE_WELCOME_MESSAGE = `
Thank you for your time today — it was a great meeting and we are genuinely excited to get this
project moving for you and your family.
Following our discussion, this revised proposal captures everything we agreed on. The scope has
grown in all the right ways — a larger home at 40 squares, a more generous first-floor layout, the
void over the family area, an outdoor kitchen, solar, and a number of thoughtful specification
upgrades that make a real difference to everyday living.
The price moves from $750,000 to $770,000 — a $20,000 increase that we have absorbed the
majority of, passing on $40,000 in upgrade value for that $20,000 step up. The granny flat remains
unchanged.
We look forward to starting the design and building a home that your family will love.
`

export const SAMPLE_REVISION_CHANGES = {
    description: `
    The following upgrades were agreed and are included in the revised fixed price of $770,000
    (increased from $750,000). All changes apply to the main house only — the granny flat remains
    unchanged.
  `,
    valueAdded: 40000,
    youSave: 20000,
};

export const SAMPLE_TERMS_AND_CONDITIONS = [
    "This proposal is valid for 28 days from the proposal date. To proceed, please sign the attached Tender Authority and pay the $5,000 design deposit.",
    "The final fixed-price contract will be confirmed following site survey and soil classification, final concept and detailed plans approved by you, engineering design, and certifier pre-lodgement review.",
    "Our proposal includes a site cost allowance suitable for a standard residential block. If soil classification returns P-class or worse, or if unusual site conditions emerge (rock, sloping land, easements, existing structures), additional site costs may apply. These are always flagged transparently before contract signing.",
    "The void above the family and kitchen area is included in the scope. Exact void dimensions, structural treatment and balustrade design will be confirmed during the concept design phase with your architect. Void area is not counted as additional floor area.",
    "13kW solar system with battery-ready inverter is included. Panel layout, inverter brand, and system configuration to be confirmed at the colour and specification selection stage to suit your roof orientation.",
    "The $6,000 inclusion credit may be applied toward any item in the inclusions schedule, a kitchen stone upgrade, or any other specification upgrade of your choice. Credit is confirmed at the colour selection stage before contract.",
    "Your build is fully protected by HBCF Home Warranty Insurance, our 6-year statutory structural warranty under the NSW Home Building Act, and public liability and construction insurance throughout the build.",
];

export const SAMPLE_PROJECT_SCOPE = [
    {   
        id: "1",
        sectionTitle: "Ground Floor",
        items: [
            "Open-plan family, kitchen and dining with void above",
            "Outdoor kitchen with built-in BBQ and sink, integrated into the alfresco area",
            "Master bedroom with walk-in robe and ensuite",
            "Two additional bedrooms with built-in robes",
            "Main bathroom with separate toilet",
            "Laundry with external access",
            "Double garage with internal access to the house",
        ],
    },
    {
        id: "2",
        sectionTitle: "First Floor",
        items: [
            "Large rumpus room overlooking the void",
            "Generous second master bedroom with walk-in robe and ensuite",
            "Study nook overlooking the void",
            "Spacious balcony overlooking the backyard, accessible from the rumpus and second master bedroom",
        ],
    },
    {
        id: "3",
        sectionTitle: "External",
        items: [
            "Landscaping to front and back yards, including turf, planting and irrigation",
            "Driveway and pathways in exposed aggregate concrete",
            "Covered alfresco area with ceiling fan and downlights, integrated with the outdoor kitchen",
        ],
    },
    {
        id: "4",
        sectionTitle: "Granny Flat",
        items: [
            "Two-bedroom attached granny flat with open-plan living, kitchen and dining",
            "Ensuite bathroom and walk-in robe in the master bedroom",
            "Second bathroom with shower, toilet and vanity",
            "Separate laundry area with external access",
        ],
    }
]

export const SAMPLE_PREMIUM_UPGRADES = [
    "2,700mm ceiling heights throughout",
    "Engineered timber flooring in living areas and bedrooms",
    "Stone benchtops in kitchen and bathrooms",
    "Soft-close cabinetry throughout",
    "Premium tapware and fixtures",
    "LED downlights throughout",
    "Semi Solid internal doors for both dwelling ",
    "$6,000 inclusion credit — use toward any inclusion, kitchen stone or upgrade of your choice"
]