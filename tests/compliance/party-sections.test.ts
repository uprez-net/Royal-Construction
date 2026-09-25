import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import { test } from "vitest";

import { isLockedTradeLabel } from "@/lib/domain/tradies/trade-types";
import {
  CERTIFIER_TRADE_LABEL,
  COMPLIANCE_PARTY_SECTIONS,
  consultantForDocumentType,
  CONSULTANT_DELIVERABLES,
  CONSULTANT_PARTIES,
  documentTypesForParty,
  PARTY_TRADE_LABEL,
  PARTY_INBOUND_DOCUMENT_TYPES,
  PARTY_OUTREACH_ATTACHMENTS,
  isOptionalForOutreach,
  isRequiredDocumentType,
  PARTY_PREREQUISITES,
  partyForDocumentType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  applicableRequiredDocuments,
  outreachRequiredDocuments,
} from "@/lib/domain/compliance/required-pack";
import {
  extractPartyRefToken,
  generatePartyRefToken,
  partyForRefToken,
} from "@/lib/graph/party-subject";
import {
  hasOpenAlert,
  isPartyEngaged,
  openAlerts,
  outreachForParty,
  requiresPlanningCertificate,
} from "@/types/compliance";
import { REPO_ROOT } from "../support/repo-root";

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

test("the architect is sent the surveyor's set and the planning certificate", () => {
  // Everything the surveyor produced, plus the 10.7. The certificate joined
  // this list when it became a prerequisite for engaging an architect at all:
  // it is what says what the lot is allowed to carry, so an architect sent the
  // survey without it draws once and then redraws.
  assert.deepEqual(
    [...PARTY_OUTREACH_ATTACHMENTS[CompliancePartyType.ARCHITECT]],
    [
      ...documentTypesForParty(CompliancePartyType.SURVEYOR),
      ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    ],
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

test("the surveyor waits on nobody; the architect waits on both the others", () => {
  assert.deepEqual([...PARTY_PREREQUISITES[CompliancePartyType.SURVEYOR]], []);
  // The council joined the architect's list rather than replacing the surveyor.
  // Both are genuine: an architect cannot draw against a site with no survey,
  // and cannot draw the right thing without the certificate that says what the
  // lot may carry.
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.ARCHITECT]],
    [CompliancePartyType.SURVEYOR, CompliancePartyType.COUNCIL],
  );
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.COUNCIL]],
    [CompliancePartyType.SURVEYOR],
  );
  // The consultants are gated by a checklist line existing rather than by
  // another party, so they wait on nobody in this table.
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.BASIX_CONSULTANT]],
    [],
  );
  assert.deepEqual(
    [...PARTY_PREREQUISITES[CompliancePartyType.BUSHFIRE_CONSULTANT]],
    [],
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

// ---------------------------------------------------------------------------
// What the outreach waits for
// ---------------------------------------------------------------------------

// A certifier assesses whether a proposal qualifies as complying development
// off the preliminary set and the title documents. The full design is what the
// job is built from, not what it is assessed on, so holding the outreach for it
// delayed the one question worth asking early.
test("the full architectural design is not a precondition for the outreach", () => {
  const engagement = withAlerts([]);
  const waited = outreachRequiredDocuments(engagement).map((doc) => doc.type);

  assert.equal(
    waited.includes(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
    false,
  );
  assert.equal(
    isOptionalForOutreach(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
    true,
  );
});

// It is optional for the send and nothing else: still on the pack, still shown,
// still chased, still sent as an update the moment it lands.
test("the full design stays a required document on the file", () => {
  assert.equal(
    applicableRequiredDocuments(withAlerts([])).some(
      (doc) => doc.type === ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    ),
    true,
  );
  assert.equal(
    isRequiredDocumentType(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
    true,
  );
});

test("every other required document still blocks the outreach", () => {
  const waited = new Set(
    outreachRequiredDocuments(withAlerts([])).map((doc) => doc.type),
  );

  for (const doc of REQUIRED_COMPLIANCE_DOCUMENTS) {
    assert.equal(
      waited.has(doc.type),
      !isOptionalForOutreach(doc.type),
      doc.type,
    );
  }
});

// The two exclusions compose: a DA job waiting only on the full design is ready
// to send, and reading either the wrong way left the send permanently refused.
test("a DA job waiting only on the full design can still be sent", () => {
  const engagement = withAlerts([
    alert(ComplianceAlertType.DA_APPROVAL_REQUIRED, ComplianceAlertStatus.OPEN),
  ]);
  const waited = outreachRequiredDocuments(engagement).map((doc) => doc.type);

  assert.equal(
    waited.includes(ComplianceDocumentType.PLANNING_CERTIFICATE_10_7),
    false,
  );
  assert.equal(
    waited.includes(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
    false,
  );
  assert.equal(waited.length, REQUIRED_COMPLIANCE_DOCUMENTS.length - 2);
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

type TestOutreach = {
  party: CompliancePartyType;
  mode: ComplianceOutreachMode;
  status: ComplianceOutreachStatus;
};

const outreach = (
  party: CompliancePartyType,
  mode: ComplianceOutreachMode = ComplianceOutreachMode.OUTREACH,
  status: ComplianceOutreachStatus = ComplianceOutreachStatus.SENT,
): TestOutreach => ({ party, mode, status });

const withOutreaches = (outreaches: TestOutreach[]) =>
  ({
    outreaches: outreaches.map((row, index) => ({ ...row, id: `o${index}` })),
  }) as unknown as NonNullable<Parameters<typeof isPartyEngaged>[0]>;

// The gate downstream sections read is "has this party been dealt with", not
// "did we email anybody" — a client who arrived with their own survey has no
// thread and is nonetheless finished with the surveyor.
test("a sent outreach engages its party and nobody else's", () => {
  const engagement = withOutreaches([outreach(CompliancePartyType.SURVEYOR)]);

  assert.equal(isPartyEngaged(engagement, CompliancePartyType.SURVEYOR), true);
  assert.equal(
    isPartyEngaged(engagement, CompliancePartyType.ARCHITECT),
    false,
  );
  assert.equal(isPartyEngaged(null, CompliancePartyType.SURVEYOR), false);
});

test("client-supplied documents engage the party with no mail at all", () => {
  const engagement = withOutreaches([
    outreach(
      CompliancePartyType.SURVEYOR,
      ComplianceOutreachMode.SELF_SUPPLIED,
      ComplianceOutreachStatus.NOT_SENT,
    ),
  ]);

  assert.equal(isPartyEngaged(engagement, CompliancePartyType.SURVEYOR), true);
});

// What a send that threw after writing its row leaves behind. Counting it as
// engaged unlocked the section, hid the button that would retry it, and told
// the architect the surveyor was under way — over a surveyor never written to.
test("an outreach whose mail never went out does not engage its party", () => {
  const engagement = withOutreaches([
    outreach(
      CompliancePartyType.SURVEYOR,
      ComplianceOutreachMode.OUTREACH,
      ComplianceOutreachStatus.NOT_SENT,
    ),
  ]);

  assert.equal(isPartyEngaged(engagement, CompliancePartyType.SURVEYOR), false);
  // The row is still there to be found and retried against.
  assert.notEqual(
    outreachForParty(engagement, CompliancePartyType.SURVEYOR),
    undefined,
  );
});

test("a party stays engaged once the thread is live", () => {
  for (const status of [
    ComplianceOutreachStatus.SENT,
    ComplianceOutreachStatus.RESPONSE_RECEIVED,
    ComplianceOutreachStatus.COMPLETE,
  ]) {
    const engagement = withOutreaches([
      outreach(
        CompliancePartyType.ARCHITECT,
        ComplianceOutreachMode.OUTREACH,
        status,
      ),
    ]);
    assert.equal(
      isPartyEngaged(engagement, CompliancePartyType.ARCHITECT),
      true,
      status,
    );
  }
});

test("outreachForParty finds the row, or nothing", () => {
  const engagement = withOutreaches([
    outreach(CompliancePartyType.SURVEYOR),
    outreach(CompliancePartyType.COUNCIL),
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

// ---------------------------------------------------------------------------
// The trade each party is picked from
// ---------------------------------------------------------------------------

test("every party pickable from the directory names a trade that exists", () => {
  // The trade list is the TradeType table now, which an admin edits. What
  // guarantees these labels are in it is the migration that seeds it, and
  // the domain refusing to rename, archive or delete one of them. The failure
  // this guards against is silent: a party whose trade label matches nothing
  // in the directory gets a contact picker that comes back empty however many
  // firms are on the books.
  const seed = readFileSync(
    join(
      REPO_ROOT,
      "prisma/migrations/20260925100000_trade_types/migration.sql",
    ),
    "utf8",
  );
  const seeded = new Set(
    [...seed.matchAll(/^\s*\('([^']+)', '[a-z0-9-]+'\),?$/gm)].map(
      (match) => match[1],
    ),
  );
  assert.ok(seeded.size > 30, "the seed block was not found");

  for (const party of Object.values(CompliancePartyType)) {
    const trade = PARTY_TRADE_LABEL[party];
    // Null is a decision, not an omission: nothing is sent to the council from
    // here, so there is nobody in the directory to pick.
    if (trade === null) continue;

    assert.ok(
      seeded.has(trade),
      `${party} is picked from "${trade}", which the trade list is not seeded with`,
    );
    assert.ok(isLockedTradeLabel(trade), `"${trade}" can be renamed away`);
  }
  assert.ok(seeded.has(CERTIFIER_TRADE_LABEL));
  assert.ok(isLockedTradeLabel(CERTIFIER_TRADE_LABEL));
});

test("every consultant produces something, and every deliverable has a producer", () => {
  // The pair of failures the two tables can drift into. A consultant with no
  // deliverables is a party the outreach asks for nothing; a deliverable
  // claimed by two parties is a checklist row that offers to ring whichever of
  // them the map happened to visit last.
  const claimed = new Map<string, CompliancePartyType>();

  for (const party of CONSULTANT_PARTIES) {
    const produces = CONSULTANT_DELIVERABLES[party] ?? [];
    assert.ok(
      produces.length > 0,
      `${party} is a consultant party that produces nothing`,
    );

    for (const type of produces) {
      assert.equal(
        claimed.get(type),
        undefined,
        `${type} is produced by both ${claimed.get(type)} and ${party}`,
      );
      claimed.set(type, party);
      assert.equal(consultantForDocumentType(type), party);
    }
  }
});
