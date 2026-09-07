import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  CompliancePartyType,
} from "@prisma/client";

import {
  COMPLIANCE_PARTY_SECTIONS,
  documentTypesForParty,
  PARTY_INBOUND_DOCUMENT_TYPES,
  PARTY_OUTREACH_ATTACHMENTS,
  PARTY_PREREQUISITES,
  partyForDocumentType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
} from "../../constants/complianceDocuments";
import { applicableRequiredDocuments } from "../../lib/compliance/required-pack";
import {
  extractPartyRefToken,
  generatePartyRefToken,
  partyForRefToken,
} from "../../lib/graph/party-subject";
import {
  hasOpenAlert,
  isPartyEngaged,
  openAlerts,
  outreachForParty,
  requiresPlanningCertificate,
} from "../../types/compliance";

// ---------------------------------------------------------------------------
// The section split
// ---------------------------------------------------------------------------

// The compile-time check in the constants file guards this too, but it only
// fires when the types disagree. A required document dropped out of a section
// while both still typecheck -- because it was moved rather than removed --
// renders nowhere, is chased by nobody, and still blocks the outreach that
// demands the whole pack.
test("every required document sits in exactly one party section", () => {
  const sectioned = COMPLIANCE_PARTY_SECTIONS.flatMap(
    (section) => section.types as readonly ComplianceDocumentType[],
  );

  assert.equal(
    sectioned.length,
    new Set(sectioned).size,
    "a document appears in two sections",
  );
  assert.deepEqual(
    [...sectioned].sort(),
    REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type).sort(),
  );
});

test("partyForDocumentType agrees with the sections it was built from", () => {
  for (const section of COMPLIANCE_PARTY_SECTIONS) {
    for (const type of section.types) {
      assert.equal(partyForDocumentType(type), section.party, type);
    }
  }
  // The land deed is collected on the same file but is not part of the pack —
  // the certifier is never sent one — so it belongs to no section.
  assert.equal(partyForDocumentType(ComplianceDocumentType.LAND_DEED), null);
  assert.equal(partyForDocumentType(ComplianceDocumentType.CHECKLIST), null);
});

test("the architect is sent exactly what the surveyor produces", () => {
  assert.deepEqual(
    [...PARTY_OUTREACH_ATTACHMENTS[CompliancePartyType.ARCHITECT]],
    [...documentTypesForParty(CompliancePartyType.SURVEYOR)],
  );
  // The deed is the surveyor's input and nobody else's.
  assert.deepEqual(
    [...PARTY_OUTREACH_ATTACHMENTS[CompliancePartyType.SURVEYOR]],
    [ComplianceDocumentType.LAND_DEED],
  );
  assert.deepEqual(
    [...PARTY_OUTREACH_ATTACHMENTS[CompliancePartyType.COUNCIL]],
    [],
  );
});

// A surveyor does not send architectural plans. Letting their covering email be
// classified as one would overwrite a document that has to come from somebody
// else, which is the whole reason the inbound vocabulary is narrowed per party
// rather than once.
test("no party may be the source of another party's documents", () => {
  for (const section of COMPLIANCE_PARTY_SECTIONS) {
    const allowed = new Set<ComplianceDocumentType>(
      PARTY_INBOUND_DOCUMENT_TYPES[section.party],
    );
    for (const other of COMPLIANCE_PARTY_SECTIONS) {
      if (other.party === section.party) continue;
      for (const type of other.types) {
        assert.equal(
          allowed.has(type),
          false,
          `${section.party} may be classified as ${type}`,
        );
      }
    }
  }
});

test("the surveyor waits on nobody; the others wait on the surveyor", () => {
  assert.deepEqual([...PARTY_PREREQUISITES[CompliancePartyType.SURVEYOR]], []);
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.ARCHITECT]],
    [CompliancePartyType.SURVEYOR],
  );
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.COUNCIL]],
    [CompliancePartyType.SURVEYOR],
  );
});

// A cycle would leave every section in it permanently locked, each waiting on
// the next, with nothing on the tab to say why.
test("the prerequisite graph has no cycles", () => {
  const seen = new Set<CompliancePartyType>();

  const walk = (party: CompliancePartyType, stack: CompliancePartyType[]) => {
    assert.equal(
      stack.includes(party),
      false,
      `cycle through ${[...stack, party].join(" -> ")}`,
    );
    if (seen.has(party)) return;
    seen.add(party);
    for (const next of PARTY_PREREQUISITES[party]) {
      walk(next, [...stack, party]);
    }
  };

  for (const party of Object.values(CompliancePartyType)) {
    walk(party, []);
  }
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test("a minted token round-trips out of a subject line", () => {
  for (const party of Object.values(CompliancePartyType)) {
    const token = generatePartyRefToken(party);
    const subject = `Re: FW: [${token}] 14 Example St, Marrickville`;

    assert.equal(extractPartyRefToken(subject), token);
    assert.equal(partyForRefToken(token), party);
  }
});

// Subjects come back through clients and ticketing systems that lower-case
// them, and the stored refToken is upper case. A case-sensitive match would
// orphan a whole thread over a cosmetic change.
test("a lower-cased subject still resolves its token", () => {
  const token = generatePartyRefToken(CompliancePartyType.SURVEYOR);
  const subject = `re: [${token}] 14 example st`.toLowerCase();

  assert.equal(extractPartyRefToken(subject), token);
});

test("the certifier's own token is not read as a party token", () => {
  assert.equal(
    extractPartyRefToken("[RCCERT-0123456789AB] 14 Example St"),
    null,
  );
  assert.equal(partyForRefToken("RCCERT-0123456789AB"), null);
});

test("a subject with no token, or a malformed one, resolves to null", () => {
  for (const subject of [
    "",
    "14 Example St, Marrickville",
    "[RCSURV-] 14 Example St",
    "[RCSURV-XYZ] 14 Example St",
    // Eleven hex digits, one short.
    "[RCSURV-0123456789A] 14 Example St",
  ]) {
    assert.equal(extractPartyRefToken(subject), null, subject);
  }
  assert.equal(extractPartyRefToken(null), null);
  assert.equal(extractPartyRefToken(undefined), null);
});

test("two minted tokens do not collide", () => {
  const tokens = new Set(
    Array.from({ length: 200 }, () =>
      generatePartyRefToken(CompliancePartyType.ARCHITECT),
    ),
  );
  assert.equal(tokens.size, 200);
});

// ---------------------------------------------------------------------------
// Alerts and what they take out of the pack
// ---------------------------------------------------------------------------

type TestAlert = {
  id: string;
  type: ComplianceAlertType;
  status: ComplianceAlertStatus;
};

const alert = (
  type: ComplianceAlertType,
  status: ComplianceAlertStatus,
): TestAlert => ({ id: `${type}:${status}`, type, status });

const withAlerts = (alerts: TestAlert[]) =>
  ({ alerts }) as unknown as NonNullable<
    Parameters<typeof requiresPlanningCertificate>[0]
  >;

test("a file with no alerts still needs the planning certificate", () => {
  assert.equal(requiresPlanningCertificate(withAlerts([])), true);
  assert.equal(requiresPlanningCertificate(null), true);
  assert.equal(requiresPlanningCertificate(undefined), true);
  assert.equal(
    applicableRequiredDocuments(withAlerts([])).length,
    REQUIRED_COMPLIANCE_DOCUMENTS.length,
  );
});

test("an open DA alert takes the planning certificate out of the pack", () => {
  const engagement = withAlerts([
    alert(ComplianceAlertType.DA_APPROVAL_REQUIRED, ComplianceAlertStatus.OPEN),
  ]);

  assert.equal(requiresPlanningCertificate(engagement), false);

  const applicable = applicableRequiredDocuments(engagement);
  assert.equal(applicable.length, REQUIRED_COMPLIANCE_DOCUMENTS.length - 1);
  assert.equal(
    applicable.some(
      (doc) => doc.type === ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    ),
    false,
  );
});

// An alert's effect lasts exactly as long as it is open. A resolved
// DA_APPROVAL_REQUIRED is history, and history must not still be suppressing a
// document the file has gone back to needing.
test("a resolved DA alert puts the planning certificate back", () => {
  const engagement = withAlerts([
    alert(
      ComplianceAlertType.DA_APPROVAL_REQUIRED,
      ComplianceAlertStatus.RESOLVED,
    ),
  ]);

  assert.equal(requiresPlanningCertificate(engagement), true);
  assert.equal(
    applicableRequiredDocuments(engagement).length,
    REQUIRED_COMPLIANCE_DOCUMENTS.length,
  );
});

test("a stale title search does not touch the planning certificate", () => {
  const engagement = withAlerts([
    alert(ComplianceAlertType.STALE_TITLE_SEARCH, ComplianceAlertStatus.OPEN),
  ]);

  assert.equal(requiresPlanningCertificate(engagement), true);
  assert.equal(
    hasOpenAlert(engagement, ComplianceAlertType.STALE_TITLE_SEARCH),
    true,
  );
  assert.equal(openAlerts(engagement).length, 1);
});

test("openAlerts ignores resolved rows and a missing engagement", () => {
  assert.equal(openAlerts(null).length, 0);
  assert.equal(
    openAlerts(
      withAlerts([
        alert(
          ComplianceAlertType.STALE_TITLE_SEARCH,
          ComplianceAlertStatus.RESOLVED,
        ),
        alert(
          ComplianceAlertType.DA_APPROVAL_REQUIRED,
          ComplianceAlertStatus.OPEN,
        ),
      ]),
    ).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// Whether a party has been dealt with
// ---------------------------------------------------------------------------

const withOutreaches = (parties: CompliancePartyType[]) =>
  ({
    outreaches: parties.map((party) => ({ party, id: `o:${party}` })),
  }) as unknown as NonNullable<Parameters<typeof isPartyEngaged>[0]>;

// The gate downstream sections read is "has this party been dealt with", not
// "did we email anybody" — a client who arrived with their own survey has no
// thread and is nonetheless finished with the surveyor.
test("a party is engaged once an outreach exists, however it was made", () => {
  const engagement = withOutreaches([CompliancePartyType.SURVEYOR]);

  assert.equal(isPartyEngaged(engagement, CompliancePartyType.SURVEYOR), true);
  assert.equal(
    isPartyEngaged(engagement, CompliancePartyType.ARCHITECT),
    false,
  );
  assert.equal(isPartyEngaged(null, CompliancePartyType.SURVEYOR), false);
});

test("outreachForParty finds the row, or nothing", () => {
  const engagement = withOutreaches([
    CompliancePartyType.SURVEYOR,
    CompliancePartyType.COUNCIL,
  ]);

  assert.equal(
    outreachForParty(engagement, CompliancePartyType.COUNCIL)?.party,
    CompliancePartyType.COUNCIL,
  );
  assert.equal(
    outreachForParty(engagement, CompliancePartyType.ARCHITECT),
    undefined,
  );
  assert.equal(
    outreachForParty(undefined, CompliancePartyType.SURVEYOR),
    undefined,
  );
});
