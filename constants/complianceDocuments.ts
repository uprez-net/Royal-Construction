import {
  CompliancePartyType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
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

export type RequiredComplianceDocumentType =
  RequiredComplianceDocument["type"];

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
export const REQUIRED_DOCUMENTS_ARE_SECTIONED: _EveryRequiredDocumentIsSectioned =
  true;

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
 * The parties a stage waits on.
 *
 * One table rather than a chain of conditions at each call site: the architect
 * and the council both wait on the surveyor and on nothing else, and if that
 * ever grows a second dependency it grows here.
 */
export const PARTY_PREREQUISITES: Readonly<
  Record<CompliancePartyType, readonly CompliancePartyType[]>
> = {
  [CompliancePartyType.SURVEYOR]: [],
  [CompliancePartyType.ARCHITECT]: [CompliancePartyType.SURVEYOR],
  [CompliancePartyType.COUNCIL]: [CompliancePartyType.SURVEYOR],
};

/**
 * The trade each party is picked from in the tradie directory.
 *
 * Labels, not keys: `Tradie.trade` stores "Surveying", not "SURVEYOR", which is
 * what TradeTypeCombobox writes.
 */
export const PARTY_TRADE_LABEL: Readonly<
  Record<CompliancePartyType, string | null>
> = {
  [CompliancePartyType.SURVEYOR]: "Surveying",
  [CompliancePartyType.ARCHITECT]: "Architecture",
  // Not picked from the directory. Nothing is sent to the council from here —
  // the certificate is ordered on the NSW Planning Portal by hand.
  [CompliancePartyType.COUNCIL]: null,
};

/** How each party is named in headings, buttons and thread tabs. */
export const PARTY_LABEL: Readonly<Record<CompliancePartyType, string>> = {
  [CompliancePartyType.SURVEYOR]: "Surveyor",
  [CompliancePartyType.ARCHITECT]: "Architect",
  [CompliancePartyType.COUNCIL]: "NSW Planning",
};

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
  [CompliancePartyType.ARCHITECT]: documentTypesForParty(
    CompliancePartyType.SURVEYOR,
  ),
  [CompliancePartyType.COUNCIL]: [],
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
  [CompliancePartyType.ARCHITECT]: documentTypesForParty(
    CompliancePartyType.ARCHITECT,
  ),
  [CompliancePartyType.COUNCIL]: documentTypesForParty(
    CompliancePartyType.COUNCIL,
  ),
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
  [ComplianceDocumentType.CHECKLIST_ITEM]: "Checklist item",
  [ComplianceDocumentType.UNKNOWN]: "Unidentified document",
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
