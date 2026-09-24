import assert from "node:assert/strict";

import {
  CertifierEngagementStatus,
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceApprovalDecision,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import { test } from "vitest";

import {
  certificateCompletionBlockedReason,
  certificateDocumentTypeFor,
  certificateKindFor,
  certificateLodgementBlockedReason,
  hasCertificate,
} from "@/lib/domain/compliance/portal-certificates";
import {
  developerPlansBlockedReason,
  externalApplicationStep,
} from "@/types/compliance";
import type { CertifierEngagementDetail } from "@/types/compliance";

/**
 * Which certificate a file ends on, and what has to be true before it is asked
 * for.
 *
 * The drift this whole change corrects was a single wrong belief — that a
 * certifier passes the last checklist item and then issues the construction
 * certificate off their own desk. Two things follow from it being wrong, and both
 * are the kind of thing that is invisible until a job is stuck:
 *
 *  1. **There are two certificates.** A complying development job is built under
 *     a CDC and never gets a construction certificate. Reading the wrong one is
 *     not a cosmetic error: `closeComplianceIfComplete` asked for a construction
 *     certificate by name, so a CDC job could upload its CDC, move to
 *     CERTIFICATE_ISSUED, and never reach COMPLETED — ever.
 *  2. **There is a lodgement in between.** With gates on it: the certifier's
 *     verdict, the consent on the CC path, the principal certifier appointment on
 *     the CDC path, and the estate developer's covenant on both.
 *
 * So the tests here are about which certificate and which gate, and especially
 * about the gates *not* being bypassed — a lodgement that goes in early costs the
 * fee and a fortnight.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);
const MONDAY = sydney("2026-06-01T09:00:00");

type Overrides = Partial<CertifierEngagementDetail>;

/**
 * The smallest engagement these readers will look at.
 *
 * Cast at the boundary, as every other compliance test does: the functions read
 * three relations and three scalars, and building every column of five Prisma
 * models would bury what each test varies.
 */
function engagement(overrides: Overrides = {}): CertifierEngagementDetail {
  return {
    id: "engagement-1",
    projectId: "project-1",
    status: CertifierEngagementStatus.APPROVED,
    certifierName: "A Certifier",
    developerApprovalRequired: false,
    principalCertifierAppointedAt: null,
    principalCertifierAppointmentRef: null,
    documents: [],
    outreaches: [],
    alerts: [],
    emails: [],
    externalApplications: [],
    ...overrides,
  } as unknown as CertifierEngagementDetail;
}

function document(
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `document-${documentType}`,
    documentType,
    status: ComplianceDocumentStatus.UPLOADED,
    files: [{ id: "file-1", url: "https://blob/one.pdf", createdAt: MONDAY }],
    createdAt: MONDAY,
    rejectionReason: null,
    detail: null,
    label: null,
    order: 0,
    ...overrides,
  };
}

function application(
  kind: ComplianceExternalApplicationKind,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `application-${kind}`,
    kind,
    alreadyHeld: false,
    appliedAt: null,
    applicationRef: null,
    lodgedWith: null,
    receivedAt: null,
    approvalNotifiedAt: null,
    approvalNotificationMessageId: null,
    submissions: [],
    ...overrides,
  };
}

function developerOutreach(
  approvals: Record<string, unknown>[] = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "outreach-DEVELOPER",
    party: CompliancePartyType.DEVELOPER,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    sentAt: MONDAY,
    createdAt: MONDAY,
    updatedAt: MONDAY,
    contactEmail: "approvals@estate.example",
    contactName: "An Estate",
    approvalDecision: null,
    approvalDecidedAt: null,
    approvalChannel: null,
    approvalReason: null,
    approvalDecidedById: null,
    emails: [],
    meetings: [],
    revisions: [],
    deliverables: [],
    developerApprovals: approvals,
    ...overrides,
  };
}

function approval(
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `approval-${documentType}`,
    outreachId: "outreach-DEVELOPER",
    documentType,
    requestedAt: MONDAY,
    decision: null,
    decidedAt: null,
    channel: null,
    reason: null,
    round: 1,
    recordedById: null,
    createdAt: MONDAY,
    updatedAt: MONDAY,
    ...overrides,
  };
}

const openAlert = (type: ComplianceAlertType) => ({
  id: `alert-${type}`,
  type,
  status: ComplianceAlertStatus.OPEN,
  detail: null,
  raisedBySource: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: MONDAY,
});

// ---------------------------------------------------------------------------
// Which certificate
// ---------------------------------------------------------------------------

test("a file with nothing on it is a CDC job", () => {
  // The default, and the common case. Complying development is the route most
  // residential jobs take, and a file that has not been told otherwise is on it.
  assert.equal(
    certificateKindFor(engagement()),
    ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
  );
  assert.equal(
    certificateDocumentTypeFor(engagement()),
    ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
  );
});

test("an open development approval requirement makes it a CC job", () => {
  const file = engagement({
    alerts: [openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
  });

  assert.equal(
    certificateKindFor(file),
    ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE,
  );
});

test("a lodged development application keeps it a CC job after the alert closes", () => {
  // The alert resolves when consent is granted, and the job does not go back to
  // being a CDC. The application row is what carries that forward.
  const file = engagement({
    alerts: [] as never,
    externalApplications: [
      application(ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION, {
        appliedAt: MONDAY,
      }),
    ] as never,
  });

  assert.equal(
    certificateKindFor(file),
    ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE,
  );
});

test("the certificate already on the file outranks everything else", () => {
  /**
   * The bug this ordering exists to prevent, pinned.
   *
   * DA_APPROVAL_REQUIRED can be resolved as not applying after all — the issue
   * says so in as many words. A file that was briefly flagged, had a construction
   * certificate issued, and then had the alert cleared would flip back to reading
   * as a CDC job; the certificate in the vault would stop counting as the file's
   * certificate, and a finished job would read as unfinished with no way to say
   * which document was missing.
   *
   * The document is the last word. Whatever anybody believes about the route, the
   * certificate that was actually issued says what it was.
   */
  const file = engagement({
    alerts: [] as never,
    externalApplications: [] as never,
    documents: [
      document(ComplianceDocumentType.CONSTRUCTION_CERTIFICATE),
    ] as never,
  });

  assert.equal(
    certificateKindFor(file),
    ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE,
  );
  assert.equal(hasCertificate(file), true);
});

test("a CDC on the file is read as a CDC even on a job with a DA alert", () => {
  // The same rule from the other side. A certifier who issued a CDC has settled
  // the question of whether the job qualified as complying development.
  const file = engagement({
    alerts: [openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    documents: [
      document(ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE),
    ] as never,
  });

  assert.equal(
    certificateKindFor(file),
    ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
  );
});

test("a certificate row with no file on it does not decide the path", () => {
  // The row is written when the type enters the pack; the file is the evidence.
  // An empty CONSTRUCTION_CERTIFICATE row must not make a CDC job read as a CC
  // one, or every job would take the wrong path the moment a row was seeded.
  const file = engagement({
    documents: [
      document(ComplianceDocumentType.CONSTRUCTION_CERTIFICATE, { files: [] }),
    ] as never,
  });

  assert.equal(
    certificateKindFor(file),
    ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
  );
  assert.equal(hasCertificate(file), false);
});

// ---------------------------------------------------------------------------
// The lodgement gate
// ---------------------------------------------------------------------------

test("nothing is lodged before the certifier has passed the checklist", () => {
  // The gate that takes weeks, checked first. Every other condition is minutes of
  // paperwork; this one is a certifier reading twenty documents.
  const blocked = certificateLodgementBlockedReason(
    engagement({
      status: CertifierEngagementStatus.CHECKLIST_TRACKING,
      principalCertifierAppointedAt: MONDAY,
    }),
  );

  assert.ok(blocked);
  assert.match(blocked, /pass every checklist item/i);
});

test("a CDC needs the principal certifier appointment recorded", () => {
  // The application and the appointment go in together — a CDC cannot be
  // determined without one, so lodging before it is recorded is a fee spent on an
  // application that will not be assessed.
  const blocked = certificateLodgementBlockedReason(engagement());

  assert.ok(blocked);
  assert.match(blocked, /principal certifier/i);
});

test("a CDC with the appointment recorded is clear to lodge", () => {
  assert.equal(
    certificateLodgementBlockedReason(
      engagement({ principalCertifierAppointedAt: MONDAY }),
    ),
    null,
  );
});

test("a CC needs the consent document, not the appointment", () => {
  /**
   * The asymmetry between the two paths, and it is not arbitrary.
   *
   * A construction certificate follows a consent the council has already granted,
   * and the principal certifier is appointed at the notice of commencement —
   * after this block is finished with. Demanding the appointment here would hold a
   * CC job behind a form that is not due yet.
   */
  const file = engagement({
    alerts: [openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
  });

  const blocked = certificateLodgementBlockedReason(file);
  assert.ok(blocked);
  assert.match(blocked, /notice of determination/i);

  const withConsent = engagement({
    alerts: [openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    documents: [document(ComplianceDocumentType.DEVELOPMENT_CONSENT)] as never,
  });

  assert.equal(certificateLodgementBlockedReason(withConsent), null);
});

test("a ticked consent without the notice does not clear the CC gate", () => {
  // The document, not the tick. A certifier asked to certify against a ticked box
  // has nothing to read — the same reading `hasDevelopmentConsent` takes.
  const file = engagement({
    alerts: [openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    externalApplications: [
      application(ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION, {
        appliedAt: MONDAY,
        receivedAt: MONDAY,
      }),
    ] as never,
  });

  assert.ok(certificateLodgementBlockedReason(file));
});

test("the developer's covenant blocks the lodgement last", () => {
  // Last because it is the condition people are least likely to have thought of,
  // so it reads best as the one remaining sentence rather than buried under three
  // others.
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    developerApprovalRequired: true,
    outreaches: [
      developerOutreach([
        approval(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
      ]),
    ] as never,
  });

  const blocked = certificateLodgementBlockedReason(
    file,
    developerPlansBlockedReason(file),
  );

  assert.ok(blocked);
  assert.match(blocked, /estate developer/i);
});

test("an approved design clears the covenant", () => {
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    developerApprovalRequired: true,
    outreaches: [
      developerOutreach([
        approval(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN, {
          decision: ComplianceApprovalDecision.APPROVED,
          decidedAt: MONDAY,
        }),
      ]),
    ] as never,
  });

  assert.equal(developerPlansBlockedReason(file), null);
  assert.equal(
    certificateLodgementBlockedReason(file, developerPlansBlockedReason(file)),
    null,
  );
});

test("a design marked not required clears the covenant", () => {
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    developerApprovalRequired: true,
    documents: [
      document(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN, {
        status: ComplianceDocumentStatus.NOT_REQUIRED,
      }),
    ] as never,
    outreaches: [
      developerOutreach([
        approval(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
      ]),
    ] as never,
  });

  assert.equal(developerPlansBlockedReason(file), null);
});

test("a rejected design quotes the developer's own words back", () => {
  // Load-bearing rather than decorative. "The developer said no" is not something
  // an architect can act on, so the objection travels with the refusal.
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    developerApprovalRequired: true,
    outreaches: [
      developerOutreach([
        approval(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN, {
          decision: ComplianceApprovalDecision.REJECTED,
          decidedAt: MONDAY,
          reason: "The garage setback does not meet the estate guidelines.",
        }),
      ]),
    ] as never,
  });

  const blocked = developerPlansBlockedReason(file);
  assert.ok(blocked);
  assert.match(blocked, /garage setback/);
});

test("a lot with no covenant is never gated on a developer", () => {
  // The common case, and it must cost nothing. Most lots are not in a
  // master-planned estate, and a question about a covenant that does not exist
  // would be a gate on almost every job in the system.
  assert.equal(
    developerPlansBlockedReason(
      engagement({ principalCertifierAppointedAt: MONDAY }),
    ),
    null,
  );
});

test("an unanswered covenant question does not block the lodgement", () => {
  // Null means nobody has been asked, and that is the banner's job rather than
  // this gate's. Holding a finished file behind a question about an estate it
  // probably is not in would be a job stuck on a technicality.
  assert.equal(
    developerPlansBlockedReason(
      engagement({
        principalCertifierAppointedAt: MONDAY,
        developerApprovalRequired: null,
      }),
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// What is left
// ---------------------------------------------------------------------------

test("a lodged application still wants the certificate downloaded", () => {
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    externalApplications: [
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        { appliedAt: MONDAY, approvalNotifiedAt: MONDAY },
      ),
    ] as never,
  });

  const blocked = certificateCompletionBlockedReason(file);
  assert.ok(blocked);
  assert.match(blocked, /download/i);
  // The sentence has to say the email is not the certificate, because that is the
  // misunderstanding the whole state exists because of.
  assert.match(blocked, /notification, not the certificate/i);
});

test("a certificate on the file leaves only the cover", () => {
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    externalApplications: [
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        { appliedAt: MONDAY },
      ),
    ] as never,
    documents: [
      document(ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE),
    ] as never,
  });

  const blocked = certificateCompletionBlockedReason(file);
  assert.ok(blocked);
  assert.match(blocked, /HBCF/i);
});

test("an issued construction certificate satisfies a CDC application", () => {
  const blocked = certificateCompletionBlockedReason(
    engagement({
      externalApplications: [
        application(
          ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
          { appliedAt: MONDAY },
        ),
      ] as never,
      documents: [
        document(ComplianceDocumentType.CONSTRUCTION_CERTIFICATE),
      ] as never,
    }),
  );

  assert.ok(blocked);
  assert.match(blocked, /HBCF/i);
  assert.doesNotMatch(blocked, /notice of determination|lodge/i);
});

test("a cover marked not required is answered", () => {
  // Waved off counts, as it does on every other row: owners covered under an
  // existing policy are not a job to hold open.
  const file = engagement({
    principalCertifierAppointedAt: MONDAY,
    externalApplications: [
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        { appliedAt: MONDAY },
      ),
    ] as never,
    documents: [
      document(ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE),
      document(ComplianceDocumentType.HOME_INSURANCE, {
        files: [],
        status: ComplianceDocumentStatus.NOT_REQUIRED,
      }),
    ] as never,
  });

  assert.equal(certificateCompletionBlockedReason(file), null);
});

test("a completed file is told nothing it still has to do", () => {
  assert.equal(
    certificateCompletionBlockedReason(
      engagement({ status: CertifierEngagementStatus.COMPLETED }),
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// The determined step
// ---------------------------------------------------------------------------

test("a determination is its own step, between lodged and received", () => {
  /**
   * The step the block was missing, and why it is not part of `received`.
   *
   * Before this a determined application stayed on `lodged`, so the block went on
   * reporting how many working days the portal had had it — counting up, on an
   * application that had already been approved. Reading it as `received` is worse:
   * every consumer of that step treats it as the document being here.
   */
  assert.equal(
    externalApplicationStep(
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        { appliedAt: MONDAY },
      ) as never,
    ),
    "lodged",
  );

  assert.equal(
    externalApplicationStep(
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        { appliedAt: MONDAY, approvalNotifiedAt: MONDAY },
      ) as never,
    ),
    "determined",
  );
});

test("a received application outranks a determined one", () => {
  // Both marks can be on a row — the determination read off the email on Monday,
  // the document ticked through on Thursday — and `receivedAt` is the stronger.
  assert.equal(
    externalApplicationStep(
      application(
        ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
        {
          appliedAt: MONDAY,
          approvalNotifiedAt: MONDAY,
          receivedAt: MONDAY,
        },
      ) as never,
    ),
    "received",
  );
});
