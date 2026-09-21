import { randomBytes } from "node:crypto";

import { CompliancePartyType } from "@prisma/client";

// Correlation for the surveyor, architect and council threads. The certifier's
// own version of this lives in lib/graph/certifier-subject.ts and is left
// alone: it is load-bearing for a flow already in production, and the address
// helpers it exports are shared rather than duplicated here.

/**
 * The token prefix each party's thread is minted under.
 *
 * Distinct prefixes rather than one shared "[RCPTY-…]" because the prefix is
 * the only part of a subject a human reads as meaning anything — a surveyor
 * forwarding a job to a colleague can see at a glance which thread it belongs
 * to — and because it makes a mis-routed message obvious in a log rather than
 * indistinguishable from a correct one.
 */
const PARTY_TOKEN_PREFIX: Readonly<Record<CompliancePartyType, string>> = {
  [CompliancePartyType.SURVEYOR]: "RCSURV",
  [CompliancePartyType.ARCHITECT]: "RCARCH",
  [CompliancePartyType.COUNCIL]: "RCCOUN",
  [CompliancePartyType.BASIX_CONSULTANT]: "RCBSIX",
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: "RCBUSH",
  [CompliancePartyType.STRUCTURAL_ENGINEER]: "RCSTRU",
  [CompliancePartyType.WATER_AUTHORITY]: "RCWATR",
  [CompliancePartyType.TRAFFIC_CONSULTANT]: "RCTRAF",
  [CompliancePartyType.DEVELOPER]: "RCDEVL",
};

const PARTY_BY_PREFIX: ReadonlyMap<string, CompliancePartyType> = new Map(
  Object.entries(PARTY_TOKEN_PREFIX).map(([party, prefix]) => [
    prefix,
    party as CompliancePartyType,
  ]),
);

/**
 * Any party token quoted in a subject line.
 *
 * Case-insensitive on the prefix as well as the hex, exactly as the certifier
 * regex is and for the same reason: subjects come back through clients and
 * ticketing systems that lower-case them, and the stored refToken is upper
 * case, so a case-sensitive prefix would orphan a whole thread over a cosmetic
 * change.
 */
const PARTY_TOKEN_RE =
  /\[((?:RCSURV|RCARCH|RCCOUN|RCBSIX|RCBUSH|RCSTRU|RCWATR|RCTRAF|RCDEVL)-[0-9A-F]{12})\]/i;

/**
 * The party token in a subject, upper-cased, or null.
 *
 * Scans rather than anchors, so any number of "Re:"/"Fw:" prefixes — and a
 * surveyor who retypes the subject with the token still on it — all resolve.
 */
export function extractPartyRefToken(
  subject: string | undefined | null,
): string | null {
  if (!subject) {
    return null;
  }
  const match = PARTY_TOKEN_RE.exec(subject);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Which party a token belongs to, read off its prefix.
 *
 * Used only to narrow what an inbound attachment may be classified as before
 * the row is loaded. The row itself is still the authority on which outreach a
 * token names — this is a hint that saves nothing being trusted.
 */
export function partyForRefToken(
  refToken: string | undefined | null,
): CompliancePartyType | null {
  if (!refToken) {
    return null;
  }
  const prefix = refToken.split("-")[0]?.toUpperCase() ?? "";
  return PARTY_BY_PREFIX.get(prefix) ?? null;
}

/**
 * A fresh token for one party's thread.
 *
 * Six random bytes, matching the certifier and offer tokens. It is not a secret
 * — it appears in a subject line — it only has to be unguessable enough that
 * two live threads never collide.
 */
export function generatePartyRefToken(party: CompliancePartyType): string {
  return `${PARTY_TOKEN_PREFIX[party]}-${randomBytes(6)
    .toString("hex")
    .toUpperCase()}`;
}

/**
 * The subject a party thread is opened with.
 *
 * Same shape as the certifier's, deliberately: token first so it survives a
 * client that truncates, address after so a human scanning an inbox can tell
 * one job from another without opening anything. Both sides of this system read
 * subjects the same way, and a second format would be a second thing to get
 * wrong.
 */
export function buildPartySubject(
  refToken: string,
  subjectAddress: string,
): string {
  return `[${refToken}] ${subjectAddress}`.trim();
}
