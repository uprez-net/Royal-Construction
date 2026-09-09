import {
  ComplianceAlertType,
  CompliancePartyType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";

/**
 * The documents the certifier is sent before anything else can happen.
 *
 * One ordered list, read by four places that would otherwise drift apart: the
 * discovery modal iterates it, the classifier prompt enumerates it, the
 * outreach email attaches it, and the final page groups by it. Order is the
 * order the discovery loop asks for them in — it follows how a job is actually
 * assembled, title first and the full design last.
 */
export const REQUIRED_COMPLIANCE_DOCUMENTS = [
  { type: ComplianceDocumentType.DEPOSITED_PLAN, label: "Deposited Plan" },
  {
    type: ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
    label: "Title Search Detail & Level",
  },
  { type: ComplianceDocumentType.SURVEY, label: "Survey" },
  {
    type: ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    label: "Preliminary architectural plans",
  },
  {
    type: ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    label: "Section 10.7(2) & (5) Planning Certificate",
  },
  {
    type: ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    label: "Full architectural design",
  },
] as const satisfies readonly {
  type: ComplianceDocumentType;
  label: string;
}[];

export type RequiredComplianceDocument =
  (typeof REQUIRED_COMPLIANCE_DOCUMENTS)[number];

export type RequiredComplianceDocumentType = RequiredComplianceDocument["type"];

/**
 * The required pack, split by who actually supplies it.
 *
 * The list above is one flat set because that is what the certifier is sent and
 * what the classifier, the outreach and the final page all read. But nothing
 * assembles it in one go: three of the six come from a surveyor, two from an
 * architect, and one from the council — and the second and third cannot start
 * until the first has landed. An architect cannot draw against a site with no
 * survey, and a 10.7 certificate is ordered off the deposited plan.
 *
 * So the tab groups by supplier and gates each group on the one before it. The
 * types are taken from REQUIRED_COMPLIANCE_DOCUMENTS rather than restated, and
 * the exhaustiveness check below is what stops a seventh required document
 * being added to that list and quietly appearing in no section at all.
 */
export const COMPLIANCE_PARTY_SECTIONS = [
  {
    party: CompliancePartyType.SURVEYOR,
    heading: "Surveyor documents",
    description: "Ordered from the surveyor. Everything else waits on these.",
    types: [
      ComplianceDocumentType.DEPOSITED_PLAN,
      ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
      ComplianceDocumentType.SURVEY,
    ],
  },
  {
    party: CompliancePartyType.ARCHITECT,
    heading: "Architect documents",
    description: "Drawn against the survey, preliminary through to full.",
    types: [
      ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
      ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    ],
  },
  {
    party: CompliancePartyType.COUNCIL,
    heading: "Council certificate",
    description: "The planning certificate for the lot, from the NSW portal.",
    types: [ComplianceDocumentType.PLANNING_CERTIFICATE_10_7],
  },
] as const satisfies readonly {
  party: CompliancePartyType;
  heading: string;
  description: string;
  types: readonly RequiredComplianceDocumentType[];
}[];

export type CompliancePartySection = (typeof COMPLIANCE_PARTY_SECTIONS)[number];

/**
 * Every required document sits in exactly one section.
 *
 * A compile-time check rather than a test, because the failure it guards
 * against is silent: a required document in no section renders nowhere, is
 * chased by nobody, and still blocks the outreach that demands all six.
 */
type UnsectionedRequiredDocument = Exclude<
  RequiredComplianceDocumentType,
  CompliancePartySection["types"][number]
>;
type _EveryRequiredDocumentIsSectioned =
  UnsectionedRequiredDocument extends never
    ? true
    : ["Required document in no party section:", UnsectionedRequiredDocument];
// Referenced so the check is not dropped as unused. The assignment is what
// fails to compile when a required document has no section.
export const REQUIRED_DOCUMENTS_ARE_SECTIONED: _EveryRequiredDocumentIsSectioned = true;

/** Which party supplies a given required document, if any. */
const PARTY_BY_DOCUMENT_TYPE = new Map<
  ComplianceDocumentType,
  CompliancePartyType
>(
  COMPLIANCE_PARTY_SECTIONS.flatMap((section) =>
    section.types.map(
      (type) =>
        [type, section.party] as [ComplianceDocumentType, CompliancePartyType],
    ),
  ),
);

export function partyForDocumentType(
  documentType: ComplianceDocumentType,
): CompliancePartyType | null {
  return PARTY_BY_DOCUMENT_TYPE.get(documentType) ?? null;
}

/** The required documents one party is responsible for. */
export function documentTypesForParty(
  party: CompliancePartyType,
): readonly RequiredComplianceDocumentType[] {
  return (
    COMPLIANCE_PARTY_SECTIONS.find((section) => section.party === party)
      ?.types ?? []
  );
}

/**
 * Everything one party is asked to produce, pack or not.
 *
 * The superset of the above. `documentTypesForParty` answers a question about
 * the required pack and is what the prerequisite gates read; this answers "what
 * does the mail to this party ask for", which for a consultant is a document
 * that is not in the pack at all. Keeping them apart is what stops a BASIX
 * certificate becoming something the certifier outreach waits on.
 */
export function partyDeliverables(
  party: CompliancePartyType,
): readonly ComplianceDocumentType[] {
  return CONSULTANT_DELIVERABLES[party] ?? documentTypesForParty(party);
}

/**
 * The parties a stage waits on.
 *
 * One table rather than a chain of conditions at each call site, which is what
 * let the architect grow a second dependency without every gate having to be
 * found and edited.
 *
 * The architect waits on the council as well as the surveyor, and that is the
 * substantive change here rather than a tidy-up. An architect drawing before
 * the 10.7 certificate is in hand is drawing without knowing what the lot is
 * actually allowed to carry -- the zoning, the overlays, the bushfire and flood
 * designations are all on that certificate -- and the plans that come back get
 * redrawn once it arrives. The certificate is three to five days; a redraw is
 * three weeks.
 *
 * The council's own row is the exception to how this table is read. There is
 * nobody to engage there and no mail to send, so "has the council been dealt
 * with" is answered by the certificate being on the file rather than by an
 * outreach existing -- see `lib/compliance/prerequisites.ts`, which is the one
 * place that reads this.
 *
 * The consultants have no prerequisites of their own. They are not part of the
 * required pack at all: what gates them is a checklist line existing that asks
 * for what they produce, which is a fact about the checklist rather than about
 * another party.
 */
export const PARTY_PREREQUISITES: Readonly<
  Record<CompliancePartyType, readonly CompliancePartyType[]>
> = {
  [CompliancePartyType.SURVEYOR]: [],
  [CompliancePartyType.ARCHITECT]: [
    CompliancePartyType.SURVEYOR,
    CompliancePartyType.COUNCIL,
  ],
  [CompliancePartyType.COUNCIL]: [CompliancePartyType.SURVEYOR],
  [CompliancePartyType.BASIX_CONSULTANT]: [],
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: [],
  [CompliancePartyType.STRUCTURAL_ENGINEER]: [],
  [CompliancePartyType.WATER_AUTHORITY]: [],
  [CompliancePartyType.TRAFFIC_CONSULTANT]: [],
};

/**
 * The consultants engaged off a checklist line rather than off the pack.
 *
 * They differ from the three above in every way that matters to the flow: they
 * enter halfway through, against one item of a checklist the certifier issued,
 * and what they produce satisfies that item rather than becoming a document of
 * its own. Everything else -- the outreach, the token, the thread, the inbound
 * correlation, the overdue sweep -- is identical, which is why they are the
 * same enum and not a second one.
 */
export const CONSULTANT_PARTIES: readonly CompliancePartyType[] = [
  CompliancePartyType.BASIX_CONSULTANT,
  CompliancePartyType.BUSHFIRE_CONSULTANT,
  CompliancePartyType.STRUCTURAL_ENGINEER,
  CompliancePartyType.WATER_AUTHORITY,
  CompliancePartyType.TRAFFIC_CONSULTANT,
];

export function isConsultantParty(party: CompliancePartyType): boolean {
  return CONSULTANT_PARTIES.includes(party);
}

/**
 * What each consultant produces.
 *
 * The link that makes the whole arrangement work: an extracted checklist line
 * carries `mapsToType`, and if that type is one of these then the row knows
 * which consultant to offer, the outreach knows what to ask for, and the reply
 * knows which line it answers.
 *
 * A list per party rather than a single type, which is the change the
 * structural engineer forced. A BASIX consultant sends one certificate back; a
 * structural engineer is engaged once and answers three separate checklist
 * lines — the drawings and their design certificate, the hydraulic and
 * stormwater set and its certificate, and the geotechnical report. Each lands
 * separately and the certifier ticks each separately, so the engagement has to
 * be able to say it is waiting on three things rather than one.
 */
export const CONSULTANT_DELIVERABLES: Readonly<
  Partial<Record<CompliancePartyType, readonly ComplianceDocumentType[]>>
> = {
  [CompliancePartyType.BASIX_CONSULTANT]: [
    ComplianceDocumentType.BASIX_CERTIFICATE,
  ],
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: [
    ComplianceDocumentType.BUSHFIRE_REPORT,
  ],
  [CompliancePartyType.STRUCTURAL_ENGINEER]: [
    ComplianceDocumentType.STRUCTURAL_DRAWINGS,
    ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
    ComplianceDocumentType.GEOTECH_REPORT,
  ],
  [CompliancePartyType.WATER_AUTHORITY]: [
    ComplianceDocumentType.WATER_SERVICING_APPROVAL,
    ComplianceDocumentType.SECTION_73_NOTICE,
  ],
  [CompliancePartyType.TRAFFIC_CONSULTANT]: [
    ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
  ],
  // The architect is not a consultant party — they are engaged off the pack,
  // long before any of this — but the waste management plan is theirs and is
  // asked for the same way. It is deliberately absent from this table: adding
  // it would put the architect in CONSULTANT_PARTIES and unpick the
  // prerequisite chain the pack depends on. See WASTE_MANAGEMENT_PLAN_PARTY.
};

const CONSULTANT_BY_DELIVERABLE = new Map<
  ComplianceDocumentType,
  CompliancePartyType
>(
  Object.entries(CONSULTANT_DELIVERABLES).flatMap(([party, types]) =>
    (types ?? []).map(
      (type) =>
        [type, party as CompliancePartyType] as [
          ComplianceDocumentType,
          CompliancePartyType,
        ],
    ),
  ),
);

/**
 * Which consultant a checklist line needs, if any.
 *
 * Null is still the common answer — most checklist lines ask for something
 * already on the file or something the builder produces — but it is no longer
 * the overwhelming one. Between the two consultants, the structural engineer's
 * three, the water coordinator's two and the traffic plan, eight of the types
 * a checklist can name have somebody to ring.
 */
export function consultantForDocumentType(
  documentType: ComplianceDocumentType | undefined | null,
): CompliancePartyType | null {
  if (!documentType) return null;
  return CONSULTANT_BY_DELIVERABLE.get(documentType) ?? null;
}

/**
 * The waste management plan comes from the architect who drew the plans.
 *
 * Not from a consultant table, and that is the point: there is nobody new to
 * engage. The architect already has an outreach, a thread and a contact on
 * this file, and the plan is drawn against the design they produced — sending
 * it to a stranger would mean sending them the whole set to read first. So the
 * request rides the thread that already exists, and what it needs is a modal
 * and a send rather than a contact picker.
 */
export const WASTE_MANAGEMENT_PLAN_PARTY = CompliancePartyType.ARCHITECT;

/**
 * How long the architect has on a waste management plan.
 *
 * Its own clock rather than their response SLA, because it starts somewhere
 * else. The plan is asked for off a checklist line or off the development
 * application, months after the outreach that engaged them, and a threshold
 * measured from that outreach would be past on the day it was requested.
 */
export const WASTE_MANAGEMENT_BUSINESS_DAYS = 11;

/**
 * The trade each party is picked from in the tradie directory.
 *
 * Labels, not keys: `Tradie.trade` stores "Surveying", not "SURVEYOR", which is
 * what TradeTypeCombobox writes.
 *
 * Written out rather than read from TRADIE_TYPES, though every one of these is
 * a value in that table. That module carries an icon per trade and therefore
 * imports lucide-react, and this one is read by the nightly overdue sweep and
 * by every `"use server"` module in the compliance flow — importing it would
 * pull a React icon library into a cron job. The values are asserted equal in
 * tests/compliance/party-sections.test.ts, which is the cheaper half of that
 * trade and the same one `ALERT_TITLE` makes.
 */
export const PARTY_TRADE_LABEL: Readonly<
  Record<CompliancePartyType, string | null>
> = {
  [CompliancePartyType.SURVEYOR]: "Surveying",
  [CompliancePartyType.ARCHITECT]: "Architecture",
  // Not picked from the directory. Nothing is sent to the council from here —
  // the certificate is ordered on the NSW Planning Portal by hand.
  [CompliancePartyType.COUNCIL]: null,
  [CompliancePartyType.BASIX_CONSULTANT]: "BASIX Assessment",
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: "Bushfire Assessment",
  [CompliancePartyType.STRUCTURAL_ENGINEER]: "Structural Engineering",
  [CompliancePartyType.WATER_AUTHORITY]: "Sydney Water",
  [CompliancePartyType.TRAFFIC_CONSULTANT]: "Traffic Control",
};

/** How each party is named in headings, buttons and thread tabs. */
export const PARTY_LABEL: Readonly<Record<CompliancePartyType, string>> = {
  [CompliancePartyType.SURVEYOR]: "Surveyor",
  [CompliancePartyType.ARCHITECT]: "Architect",
  [CompliancePartyType.COUNCIL]: "NSW Planning",
  [CompliancePartyType.BASIX_CONSULTANT]: "BASIX consultant",
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: "Bushfire consultant",
  [CompliancePartyType.STRUCTURAL_ENGINEER]: "Structural engineer",
  // Named for the role rather than for Sydney Water itself. The approval comes
  // from an accredited water servicing coordinator, who is a private firm in
  // the directory — writing "Sydney Water" on the button would send somebody
  // looking for a utility's switchboard.
  [CompliancePartyType.WATER_AUTHORITY]: "Water servicing coordinator",
  [CompliancePartyType.TRAFFIC_CONSULTANT]: "Traffic control consultant",
};

/**
 * How long each party has before anybody is chased, in NSW business days.
 *
 * Quoted turnarounds rather than targets of ours: the portal says three to five
 * working days for a 10.7 certificate, and a surveyor, an architect or a
 * consultant says ten to eleven for a set of drawings or a report. The sweep
 * raises nothing until the upper bound has passed, so a firm delivering inside
 * its own quote is never called late.
 *
 * One table, read by the daily sweep and by the copy on the alert it raises, so
 * the screen cannot claim a threshold the sweep does not use.
 */
export const PARTY_RESPONSE_BUSINESS_DAYS: Readonly<
  Record<CompliancePartyType, number>
> = {
  [CompliancePartyType.SURVEYOR]: 11,
  [CompliancePartyType.ARCHITECT]: 11,
  [CompliancePartyType.COUNCIL]: 5,
  [CompliancePartyType.BASIX_CONSULTANT]: 11,
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: 11,
  [CompliancePartyType.STRUCTURAL_ENGINEER]: 11,
  [CompliancePartyType.WATER_AUTHORITY]: 11,
  [CompliancePartyType.TRAFFIC_CONSULTANT]: 11,
};

/**
 * How long the architect has to produce preliminary plans after meeting the
 * client, and to re-issue them after a round of revisions.
 *
 * Both measured from an event rather than from the outreach: the plans clock
 * starts at the meeting, because an architect who has not sat with the client
 * has nothing to draw yet, and the revision clock starts when the feedback is
 * sent. Same figure as the response SLA above, and separate from it because the
 * three clocks run at different times on the same outreach.
 */
export const ARCHITECT_PLANS_BUSINESS_DAYS = 11;
export const ARCHITECT_REVISION_BUSINESS_DAYS = 11;

/**
 * What the builder sends the surveyor to start work.
 *
 * Not part of the required pack — the certifier is never sent a land deed — but
 * it is collected on the same file, so it gets a document type and sits in the
 * vault with everything else.
 */
export const LAND_DEED_DOCUMENT = {
  type: ComplianceDocumentType.LAND_DEED,
  label: "Land Deed",
} as const;

/**
 * The attachments each party's outreach carries.
 *
 * The surveyor gets the deed, which is the input to their work. The architect
 * gets everything the surveyor produced, because that is what they draw
 * against — prefilled rather than asked for, since by the time an architect can
 * be engaged those three documents are on the file by definition. The council
 * is never sent anything.
 */
export const PARTY_OUTREACH_ATTACHMENTS: Readonly<
  Record<CompliancePartyType, readonly ComplianceDocumentType[]>
> = {
  [CompliancePartyType.SURVEYOR]: [ComplianceDocumentType.LAND_DEED],
  // The surveyor's set plus the planning certificate, which by the time an
  // architect can be engaged is on the file by definition -- the certificate is
  // now a prerequisite for engaging them. It is the document that says what the
  // lot is allowed to carry, so an architect sent the survey without it is
  // being asked to draw and then redraw.
  [CompliancePartyType.ARCHITECT]: [
    ...documentTypesForParty(CompliancePartyType.SURVEYOR),
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  ],
  [CompliancePartyType.COUNCIL]: [],
  // Both consultants assess a design against a site, so both are sent the same
  // thing: the plans as they stand, the survey they were drawn against, and the
  // certificate carrying the overlays. The bushfire assessor in particular is
  // reading the certificate's bushfire-prone designation before anything else.
  [CompliancePartyType.BASIX_CONSULTANT]: [
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    ComplianceDocumentType.SURVEY,
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  ],
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: [
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    ComplianceDocumentType.SURVEY,
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  ],
  // The engineer designs to the drawn building and the measured ground, so
  // they get the full architectural set rather than the preliminary one -- a
  // structural design against a sketch is a design that gets redone -- plus
  // the survey for levels and the certificate for the flood and land-slip
  // overlays that decide what the footings have to do.
  [CompliancePartyType.STRUCTURAL_ENGINEER]: [
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    ComplianceDocumentType.SURVEY,
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  ],
  // A servicing coordinator works off the lot and what is being built on it:
  // the deposited plan says where the mains and easements are, the survey says
  // where the ground is, and the plans say what is going over the top of them.
  [CompliancePartyType.WATER_AUTHORITY]: [
    ComplianceDocumentType.DEPOSITED_PLAN,
    ComplianceDocumentType.SURVEY,
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
  ],
  // A traffic control plan is about the street, not the house. The survey and
  // the site plan are what show the frontage, the crossing and where a truck
  // can stand.
  [CompliancePartyType.TRAFFIC_CONSULTANT]: [
    ComplianceDocumentType.SURVEY,
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
  ],
};

/**
 * What an inbound message from each party may be identified as.
 *
 * Narrowed per party rather than once, for the same reason the certifier's
 * inbound set is narrower than the classifier's vocabulary: a surveyor does not
 * send architectural plans, and letting their covering email be read as one
 * would overwrite a document that has to come from somewhere else. The land
 * deed is in the surveyor's set because they routinely quote it back.
 */
export const PARTY_INBOUND_DOCUMENT_TYPES: Readonly<
  Record<CompliancePartyType, readonly ComplianceDocumentType[]>
> = {
  [CompliancePartyType.SURVEYOR]: [
    ...documentTypesForParty(CompliancePartyType.SURVEYOR),
    ComplianceDocumentType.LAND_DEED,
  ],
  // Their two pack documents plus the waste management plan, which is the one
  // thing they are asked for that is not part of the pack at all. It is on
  // this list rather than left UNKNOWN because it comes back on the same
  // thread as a redraw and nobody would think to place it by hand.
  [CompliancePartyType.ARCHITECT]: [
    ...documentTypesForParty(CompliancePartyType.ARCHITECT),
    ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
  ],
  [CompliancePartyType.COUNCIL]: documentTypesForParty(
    CompliancePartyType.COUNCIL,
  ),
  // Narrower than any of the above: a consultant sends back one thing. A BASIX
  // assessor routinely attaches the plans they were sent as a courtesy, and
  // reading those as the architect's preliminary set would overwrite the
  // authoritative copy with a forwarded one.
  [CompliancePartyType.BASIX_CONSULTANT]: [
    ComplianceDocumentType.BASIX_CERTIFICATE,
  ],
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: [
    ComplianceDocumentType.BUSHFIRE_REPORT,
  ],
  // Narrowed to what each was asked for, which is the same rule the two above
  // follow and the same reason: every one of these parties is sent the plans
  // as material to work from, and routinely attaches them back on their reply.
  // Reading those as the architect's set would overwrite the authoritative
  // copy of the design with a forwarded one.
  [CompliancePartyType.STRUCTURAL_ENGINEER]:
    CONSULTANT_DELIVERABLES[CompliancePartyType.STRUCTURAL_ENGINEER] ?? [],
  [CompliancePartyType.WATER_AUTHORITY]:
    CONSULTANT_DELIVERABLES[CompliancePartyType.WATER_AUTHORITY] ?? [],
  [CompliancePartyType.TRAFFIC_CONSULTANT]:
    CONSULTANT_DELIVERABLES[CompliancePartyType.TRAFFIC_CONSULTANT] ?? [],
};

/**
 * Where an admin orders the planning certificate.
 *
 * NSW only, for the same reason HBCF_INSURANCE_URL is: every project in the
 * system is a Sydney-council build today.
 */
export const NSW_PLANNING_PORTAL_URL =
  "https://www.planningportal.nsw.gov.au/planning-certificates";

const REQUIRED_TYPES: ReadonlySet<ComplianceDocumentType> = new Set(
  REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
);

/** Whether a document is part of the pack that opens the engagement. */
export function isRequiredDocumentType(
  documentType: ComplianceDocumentType,
): boolean {
  return REQUIRED_TYPES.has(documentType);
}

/**
 * Required documents the outreach does not wait for.
 *
 * The full architectural design is wanted on the file and is not a precondition
 * for asking a certifier to look at the job. A certifier can assess whether the
 * proposal qualifies as complying development off the preliminary set and the
 * title documents, and issue the CDC pathway on that basis — the full set is
 * what gets built from, not what gets assessed. Holding the outreach until it
 * existed meant the certifier was engaged weeks after they could have been, and
 * the one question worth asking early — can this go CDC at all — was the last
 * one asked.
 *
 * It stays a required document. It is still on the pack, still shown, still
 * chased, and still sent as an update the moment it lands; what changes is only
 * that its absence does not block the first send.
 *
 * Deliberately a set of its own rather than a flag on the entries above: that
 * list is ordered and read by four other places, and none of them cares about
 * this distinction.
 */
export const OPTIONAL_FOR_OUTREACH: ReadonlySet<ComplianceDocumentType> =
  new Set([ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]);

/**
 * Whether the outreach can go without this document.
 *
 * Read by the send, by everything that counts the pack as ready, and by the row
 * that says so on the tab — because a button offering a send the server then
 * refuses, or refusing one the button offers, is the same bug either way round.
 */
export function isOptionalForOutreach(
  documentType: ComplianceDocumentType,
): boolean {
  return OPTIONAL_FOR_OUTREACH.has(documentType);
}

/**
 * What the certifier sends back, which is the second half of the classifier's
 * job. Kept separate from the required list because the two are never confused
 * in the UI — these arrive as email attachments, those are collected up front.
 */
export const CERTIFIER_RESPONSE_DOCUMENTS = [
  { type: ComplianceDocumentType.INVOICE, label: "Invoice" },
  { type: ComplianceDocumentType.FEE_PROPOSAL, label: "Fee Proposal" },
  { type: ComplianceDocumentType.CDC_FORM, label: "CDC Application Form" },
  { type: ComplianceDocumentType.CHECKLIST, label: "Checklist" },
] as const satisfies readonly {
  type: ComplianceDocumentType;
  label: string;
}[];

/**
 * What the review send actually carries, and therefore what it counts.
 *
 * Not everything the builder supplied. The required pack went out with the
 * outreach and the signed copies with their own send, so both are already on
 * the thread this replies into — re-attaching them puts the whole architectural
 * set back on the wire for every round of a review that is only ever about the
 * checklist. What the certifier has not seen is the evidence against the
 * checklist they issued and the insurance certificate behind it.
 */
export const REVIEW_SUBMISSION_TYPES: readonly ComplianceDocumentType[] = [
  ComplianceDocumentType.CHECKLIST_ITEM,
  ComplianceDocumentType.HOME_INSURANCE,
];

export function isReviewSubmissionType(
  documentType: ComplianceDocumentType,
): boolean {
  return REVIEW_SUBMISSION_TYPES.includes(documentType);
}

/**
 * Whether a document goes through the approve/reject loop.
 *
 * Only checklist evidence does, and this is deliberately narrower than "the
 * builder supplied it". The required pack went to the certifier to open the
 * engagement and the signed copies are their own forms come back signed —
 * neither is something they were ever going to sit in judgement on. What they
 * review is the evidence against the checklist they themselves issued, so that
 * is the only row that gets a decision pair, and the only one whose approval is
 * allowed to hold the engagement open.
 */
export function isApprovableDocumentType(
  documentType: ComplianceDocumentType,
): boolean {
  return documentType === ComplianceDocumentType.CHECKLIST_ITEM;
}

/**
 * Every type the classifier is allowed to return, plus UNKNOWN. Signed copies
 * and checklist items are excluded deliberately: a signed form is identified by
 * where the admin uploaded it, not by reading it, and a checklist item is a
 * line the extraction workflow produced rather than a document to identify.
 */
export const CLASSIFIABLE_DOCUMENT_TYPES = [
  ...REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
  ...CERTIFIER_RESPONSE_DOCUMENTS.map((doc) => doc.type),
  ComplianceDocumentType.HOME_INSURANCE,
  // The consultants' deliverables. Classifiable because they arrive as
  // attachments like everything else -- what keeps a BASIX certificate from
  // being read off a surveyor's email is the per-party narrowing above, not
  // this list.
  ComplianceDocumentType.BASIX_CERTIFICATE,
  ComplianceDocumentType.BUSHFIRE_REPORT,
  // Everything the other consultants send back, plus the two the builder and
  // the owners produce. All classifiable for the same reason the two above
  // are: they arrive as attachments like everything else, and what keeps a
  // geotechnical report from being read off a surveyor's email is the
  // per-party narrowing above rather than this list.
  //
  // The three portal documents are here too. Nobody emails those to us on a
  // correlated thread, but they are uploaded by hand and the same classifier
  // runs over the needs-identifying queue.
  ComplianceDocumentType.STRUCTURAL_DRAWINGS,
  ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
  ComplianceDocumentType.GEOTECH_REPORT,
  ComplianceDocumentType.WATER_SERVICING_APPROVAL,
  ComplianceDocumentType.SECTION_73_NOTICE,
  ComplianceDocumentType.ROAD_OPENING_PERMIT,
  ComplianceDocumentType.LONG_SERVICE_LEVY,
  ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
  ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
  ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
  ComplianceDocumentType.BUILD_COST_SUMMARY,
  ComplianceDocumentType.OWNER_CONSENT_FORM,
  ComplianceDocumentType.DEVELOPMENT_CONSENT,
  // Not part of the pack, but a surveyor routinely quotes the deed back on
  // their reply, and a copy the classifier cannot name lands in the
  // needs-identifying queue for somebody to place by hand.
  LAND_DEED_DOCUMENT.type,
  ComplianceDocumentType.UNKNOWN,
] as const;

/**
 * Every type a checklist line can be *asking for*.
 *
 * Deliberately not CLASSIFIABLE_DOCUMENT_TYPES, though the two overlap almost
 * entirely. That list governs what an inbound attachment may be identified as,
 * and excludes the signed copies because a signed form is identified by where
 * the admin uploaded it rather than by reading it. This list answers a different
 * question — what is this line of the checklist after — and "please complete the
 * attached application form and return it signed" is one of the commonest lines
 * on a certifier's checklist. So the signed copies belong here and not there.
 *
 * CHECKLIST_ITEM is excluded because a checklist line cannot ask for a checklist
 * line, and UNKNOWN because "we could not tell" is not something to ask for.
 */
export const MAPPABLE_DOCUMENT_TYPES = Object.values(
  ComplianceDocumentType,
).filter(
  (type) =>
    type !== ComplianceDocumentType.CHECKLIST_ITEM &&
    type !== ComplianceDocumentType.UNKNOWN,
) as [ComplianceDocumentType, ...ComplianceDocumentType[]];

const DOCUMENT_LABELS: Partial<Record<ComplianceDocumentType, string>> = {
  ...Object.fromEntries(
    [...REQUIRED_COMPLIANCE_DOCUMENTS, ...CERTIFIER_RESPONSE_DOCUMENTS].map(
      (doc) => [doc.type, doc.label],
    ),
  ),
  [LAND_DEED_DOCUMENT.type]: LAND_DEED_DOCUMENT.label,
  [ComplianceDocumentType.SIGNED_FEE_PROPOSAL]: "Signed Fee Proposal",
  [ComplianceDocumentType.SIGNED_CDC_FORM]: "Signed CDC Application Form",
  [ComplianceDocumentType.HOME_INSURANCE]: "Home Insurance",
  [ComplianceDocumentType.BASIX_CERTIFICATE]: "BASIX Certificate",
  [ComplianceDocumentType.BUSHFIRE_REPORT]: "Bushfire Assessment Report",
  [ComplianceDocumentType.CHECKLIST_ITEM]: "Checklist item",
  [ComplianceDocumentType.UNKNOWN]: "Unidentified document",

  // The consultants' and portals' documents. Worded the way a certifier's
  // checklist words them, because these labels are what a mapped row shows
  // beside the certifier's own wording and the two reading differently is how
  // somebody concludes we have mapped the wrong thing.
  [ComplianceDocumentType.STRUCTURAL_DRAWINGS]:
    "Structural drawings & design certificate",
  [ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS]:
    "Hydraulic/stormwater drawings & design certificate",
  [ComplianceDocumentType.GEOTECH_REPORT]: "Geotechnical report",
  [ComplianceDocumentType.WATER_SERVICING_APPROVAL]:
    "Tap-in or Water Servicing Coordinator approval",
  [ComplianceDocumentType.SECTION_73_NOTICE]:
    "Section 73 notice of requirements",
  [ComplianceDocumentType.ROAD_OPENING_PERMIT]:
    "Road opening & vehicle crossing approval",
  [ComplianceDocumentType.LONG_SERVICE_LEVY]: "Long Service Levy receipt",
  [ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL]: "Mine subsidence approval",
  [ComplianceDocumentType.WASTE_MANAGEMENT_PLAN]: "Waste management plan",
  [ComplianceDocumentType.TRAFFIC_CONTROL_PLAN]: "Traffic control plan",
  [ComplianceDocumentType.BUILD_COST_SUMMARY]: "Build cost summary",
  [ComplianceDocumentType.OWNER_CONSENT_FORM]: "Owner consent form",
  [ComplianceDocumentType.DEVELOPMENT_CONSENT]:
    "Development consent (DA approval)",
};

/**
 * The human name for a document type.
 *
 * A CHECKLIST_ITEM carries its own wording in `label` — the certifier's, not
 * ours — so callers pass it and get it back; everything else has a fixed name.
 */
export function complianceDocumentLabel(
  documentType: ComplianceDocumentType,
  label?: string | null,
): string {
  if (label && label.trim()) {
    return label.trim();
  }
  return DOCUMENT_LABELS[documentType] ?? documentType;
}

/**
 * Whether a row has been settled without a document behind it.
 *
 * An admin marks a checklist line NOT_REQUIRED when it does not apply to this
 * job — the certifier struck it through, or already holds the document, or the
 * category simply does not arise. One predicate rather than a status comparison
 * repeated at each site, because it is read in five places that must agree:
 * the progress counts, the review send on both client and server, the row's
 * controls, and the check that closes the engagement. A disagreement between
 * any two of them strands the engagement.
 */
export function isNotRequired(status: ComplianceDocumentStatus): boolean {
  return status === ComplianceDocumentStatus.NOT_REQUIRED;
}

/**
 * Whether this row still owes the certifier a document.
 *
 * The counterpart to the above, and the shape most callers actually want: a row
 * is outstanding when nothing has been supplied for it and nobody has said it is
 * not needed.
 */
export function isOutstandingEvidence(document: {
  status: ComplianceDocumentStatus;
  files: readonly unknown[];
}): boolean {
  return !isNotRequired(document.status) && document.files.length === 0;
}

/**
 * The two signed copies that gate `Get Checklist`. Both must exist before the
 * checklist can be requested, because the certifier will not issue one against
 * an unsigned fee proposal.
 */
export const SIGNED_COPY_DOCUMENTS = [
  {
    type: ComplianceDocumentType.SIGNED_FEE_PROPOSAL,
    label: "Signed Fee Proposal",
    signs: ComplianceDocumentType.FEE_PROPOSAL,
  },
  {
    type: ComplianceDocumentType.SIGNED_CDC_FORM,
    label: "Signed CDC Application Form",
    signs: ComplianceDocumentType.CDC_FORM,
  },
] as const;

const SIGNED_COPY_TYPES: ReadonlySet<ComplianceDocumentType> = new Set(
  SIGNED_COPY_DOCUMENTS.map((copy) => copy.type),
);

/** Whether a document is one of the certifier's own forms, countersigned. */
export function isSignedCopyType(
  documentType: ComplianceDocumentType,
): boolean {
  return SIGNED_COPY_TYPES.has(documentType);
}

/**
 * How the collected file divides up, in flow order.
 *
 * Grouped by where each document came from rather than by status: what we sent,
 * what came back, what was signed, what the checklist required, and the
 * insurance. Provenance is what someone auditing the job is looking for, and
 * unlike status it still means something once everything is approved.
 *
 * The finished file and the vault both read this, so the two cannot end up
 * describing the same engagement differently. Types are taken from the lists
 * above rather than restated, so a document type added to one of them cannot
 * quietly fall out of the file.
 *
 * UNKNOWN is deliberately absent: an attachment nobody has placed has no
 * provenance to file it under. The vault sweeps up whatever is left over into a
 * section of its own; the finished file never sees one, because an engagement
 * cannot close with an unidentified document on it.
 */
export const COMPLIANCE_DOCUMENT_SECTIONS: readonly {
  heading: string;
  description: string;
  types: readonly ComplianceDocumentType[];
}[] = [
  {
    heading: "Required documents",
    description: "The pack sent to the certifier to open the engagement.",
    types: REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
  },
  {
    heading: "Supplied to the surveyor",
    description: "What the surveyor was given to start work.",
    types: [LAND_DEED_DOCUMENT.type],
  },
  {
    heading: "Certifier response",
    description: "What came back from the certifier.",
    types: CERTIFIER_RESPONSE_DOCUMENTS.map((doc) => doc.type),
  },
  {
    heading: "Signed forms",
    description: "Returned to the certifier with signatures.",
    types: SIGNED_COPY_DOCUMENTS.map((copy) => copy.type),
  },
  {
    heading: "Checklist evidence",
    description: "One document per item the certifier asked for.",
    types: [ComplianceDocumentType.CHECKLIST_ITEM],
  },
  {
    heading: "Consultant reports",
    description: "Commissioned against a checklist item the certifier raised.",
    types: [
      ComplianceDocumentType.BASIX_CERTIFICATE,
      ComplianceDocumentType.BUSHFIRE_REPORT,
      ComplianceDocumentType.STRUCTURAL_DRAWINGS,
      ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
      ComplianceDocumentType.GEOTECH_REPORT,
      ComplianceDocumentType.WATER_SERVICING_APPROVAL,
      ComplianceDocumentType.SECTION_73_NOTICE,
      ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
      ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
    ],
  },
  {
    heading: "Permits and approvals",
    description: "Bought or lodged with an outside body, not asked of anybody.",
    types: [
      ComplianceDocumentType.ROAD_OPENING_PERMIT,
      ComplianceDocumentType.LONG_SERVICE_LEVY,
      ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
    ],
  },
  {
    heading: "Development application",
    description: "What the council needs that the certifier never asked for.",
    types: [
      ComplianceDocumentType.BUILD_COST_SUMMARY,
      ComplianceDocumentType.OWNER_CONSENT_FORM,
    ],
  },
  {
    heading: "Home insurance",
    description: "Home Building Compensation Fund cover for the build.",
    types: [ComplianceDocumentType.HOME_INSURANCE],
  },
];

/** Every type that has a section. Anything else is unplaced, not unlisted. */
export const SECTIONED_DOCUMENT_TYPES: ReadonlySet<ComplianceDocumentType> =
  new Set(COMPLIANCE_DOCUMENT_SECTIONS.flatMap((section) => section.types));

/**
 * Where an admin raises home builders compensation cover when they have not
 * already. NSW only — icare is the sole HBCF provider in this state, and every
 * project in the system is a Sydney-council build today. A second state means
 * this becomes a lookup on the project's address rather than a constant.
 */
export const HBCF_INSURANCE_URL =
  "https://www.icare.nsw.gov.au/builders-and-homeowners/home-building-compensation";

// ===========================================================================
// Applications to outside bodies
//
// Four things on a compliance file are not asked of anybody and not produced
// by anybody here: they are bought. A 10.7 certificate from the NSW Planning
// Portal, a road opening and vehicle crossing approval from the council, a
// long service levy receipt from the Long Service Corporation, and a mine
// subsidence approval from Subsidence Advisory. The development application
// itself is lodged the same way and waited on the same way, which is why it is
// the fifth kind rather than a table of its own.
//
// Every one has the same four facts — where you go, what it is called, how
// long it normally takes, and which alert says it has taken longer — so they
// are one table rather than four cards that would drift apart.
// ===========================================================================

/**
 * The document each application ends up producing.
 *
 * The development application produces the council's notice of determination,
 * and that document does more work than any other on this file: while a
 * certifier has said the job needs development approval there is nothing they
 * can assess, so the checklist is frozen until it arrives. It used to be null
 * here on the reasoning that a DA comes back as a consent for the whole job
 * rather than as a row on a list — true, and beside the point, because the
 * consent is a PDF somebody has to hold and the certifier asks for it by name.
 */
export const EXTERNAL_APPLICATION_DOCUMENT_TYPE: Readonly<
  Record<ComplianceExternalApplicationKind, ComplianceDocumentType | null>
> = {
  [ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7]:
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  [ComplianceExternalApplicationKind.ROAD_OPENING]:
    ComplianceDocumentType.ROAD_OPENING_PERMIT,
  [ComplianceExternalApplicationKind.LONG_SERVICE_LEVY]:
    ComplianceDocumentType.LONG_SERVICE_LEVY,
  [ComplianceExternalApplicationKind.MINE_SUBSIDENCE]:
    ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
  [ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION]:
    ComplianceDocumentType.DEVELOPMENT_CONSENT,
};

const EXTERNAL_APPLICATION_BY_DOCUMENT_TYPE = new Map<
  ComplianceDocumentType,
  ComplianceExternalApplicationKind
>(
  Object.entries(EXTERNAL_APPLICATION_DOCUMENT_TYPE).flatMap(([kind, type]) =>
    type ? [[type, kind as ComplianceExternalApplicationKind] as const] : [],
  ),
);

/**
 * Which application a document comes out of, if any.
 *
 * The counterpart of `consultantForDocumentType`, and read in the same place: a
 * checklist line that maps to one of these needs a portal block rather than a
 * "Connect with…" button, because there is nobody to write to.
 */
export function externalApplicationForDocumentType(
  documentType: ComplianceDocumentType | undefined | null,
): ComplianceExternalApplicationKind | null {
  if (!documentType) return null;
  return EXTERNAL_APPLICATION_BY_DOCUMENT_TYPE.get(documentType) ?? null;
}

/**
 * How long a residential development application takes to be determined.
 *
 * Working days, and deliberately an order of magnitude above everything else in
 * this file. A DA runs weeks to months; the threshold exists to catch a council
 * that has genuinely lost one, not to describe the normal case. An alert at the
 * eleven days the consultants get would be open on every DA ever lodged, which
 * is the fastest way to teach people to stop reading the panel.
 */
export const DA_DETERMINATION_BUSINESS_DAYS = 60;

/**
 * Everything one application needs to render itself and to be chased.
 *
 * The `instruction` is the load-bearing field. Every one of these is a website
 * somebody has to go to, and an admin shown a row reading "Long Service Levy —
 * not supplied" and nothing else has to go and find out what that is, who takes
 * the money, and how much. The sentence is what the row exists to say.
 */
export const EXTERNAL_APPLICATION_COPY: Readonly<
  Record<
    ComplianceExternalApplicationKind,
    {
      /** What the thing is called on the block's heading. */
      label: string;
      /** The body it is lodged with, as the link is labelled. */
      portal: string;
      /**
       * Where to go, or null where it depends on the project.
       *
       * Null for the road opening permit, which is applied for on the local
       * council's own site — see `roadOpeningUrlForCouncil`.
       */
      url: string | null;
      /** How long it normally takes, in NSW business days. */
      businessDays: number;
      /** The alert raised when it has taken longer than that. */
      alertType: ComplianceAlertType;
      /** What to actually do, in the reader's terms. */
      instruction: string;
      /** The quoted turnaround, as the copy under the clock words it. */
      turnaround: string;
    }
  >
> = {
  [ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7]: {
    label: "Section 10.7(2) & (5) Planning Certificate",
    portal: "NSW Planning Portal",
    url: NSW_PLANNING_PORTAL_URL,
    businessDays: PARTY_RESPONSE_BUSINESS_DAYS[CompliancePartyType.COUNCIL],
    alertType: ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    instruction:
      "Order the Section 10.7(2) & (5) certificate for this lot on the NSW Planning Portal, then record the application here.",
    turnaround: "three to five working days",
  },
  [ComplianceExternalApplicationKind.ROAD_OPENING]: {
    label: "Road opening & vehicle crossing approval",
    portal: "the council",
    // Filled in per project — every council runs its own application.
    url: null,
    businessDays: 10,
    alertType: ComplianceAlertType.ROAD_OPENING_DELAYED,
    instruction:
      "Apply to the council for the road opening permit and the vehicle crossing approval, then record the application here.",
    turnaround: "around two weeks",
  },
  [ComplianceExternalApplicationKind.LONG_SERVICE_LEVY]: {
    label: "Long Service Levy",
    portal: "Long Service Corporation",
    url: "https://www.longservice.nsw.gov.au/bci/levy",
    businessDays: 5,
    alertType: ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED,
    instruction:
      "Pay the long service levy on the construction cost with the Long Service Corporation, then record the payment here and upload the receipt.",
    turnaround: "a few working days",
  },
  [ComplianceExternalApplicationKind.MINE_SUBSIDENCE]: {
    label: "Mine subsidence approval",
    portal: "Subsidence Advisory NSW",
    url: "https://www.subsidenceadvisory.nsw.gov.au/development-approvals",
    businessDays: 15,
    alertType: ComplianceAlertType.MINE_SUBSIDENCE_DELAYED,
    instruction:
      "If the lot sits in a declared mine subsidence district, apply to Subsidence Advisory NSW for approval and record the application here. Mark it not required if it does not.",
    turnaround: "around three weeks",
  },
  [ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION]: {
    label: "Development application",
    portal: "NSW Planning Portal",
    url: "https://www.planningportal.nsw.gov.au/development-applications",
    businessDays: DA_DETERMINATION_BUSINESS_DAYS,
    alertType: ComplianceAlertType.DA_DETERMINATION_OVERDUE,
    instruction:
      "Lodge the development application on the NSW Planning Portal with the documents above, then record the DA number here.",
    turnaround: "weeks to months",
  },
};

/**
 * Where each council takes a road opening and vehicle crossing application.
 *
 * Per council rather than one NSW link, because there is no NSW-wide road
 * opening application: the road belongs to the council, and each of them runs
 * its own form, its own fee and its own turnaround. A single generic link would
 * mean whoever is doing the job searching for the same page on every build.
 *
 * Keyed on `Project.council` exactly as it is stored. Not exhaustive and not
 * meant to be — the fallback below is a working answer for a council that is
 * not here yet, and adding one is a line rather than a change.
 */
export const COUNCIL_ROAD_OPENING_URL: Readonly<Record<string, string>> = {
  "Blacktown City Council":
    "https://www.blacktown.nsw.gov.au/Services/Roads-and-footpaths",
  "Camden Council":
    "https://www.camden.nsw.gov.au/development/other-approvals/",
  "Campbelltown City Council":
    "https://www.campbelltown.nsw.gov.au/Development-and-Building/Applications-and-Approvals",
  "City of Parramatta":
    "https://www.cityofparramatta.nsw.gov.au/development/other-approvals",
  "Cumberland City Council":
    "https://www.cumberland.nsw.gov.au/roads-and-footpaths",
  "Liverpool City Council":
    "https://www.liverpool.nsw.gov.au/development/applications-and-approvals",
  "Northern Beaches Council":
    "https://www.northernbeaches.nsw.gov.au/development/apply-permit",
  "Penrith City Council":
    "https://www.penrithcity.nsw.gov.au/waste-environment/roads-footpaths-and-drainage",
  "Sydney City Council":
    "https://www.cityofsydney.nsw.gov.au/permits/road-occupancy-permits",
  "The Hills Shire Council":
    "https://www.thehills.nsw.gov.au/Development/Other-Approvals",
};

/**
 * Where to send somebody for a council this table has never seen.
 *
 * The directory rather than a search result: it lists every NSW council with a
 * link to its own site, which is one hop from the right page and is never
 * wrong.
 */
export const NSW_COUNCIL_DIRECTORY_URL =
  "https://www.olg.nsw.gov.au/public/find-my-council/";

export function roadOpeningUrlForCouncil(
  council: string | null | undefined,
): string {
  if (!council) return NSW_COUNCIL_DIRECTORY_URL;
  return COUNCIL_ROAD_OPENING_URL[council.trim()] ?? NSW_COUNCIL_DIRECTORY_URL;
}

/**
 * Where the owners' consent form comes from.
 *
 * A fixed NSW template rather than something anybody drafts: the council will
 * only accept their own wording, so the builder downloads it, has the owners
 * sign it, and uploads it back. That download-sign-upload round trip is the
 * whole reason this row carries a link as well as an upload button.
 */
export const OWNER_CONSENT_FORM_URL =
  "https://www.planningportal.nsw.gov.au/development-applications/da-forms-and-templates";

// ===========================================================================
// Answering a checklist line from what the file already holds
// ===========================================================================

/**
 * The types a checklist line can be answered from without anybody uploading
 * anything.
 *
 * Six documents, and the reason for the list is that a certifier's checklist
 * asks for all six by name. It opens with the deposited plan, the title search
 * and the survey; it asks for the architectural drawings; it asks for the 10.7
 * certificate; and it asks for the HBCF warranty. Every one of those was
 * collected before the certifier was ever written to, and before this an admin
 * was finding each of them and uploading it a second time against a row sitting
 * inches below the row that already had it.
 *
 * Deliberately not "every type on the file". The preliminary architectural
 * plans are excluded because a certifier asking for architectural drawings
 * means the drawings the job is being assessed on, and answering that line with
 * a superseded sketch set is worse than leaving it empty — it looks answered.
 * The certifier's own documents are excluded for the obvious reason: handing
 * back their fee proposal as evidence against their own checklist is not
 * evidence of anything.
 */
const NOT_CHECKLIST_MAPPABLE: ReadonlySet<ComplianceDocumentType> = new Set([
  // A superseded set must not answer a line asking for the current one. A
  // certifier asking for architectural drawings means the drawings the job is
  // assessed on, and filling that line with the sketch set the architect
  // produced first looks answered and is not — which is worse than empty.
  ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,

  // The certifier's own documents. Handing their fee proposal back as evidence
  // against their own checklist is not evidence of anything.
  ComplianceDocumentType.INVOICE,
  ComplianceDocumentType.FEE_PROPOSAL,
  ComplianceDocumentType.CDC_FORM,
  ComplianceDocumentType.CHECKLIST,

  // An input to the surveyor rather than an output of anybody. Nothing on a
  // checklist asks for it, and a line about a certificate of title means the
  // title search.
  ComplianceDocumentType.LAND_DEED,

  // A line cannot be answered by a line, and "we could not tell" answers
  // nothing.
  ComplianceDocumentType.CHECKLIST_ITEM,
  ComplianceDocumentType.UNKNOWN,
]);

/**
 * The types a checklist line can be answered from without anybody uploading
 * anything.
 *
 * An exclusion rather than a list, and that is the change the development
 * application forced. It began as the six the required pack collects, because
 * those were the only documents a checklist could ask for that the file already
 * held. A DA is assessed against very nearly the same evidence as a CDC, so
 * every consultant report and every permit on the DA list is now also a line on
 * the certifier's checklist — and collecting one twice is the thing this whole
 * mechanism exists to stop.
 *
 * Written as "everything except" so that a document type added later is
 * mappable by default. That is the right default: new types on this file are
 * consultant deliverables and permits, which are exactly the shared ones. The
 * exclusions above are the arguable cases, and each says why.
 */
export const CHECKLIST_MAPPABLE_TYPES: ReadonlySet<ComplianceDocumentType> =
  new Set(
    Object.values(ComplianceDocumentType).filter(
      (type) => !NOT_CHECKLIST_MAPPABLE.has(type),
    ),
  );

/**
 * Whether a checklist line asking for this type can be answered from the file.
 *
 * Read by the extraction, which does the mapping, and by the row, which says
 * where the document came from. One predicate so the two cannot disagree about
 * which lines are eligible.
 */
export function isChecklistMappableType(
  documentType: ComplianceDocumentType | undefined | null,
): boolean {
  return documentType ? CHECKLIST_MAPPABLE_TYPES.has(documentType) : false;
}

/**
 * Which section of the tab a mapped document was taken from.
 *
 * Shown on the mapped row — "Already on the file, from the surveyor" — because
 * the whole value of the mapping is somebody being able to see at a glance that
 * the line is answered and answered from the right place. A row that simply
 * showed a filename would be indistinguishable from one an admin uploaded, and
 * the first question anybody asks about an automatic action is where it got
 * that from.
 */
export function mappedDocumentSource(
  documentType: ComplianceDocumentType,
): string {
  const party = partyForDocumentType(documentType);
  if (party === CompliancePartyType.COUNCIL) {
    return "the planning certificate";
  }
  if (party) {
    return `the ${PARTY_LABEL[party].toLowerCase()}`;
  }
  if (documentType === ComplianceDocumentType.HOME_INSURANCE) {
    return "the project's HBCF cover";
  }
  if (documentType === ComplianceDocumentType.DEVELOPMENT_CONSENT) {
    return "the development approval";
  }

  // Commissioned from somebody, or bought. Named by who produces it rather than
  // by the list it appears on, because "from the development application" would
  // be true of a dozen rows and useful about none of them — what the reader
  // wants to know is whether the right person supplied it.
  const consultant = consultantForDocumentType(documentType);
  if (consultant) {
    return `the ${PARTY_LABEL[consultant].toLowerCase()}`;
  }
  if (externalApplicationForDocumentType(documentType)) {
    return "the permits already applied for";
  }
  if (isSignedCopyType(documentType)) {
    return "the signed forms";
  }
  return "the documents already collected";
}

// ===========================================================================
// The development application
// ===========================================================================

/**
 * How a document on the development application list is obtained.
 *
 * The list is not one kind of thing. Five rows are documents the pack already
 * collected and the DA also wants, which must be read-only here — a plan that
 * can be replaced in two places is a plan two people can disagree about. Two
 * are produced by the builder and the owners. The rest are the same consultant
 * and portal documents the CDC checklist asks for, obtained the same way.
 *
 * Stored as a discriminator on each row rather than worked out from the type,
 * because the same type is a carry-over here and a checklist line there, and
 * the row has to know which of those it is.
 */
export type DaDocumentSource =
  /** Collected in the required pack. Shown, never edited from here. */
  | "pack"
  /** The builder writes it, or has it signed, and uploads it. */
  | "upload"
  /** Commissioned from a consultant, with a thread and a clock. */
  | "consultant"
  /** Bought or lodged with an outside body. */
  | "application";

export type DaDocument = {
  type: ComplianceDocumentType;
  source: DaDocumentSource;
  /** The group heading it sits under. */
  group: string;
  /**
   * What the row says when it is empty.
   *
   * Written per row rather than derived, because "not supplied yet" is useless
   * on a list where every row is obtained a different way. The owner consent
   * form has to say it is downloaded and signed; the build cost summary has to
   * say who writes it.
   */
  helper?: string;
};

/**
 * Everything a development application needs, in the order it is assembled.
 *
 * Inferred from the CDC checklist rather than invented: a DA and a CDC ask for
 * very nearly the same evidence about the same house, which is why a job that
 * has been through the checklist arrives at the DA with most of this already
 * done. What the DA adds is the two forms at the end — the council wants a cost
 * summary and the owners' written consent, and a certifier never asks for
 * either.
 *
 * Everything with `source: "pack"` is deliberately at the top and deliberately
 * read-only. Those five rows are the same documents the surveyor, architect and
 * council blocks hold; offering a Replace button here as well would mean the
 * same file could be changed in two places, and the two would then disagree
 * about which copy the council was sent.
 */
export const DA_DOCUMENTS: readonly DaDocument[] = [
  // -- Carried over from the required pack ---------------------------------
  {
    type: ComplianceDocumentType.DEPOSITED_PLAN,
    source: "pack",
    group: "Already collected",
  },
  {
    type: ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
    source: "pack",
    group: "Already collected",
  },
  {
    type: ComplianceDocumentType.SURVEY,
    source: "pack",
    group: "Already collected",
  },
  {
    type: ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    source: "pack",
    group: "Already collected",
  },
  {
    type: ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    source: "pack",
    group: "Already collected",
  },

  // -- The builder's and the owners' own ------------------------------------
  {
    type: ComplianceDocumentType.BUILD_COST_SUMMARY,
    source: "upload",
    group: "From the builder",
    helper:
      "The estimated cost of works, broken down. The council sets the DA fee off this figure.",
  },
  {
    type: ComplianceDocumentType.OWNER_CONSENT_FORM,
    source: "upload",
    group: "From the builder",
    helper:
      "Download the NSW form, have every registered owner sign it, and upload it back.",
  },

  // -- Commissioned ---------------------------------------------------------
  {
    type: ComplianceDocumentType.BASIX_CERTIFICATE,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.BUSHFIRE_REPORT,
    source: "consultant",
    group: "Consultant reports",
    helper:
      "Only where the lot is bushfire prone — the 10.7 certificate says whether it is.",
  },
  {
    type: ComplianceDocumentType.STRUCTURAL_DRAWINGS,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.GEOTECH_REPORT,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.WATER_SERVICING_APPROVAL,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.SECTION_73_NOTICE,
    source: "consultant",
    group: "Consultant reports",
  },
  {
    type: ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
    source: "consultant",
    group: "Consultant reports",
    helper:
      "Drawn by the architect who did the plans — the request goes on the thread they are already on.",
  },
  {
    type: ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
    source: "consultant",
    group: "Consultant reports",
  },

  // -- Bought ---------------------------------------------------------------
  {
    type: ComplianceDocumentType.ROAD_OPENING_PERMIT,
    source: "application",
    group: "Permits and approvals",
  },
  {
    type: ComplianceDocumentType.LONG_SERVICE_LEVY,
    source: "application",
    group: "Permits and approvals",
  },
  {
    type: ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
    source: "application",
    group: "Permits and approvals",
  },
];

/** The DA list grouped by heading, in list order, for rendering. */
export const DA_DOCUMENT_GROUPS: readonly {
  heading: string;
  documents: readonly DaDocument[];
}[] = DA_DOCUMENTS.reduce<{ heading: string; documents: DaDocument[] }[]>(
  (groups, document) => {
    const last = groups.at(-1);
    if (last && last.heading === document.group) {
      last.documents.push(document);
      return groups;
    }
    groups.push({ heading: document.group, documents: [document] });
    return groups;
  },
  [],
);

/**
 * The types the DA carries over from the pack, and therefore must not edit.
 *
 * Read by the DA list, which renders them read-only, and by the pack rows
 * themselves, which stay the one place a carried-over document can be
 * replaced. Both sides read this rather than each listing five types, because
 * the failure it prevents is exactly the two of them disagreeing.
 */
export const DA_PACK_CARRYOVER_TYPES: ReadonlySet<ComplianceDocumentType> =
  new Set(
    DA_DOCUMENTS.filter((document) => document.source === "pack").map(
      (document) => document.type,
    ),
  );
