import { Role } from "@prisma/client";

// Who is calling Royal's number, as far as Royal's own records can say.
//
// Mili answers from Royal's records only for a caller this resolves (issue
// #528). The rule is pure — every record the carrier-provided number matched
// goes in, one answer comes out — so the resolver (resolve.ts) and the
// pre-launch duplicate-number audit (scripts/audit-caller-phones.ts) cannot
// disagree about what a shared number means.
//
// Five classes: ADMIN, SITE_MANAGER, CLIENT (a customer or a lead — one class,
// scoped to their own records), TRADIE, and UNKNOWN. The rule fails closed:
//
//   - Every match is collected before anything is chosen. Never the first row,
//     and never the union of two people's permissions.
//   - Client records that are plainly one person combine: a customer, the
//     portal account linked to it, leads whose project that customer owns,
//     and leads/customers carrying the same name. That is one subject.
//   - Anything else that shares the number — a second person, a second role,
//     a staff number also typed onto a lead — is AMBIGUOUS, and the caller gets
//     message taking until a person sorts the record out.
//   - A GUEST account, a portal account with no customer link, an archived
//     tradie and an archived-only lead grant nothing. They still count as a
//     person on that number, so they make a match ambiguous rather than
//     silently stepping aside.
//
// A CommsTeamPhone is deliberately not a source: a phone the office dials out
// through says nothing about who holds it.

export type VoiceCallerClass =
  | "admin"
  | "site_manager"
  | "client"
  | "tradie"
  | "unknown";

/** Why a caller resolved to no protected access. Audit metadata only. */
export type UnknownCallerReason =
  /** COMMS_AGENT_DISCLOSURE_ENABLED is off. */
  | "disabled"
  /** No number, or one that is not a valid phone number. */
  | "withheld"
  | "unmatched"
  | "ambiguous"
  /** A GUEST, or a portal account with no customer behind it. */
  | "unsupported"
  /** Only archived records matched. */
  | "inactive"
  /** Not an inbound call this stream belongs to. */
  | "not_inbound"
  /** The resolver, database or briefing failed. */
  | "error";

/** One record the caller's number matched, with what the rule needs of it. */
export type CallerMatch =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly role: Role;
      readonly customerId: string | null;
      readonly name: string;
    }
  | {
      readonly kind: "customer";
      readonly id: string;
      readonly name: string;
    }
  | {
      readonly kind: "lead";
      readonly id: number;
      /** Which of the lead's two people the number belongs to. */
      readonly via: "primary" | "secondary";
      /** That person's name: `name`, or `secondaryName`. */
      readonly personName: string;
      readonly archived: boolean;
      readonly projectId: string | null;
      /** Every owner of the lead's project, when it has one. */
      readonly projectCustomerIds: readonly string[];
    }
  | {
      readonly kind: "tradie";
      readonly id: string;
      readonly name: string;
      readonly archived: boolean;
    };

export type ResolvedCallerIdentity =
  | { readonly class: "unknown"; readonly reason: UnknownCallerReason }
  | {
      readonly class: "admin" | "site_manager";
      readonly userId: string;
      readonly firstName: string | null;
    }
  | {
      readonly class: "tradie";
      readonly tradieId: string;
      readonly firstName: string | null;
    }
  | {
      readonly class: "client";
      /** Customers the number itself (or their portal account) matched. */
      readonly customerIds: readonly string[];
      /** Live leads the number matched. */
      readonly leadIds: readonly number[];
      readonly firstName: string | null;
    };

export function unknownCaller(
  reason: UnknownCallerReason,
): ResolvedCallerIdentity {
  return { class: "unknown", reason };
}

/** "  Jane   O'Brien " → "Jane". Null when there is nothing to call them. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && first.length <= 40 ? first : null;
}

/** Names compared as letters only: "Jane O'Brien" and "jane obrien" match. */
function nameKey(name: string | null | undefined): string | null {
  const key = (name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return key.length >= 2 ? key : null;
}

/** A tiny union-find over string keys, for grouping client records. */
function groups(keys: readonly string[], edges: readonly [string, string][]) {
  const parent = new Map<string, string>(keys.map((key) => [key, key]));
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  for (const [a, b] of edges) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map<string, string[]>();
  for (const key of keys) {
    const root = find(key);
    byRoot.set(root, [...(byRoot.get(root) ?? []), key]);
  }
  return [...byRoot.values()];
}

type Person =
  | {
      readonly type: "staff";
      readonly match: Extract<CallerMatch, { kind: "user" }>;
    }
  | { readonly type: "blocked"; readonly reason: "unsupported" | "inactive" }
  | {
      readonly type: "tradie";
      readonly match: Extract<CallerMatch, { kind: "tradie" }>;
    }
  | {
      readonly type: "client";
      readonly customerIds: readonly string[];
      readonly leadIds: readonly number[];
      readonly names: readonly string[];
    };

/**
 * Every match for one number → one caller, or UNKNOWN with why.
 *
 * Exported for the duplicate-number audit, which runs the same rule over
 * every number on file.
 */
export function classifyCallerMatches(
  matches: readonly CallerMatch[],
): ResolvedCallerIdentity {
  if (matches.length === 0) return unknownCaller("unmatched");

  const people: Person[] = [];

  // Client records: customers, portal accounts linked to one, and leads.
  const clientKeys: string[] = [];
  const edges: [string, string][] = [];
  const nameOf = new Map<string, string>();
  const live = new Set<string>();

  for (const match of matches) {
    switch (match.kind) {
      case "user":
        if (match.role === Role.ADMIN || match.role === Role.SITE_MANAGER) {
          people.push({ match, type: "staff" });
        } else if (match.role === Role.CUSTOMER && match.customerId) {
          // The portal account and its customer are one person.
          const key = `customer:${match.customerId}`;
          clientKeys.push(key);
          live.add(key);
          // The customer record's own name, when it matched too, wins.
          if (!nameOf.has(key)) nameOf.set(key, match.name);
        } else {
          people.push({ reason: "unsupported", type: "blocked" });
        }
        break;
      case "tradie":
        people.push(
          match.archived
            ? { reason: "inactive", type: "blocked" }
            : { match, type: "tradie" },
        );
        break;
      case "customer": {
        const key = `customer:${match.id}`;
        clientKeys.push(key);
        live.add(key);
        nameOf.set(key, match.name);
        break;
      }
      case "lead": {
        const key = `lead:${match.id}`;
        clientKeys.push(key);
        nameOf.set(key, match.personName);
        if (!match.archived) live.add(key);
        // A lead and the owners of the project it became are one subject.
        for (const customerId of match.projectCustomerIds) {
          edges.push([key, `customer:${customerId}`]);
        }
        break;
      }
    }
  }

  // The same name on two client records sharing this number: one person
  // (a repeat enquiry, or the customer their lead became).
  const byName = new Map<string, string>();
  for (const key of clientKeys) {
    const name = nameKey(nameOf.get(key));
    if (!name) continue;
    const first = byName.get(name);
    if (first) edges.push([first, key]);
    else byName.set(name, key);
  }

  const matchedKeys = new Set(clientKeys);
  for (const group of groups([...matchedKeys], edges)) {
    const grantKeys = group.filter((key) => live.has(key));
    if (grantKeys.length === 0) {
      people.push({ reason: "inactive", type: "blocked" });
      continue;
    }
    people.push({
      customerIds: grantKeys
        .filter((key) => key.startsWith("customer:"))
        .map((key) => key.slice("customer:".length)),
      leadIds: grantKeys
        .filter((key) => key.startsWith("lead:"))
        .map((key) => Number(key.slice("lead:".length))),
      names: group.map((key) => nameOf.get(key) ?? ""),
      type: "client",
    });
  }

  // Staff are unique per number (User.phone is unique), but two rows for one
  // person in two tables are still two people as far as this rule can tell.
  if (people.length !== 1) return unknownCaller("ambiguous");
  const [person] = people;
  switch (person.type) {
    case "blocked":
      return unknownCaller(person.reason);
    case "staff":
      return {
        class: person.match.role === Role.ADMIN ? "admin" : "site_manager",
        firstName: firstNameOf(person.match.name),
        userId: person.match.id,
      };
    case "tradie":
      return {
        class: "tradie",
        firstName: firstNameOf(person.match.name),
        tradieId: person.match.id,
      };
    case "client":
      return {
        class: "client",
        customerIds: [...new Set(person.customerIds)].sort(),
        firstName: firstNameOf(person.names.find((name) => name.trim())),
        leadIds: [...new Set(person.leadIds)].sort((a, b) => a - b),
      };
  }
}

/**
 * Who Mili may treat the caller as, for the rest of one call.
 *
 * Not a `DomainPrincipal`, on purpose: no existing scope accepts it, so it
 * cannot be passed to `projectReadScope`, `leadListScope` or any other rule
 * written for a signed-in user. The voice reads in this folder take it and
 * re-check the relationship they read on every call.
 *
 * `verification` is how the caller was identified. Today that is the
 * carrier-provided number alone (a deliberate product decision recorded in the
 * runbook); a possession challenge would add its own value here and the reads
 * would not change.
 */
export type VoiceCallerPrincipal = {
  readonly kind: "voice-caller";
  readonly callId: string;
  /** E.164, from the carrier — never spoken by the caller. Never logged. */
  readonly callerNumber: string | null;
  readonly verification: "caller_id" | null;
  readonly identity: ResolvedCallerIdentity;
};

/**
 * The authority a stream token carries: this stream belongs to this call.
 * Made by the voice adapter only after it has verified the token it signed.
 */
export type VoiceCallAuthority = {
  readonly kind: "voice-call";
  readonly callId: string;
  readonly providerCallId: string;
};

export function voiceCallAuthority(claims: {
  readonly callId: string;
  readonly callControlId: string;
}): VoiceCallAuthority {
  return {
    callId: claims.callId,
    kind: "voice-call",
    providerCallId: claims.callControlId,
  };
}

/** A caller Mili treats as unknown: message taking only. */
export function unknownVoiceCaller(
  callId: string,
  reason: UnknownCallerReason,
): VoiceCallerPrincipal {
  return {
    callId,
    callerNumber: null,
    identity: unknownCaller(reason),
    kind: "voice-caller",
    verification: null,
  };
}
