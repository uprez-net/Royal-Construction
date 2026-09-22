// Shared compliance-stage actor and readiness policy.
import {
  certificateApplication,
  certifierHasPassedChecklist,
  hasCertificate,
} from "./portal-certificates";
import {
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";

import {
  CONSULTANT_PARTIES,
  DA_DOCUMENTS,
  consultantForDocumentType,
  documentTypesForParty,
  externalApplicationForDocumentType,
  isNotRequired,
  WASTE_MANAGEMENT_PLAN_PARTY,
} from "@/constants/complianceDocuments";
import { applicableRequiredDocuments } from "./required-pack";
import {
  checklistItemDetail,
  externalApplication,
  meetingHeldAt,
  outreachForParty,
  outstandingRevision,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
  type ComplianceDocumentWithFiles,
} from "@/types/compliance";

/**
 * Who is involved at each stage of the flow.
 *
 * The header answers "which step is the job on" and "is anything past its
 * quote", and that was the whole of it. What it could not answer is the
 * question people ask next: *who* is this waiting on. A node reading
 * "Checklist — 9d in" says a twenty-item list is open and says nothing about
 * eighteen of those items being the builder's own paperwork and the other two
 * being a structural engineer who has not written back.
 *
 * So each node carries the parties behind it. The point is a reader seeing the
 * shape of the job without opening anything — which firms are in it, which have
 * finished, which are still owing — and it matters most on the two stages where
 * the party list is not implied by the name: the development application, which
 * pulls in nearly everybody, and the checklist, whose cast is whatever the
 * certifier happened to ask for.
 *
 * A pure function over one engagement, like `complianceStageFlow` itself, and
 * for the same reasons: everything here is already on the record, none of it
 * needs the database, and the tests can pin it.
 */

export type ComplianceStageActorState =
  /** Asked, and has not answered. */
  | "outstanding"
  /** Everything this party owed the stage is in, or has been waved off. */
  | "settled"
  /**
   * In the picture, with nothing running.
   *
   * Two quite different cases wear this, deliberately: a party nobody has
   * written to yet, and a party on a stage the file has not reached. Both mean
   * "no clock here", which is what the reader needs, and splitting them would
   * put a fourth colour on a badge eight characters wide.
   */
  | "idle";

export type ComplianceStageActor = {
  /** Stable within one stage, for keys. */
  id: string;
  /** The party's full name, for the badge's title and the screen reader. */
  label: string;
  /**
   * Two words at most, for the badge itself.
   *
   * `PARTY_LABEL` is written for headings and buttons — "Water servicing
   * coordinator" is right there and four times too wide for a pill under a node
   * in a row of six. The full name stays on `label`.
   */
  short: string;
  state: ComplianceStageActorState;
};

/**
 * How each party is named on a node, in full and in badge form.
 *
 * One table rather than a `short` map beside the imported `PARTY_LABEL`,
 * because the badge and its title are two halves of one decision and having
 * half of it arrive from a constants file six hundred lines away is how the two
 * come to disagree. A test asserts the full column still matches `PARTY_LABEL`.
 */
const PARTY_ACTOR: Readonly<
  Record<CompliancePartyType, { label: string; short: string }>
> = {
  [CompliancePartyType.SURVEYOR]: { label: "Surveyor", short: "Surveyor" },
  [CompliancePartyType.ARCHITECT]: { label: "Architect", short: "Architect" },
  [CompliancePartyType.COUNCIL]: {
    label: "NSW Planning",
    short: "NSW Planning",
  },
  [CompliancePartyType.BASIX_CONSULTANT]: {
    label: "BASIX consultant",
    short: "BASIX",
  },
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: {
    label: "Bushfire consultant",
    short: "Bushfire",
  },
  [CompliancePartyType.STRUCTURAL_ENGINEER]: {
    label: "Structural engineer",
    short: "Structural",
  },
  [CompliancePartyType.WATER_AUTHORITY]: {
    label: "Water servicing coordinator",
    short: "Water",
  },
  [CompliancePartyType.TRAFFIC_CONSULTANT]: {
    label: "Traffic control consultant",
    short: "Traffic",
  },
  [CompliancePartyType.DEVELOPER]: {
    label: "Estate developer",
    short: "Developer",
  },
};

/**
 * The parties who are not in `CompliancePartyType`, because nobody writes to
 * them.
 *
 * Each is on this file only as a name on a node: the builder uploads their own
 * paperwork, a portal is a website rather than a correspondent, the certifier
 * has a thread but not an outreach, and the insurer is engaged elsewhere in the
 * product entirely. None of them has a clock — but leaving them off would have
 * the checklist node showing two consultants over a list that is
 * eighteen-twentieths the builder's own work.
 */
const STANDING_ACTOR = {
  builder: { id: "builder", label: "The builder", short: "Builder" },
  certifier: { id: "certifier", label: "The certifier", short: "Certifier" },
  permits: { id: "permits", label: "NSW permit portals", short: "Permits" },
  insurer: { id: "insurer", label: "The HBCF insurer", short: "Insurer" },
} as const;

function actorForParty(
  party: CompliancePartyType,
  state: ComplianceStageActorState,
): ComplianceStageActor {
  return { id: party, ...PARTY_ACTOR[party], state };
}

/** Whether a document type has something on it, or has been waved off. */
function isSettled(
  engagement: CertifierEngagementDetail,
  documentType: ComplianceDocumentType,
): boolean {
  return engagement.documents.some(
    (document) =>
      document.documentType === documentType &&
      (document.files.length > 0 || isNotRequired(document.status)),
  );
}

/**
 * The state of a party who was written to and owes documents back.
 *
 * The client having supplied the documents themselves reads as settled rather
 * than as idle, which is the case worth spelling out: the party is not
 * outstanding, there is nothing to chase, and the stage is finished with them.
 */
function engagedPartyState(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
  isComplete: boolean,
): ComplianceStageActorState {
  const outreach = outreachForParty(engagement, party);
  if (outreach?.mode === ComplianceOutreachMode.SELF_SUPPLIED) return "settled";
  if (isComplete) return "settled";
  if (!outreach || !outreach.sentAt) return "idle";
  return "outstanding";
}

function surveyorActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const inPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );
  const isComplete = documentTypesForParty(CompliancePartyType.SURVEYOR)
    .filter((type) => inPlay.has(type))
    .every((type) => isSettled(engagement, type));

  return [
    actorForParty(
      CompliancePartyType.SURVEYOR,
      engagedPartyState(engagement, CompliancePartyType.SURVEYOR, isComplete),
    ),
  ];
}

function architectActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const outreach = outreachForParty(engagement, CompliancePartyType.ARCHITECT);
  const revision = outstandingRevision(outreach);
  const plansIn = isSettled(
    engagement,
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  );

  // The same reading the sweep takes: an architect who has not sat with the
  // owners has nothing to draw yet, so nobody is waiting on them and the badge
  // must not say otherwise. See `assessOverdueConditions`.
  const isWaitedOn = Boolean(revision) || Boolean(meetingHeldAt(outreach));

  const state = engagedPartyState(
    engagement,
    CompliancePartyType.ARCHITECT,
    plansIn && !revision,
  );

  return [
    actorForParty(
      CompliancePartyType.ARCHITECT,
      state === "outstanding" && !isWaitedOn ? "idle" : state,
    ),
  ];
}

function councilActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const application = externalApplication(
    engagement,
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
  );
  const settled =
    isSettled(engagement, ComplianceDocumentType.PLANNING_CERTIFICATE_10_7) ||
    Boolean(application?.receivedAt) ||
    !requiresPlanningCertificate(engagement);

  return [
    actorForParty(
      CompliancePartyType.COUNCIL,
      settled ? "settled" : application?.appliedAt ? "outstanding" : "idle",
    ),
  ];
}

function certifierActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const checklistIssued = engagement.documents.some(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  return [
    {
      ...STANDING_ACTOR.certifier,
      // The mail trail rather than the engagement's status: the certifier is
      // being waited on from the moment the pack goes out, which is what the
      // stage's own clock counts from.
      state: checklistIssued
        ? "settled"
        : engagement.emails.length > 0
          ? "outstanding"
          : "idle",
    },
  ];
}

/**
 * Everybody a development application pulls in.
 *
 * A fixed cast rather than a derived one, because a DA has a fixed cast: the
 * builder writes the cost summary and gets the owners to sign, consultants
 * produce the same reports a certifier would have asked for, three permits come
 * off portals, and the council determines it. That list does not vary with how
 * far along the job is — which is exactly what makes it worth drawing before
 * the job gets there, on the branch that is on screen and dormant.
 *
 * The estate developer is the one conditional member, and conditional on the
 * lot rather than on the stage: only a bushfire-prone lot inside an estate has
 * a covenant to satisfy, and a badge for one on a job that has none has the
 * reader looking for a firm that was never in it.
 *
 * Read off `DA_DOCUMENTS`, which is the list the DA block itself renders, so a
 * document added there appears here without anybody remembering to.
 */
function developmentApplicationActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const settledFor = (types: readonly ComplianceDocumentType[]) =>
    types.length > 0 && types.every((type) => isSettled(engagement, type));

  const uploads = DA_DOCUMENTS.filter(
    (document) => document.source === "upload",
  ).map((document) => document.type);

  // The architect answers the waste management plan and is not a consultant
  // party — see WASTE_MANAGEMENT_PLAN_PARTY — so the lookup has to fall back to
  // them rather than dropping the row.
  const byParty = new Map<CompliancePartyType, ComplianceDocumentType[]>();
  for (const row of DA_DOCUMENTS) {
    if (row.source !== "consultant") continue;
    const party =
      consultantForDocumentType(row.type) ??
      (row.type === ComplianceDocumentType.WASTE_MANAGEMENT_PLAN
        ? WASTE_MANAGEMENT_PLAN_PARTY
        : null);
    if (!party) continue;
    byParty.set(party, [...(byParty.get(party) ?? []), row.type]);
  }

  const permits = DA_DOCUMENTS.filter(
    (document) => document.source === "application",
  ).map((document) => document.type);

  const application = externalApplication(
    engagement,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  );
  const developer = outreachForParty(engagement, CompliancePartyType.DEVELOPER);

  return [
    {
      ...STANDING_ACTOR.builder,
      // Nobody chases a builder through this product, so their rows are either
      // in or not yet — there is no outstanding state to be in.
      state: settledFor(uploads) ? "settled" : "idle",
    },
    ...[...byParty.entries()].map(([party, types]) =>
      actorForParty(
        party,
        engagedPartyState(engagement, party, settledFor(types)),
      ),
    ),
    ...(developer
      ? [
          actorForParty(
            CompliancePartyType.DEVELOPER,
            developer.approvalDecision
              ? "settled"
              : developer.sentAt
                ? "outstanding"
                : "idle",
          ),
        ]
      : []),
    {
      ...STANDING_ACTOR.permits,
      state: settledFor(permits) ? "settled" : "idle",
    },
    actorForParty(
      CompliancePartyType.COUNCIL,
      application?.receivedAt
        ? "settled"
        : application?.appliedAt
          ? "outstanding"
          : "idle",
    ),
  ];
}

/**
 * The parties one certifier's checklist happens to name.
 *
 * Derived from the lines rather than fixed, because unlike the DA there is no
 * fixed cast: a certifier assessing a flat block on serviced land asks for a
 * BASIX certificate and nothing else, and one assessing a bushfire lot on a
 * slope asks for six firms' work. Drawing the second over the first would show
 * a reader five consultants who are not in the job.
 *
 * Before the certifier has answered there are no lines to read, and the node
 * shows the whole cast idle instead. That is the one speculative thing in this
 * module and it earns its place: "who is this going to pull in" is the question
 * somebody has about a checklist that has not arrived, and an empty node is not
 * an answer to it.
 *
 * The builder is on the list wherever a line names nobody else. Most of a
 * twenty-item checklist is their own paperwork — consents, receipts, the
 * insurance certificate — and a node showing only the two consultants describes
 * a tenth of the work.
 */
function checklistActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const items = engagement.documents.filter(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  if (items.length === 0) {
    return [
      { ...STANDING_ACTOR.builder, state: "idle" },
      ...CONSULTANT_PARTIES.map((party) => actorForParty(party, "idle")),
      { ...STANDING_ACTOR.permits, state: "idle" },
    ];
  }

  const isRowSettled = (item: ComplianceDocumentWithFiles) =>
    item.files.length > 0 || isNotRequired(item.status);

  const byParty = new Map<CompliancePartyType, boolean>();
  const standing = {
    builder: null as boolean | null,
    permits: null as boolean | null,
  };

  for (const item of items) {
    const type = checklistItemDetail(item.detail)?.mapsToType ?? null;
    const party = type
      ? (consultantForDocumentType(type) ??
        (type === ComplianceDocumentType.WASTE_MANAGEMENT_PLAN
          ? WASTE_MANAGEMENT_PLAN_PARTY
          : null))
      : null;

    if (party) {
      byParty.set(party, (byParty.get(party) ?? true) && isRowSettled(item));
    } else if (type && externalApplicationForDocumentType(type)) {
      standing.permits = (standing.permits ?? true) && isRowSettled(item);
    } else {
      // Everything else is somebody on the job producing or finding a document,
      // which is the builder as far as this node is concerned.
      standing.builder = (standing.builder ?? true) && isRowSettled(item);
    }
  }

  const standingActor = (
    actor: (typeof STANDING_ACTOR)[keyof typeof STANDING_ACTOR],
    settled: boolean | null,
  ): ComplianceStageActor[] =>
    settled === null
      ? []
      : [{ ...actor, state: settled ? "settled" : "outstanding" }];

  return [
    ...standingActor(STANDING_ACTOR.builder, standing.builder),
    ...[...byParty.entries()].map(([party, settled]) =>
      actorForParty(party, engagedPartyState(engagement, party, settled)),
    ),
    ...standingActor(STANDING_ACTOR.permits, standing.permits),
  ];
}

/**
 * Who is behind the portal stage.
 *
 * Two, and the pairing is the point. The builder is on it because lodging the
 * application and appointing the principal certifier are both our paperwork --
 * a node that named only the certifier would have a reader waiting on a firm
 * that has not been given anything yet. The certifier is on it because they are
 * the body that determines it, which is what makes this stage different from
 * every other portal wait on the file: a 10.7 or a levy receipt is answered by a
 * website, and a CDC is answered by the firm already on the thread.
 *
 * The builder settles on lodgement and the certifier on determination, so the
 * node reads "we have done our half, they have not done theirs" for the fortnight
 * that is the normal state of this stage.
 */
function planningPortalActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const application = certificateApplication(engagement);
  const lodged = Boolean(application?.appliedAt);
  const determined = Boolean(
    application?.approvalNotifiedAt ?? application?.receivedAt,
  );

  return [
    {
      ...STANDING_ACTOR.builder,
      // Idle rather than outstanding until the certifier has passed the
      // checklist. Nothing can be lodged before then, so a builder marked as
      // owing something would be a reader chased towards a control the tab has
      // not unlocked.
      state: lodged
        ? "settled"
        : certifierHasPassedChecklist(engagement)
          ? "outstanding"
          : "idle",
    },
    {
      ...STANDING_ACTOR.certifier,
      state: determined ? "settled" : lodged ? "outstanding" : "idle",
    },
  ];
}

/**
 * Who is behind the last stage.
 *
 * The builder rather than the certifier on the certificate itself, which is the
 * correction. This node used to name the certifier as the party owing the
 * certificate, because the file believed they issued it on their own thread.
 * They do not: by the time this stage is live the certifier has determined the
 * application and their work is finished. What is left is a download, and the
 * person doing it is on our side of the job.
 *
 * Naming them here was not a cosmetic error. The node is what a reader consults
 * to decide who to ring, and it pointed at a firm that had already done
 * everything, on a file whose actual blocker was an admin who had not logged
 * into the portal.
 */
function certificateActors(
  engagement: CertifierEngagementDetail,
): ComplianceStageActor[] {
  const application = certificateApplication(engagement);
  const certificateAvailable = Boolean(
    application?.approvalNotifiedAt ?? application?.receivedAt,
  );

  return [
    {
      ...STANDING_ACTOR.builder,
      state: hasCertificate(engagement)
        ? "settled"
        : certificateAvailable
          ? "outstanding"
          : "idle",
    },
    {
      ...STANDING_ACTOR.insurer,
      state: isSettled(engagement, ComplianceDocumentType.HOME_INSURANCE)
        ? "settled"
        : "outstanding",
    },
  ];
}

/**
 * Who is behind each stage, keyed by stage id.
 *
 * A table rather than a switch, so a stage added to the flow without an actor
 * list is a compile error where the flow declares it rather than a node that
 * silently draws nobody. Typed against a bare `string` key here and pinned to
 * `ComplianceStageId` at the one call site, which is what keeps this module
 * free of a cycle back into `stage-flow`.
 */
export const STAGE_ACTORS = {
  SURVEYOR: surveyorActors,
  ARCHITECT: architectActors,
  COUNCIL: councilActors,
  CERTIFIER: certifierActors,
  DEVELOPMENT_APPLICATION: developmentApplicationActors,
  CHECKLIST: checklistActors,
  PLANNING_PORTAL: planningPortalActors,
  CERTIFICATE: certificateActors,
} as const satisfies Record<
  string,
  (engagement: CertifierEngagementDetail) => ComplianceStageActor[]
>;
