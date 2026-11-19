import { Role, type User } from "@prisma/client";

import { DomainAuthorizationError } from "./errors";

/**
 * Who is asking.
 *
 * A domain function takes one of these instead of calling `auth()`, reading
 * request headers, or reaching into an Eve `ctx`. The adapter at each channel
 * boundary does that work once and hands the result down — which is what lets
 * the same rule run for a signed-in operator, a cron, an inbound webhook and
 * the open booking route without four copies of it.
 *
 * "Nobody is signed in" is a value here, not an exception. Crons, webhooks and
 * the booking route genuinely have no user, and `lib/data/acting-user.ts`
 * already encodes that: history is written without an `authorId` rather than
 * refused. Making it a variant means a domain function has to decide what an
 * anonymous caller may do, instead of receiving a `null` user and guessing.
 */
export type DomainPrincipal =
  | UserPrincipal
  | SystemPrincipal
  | AnonymousPrincipal;

/** A signed-in application user — from Clerk in the app, from
 * `ctx.session.auth.current` in Eve. Both resolve to the same `User` row. */
export type UserPrincipal = {
  readonly kind: "user";
  readonly userId: string;
  readonly role: Role;
  /**
   * The customer record a portal account belongs to, when there is one.
   *
   * Optional because staff have none and most callers never needed it. A rule
   * that scopes a CUSTOMER to their own records — `projectReadScope` — must
   * treat a missing value as "matches nothing" rather than "matches
   * everything": a portal account whose customer link was never set is
   * exactly the case where a permissive default leaks another client's
   * project.
   */
  readonly customerId?: string | null;
};

/**
 * A trusted internal caller with no human behind it: a cron, an inbound Graph
 * or Xero notification, a queue worker.
 *
 * `reason` names the channel and lands in audit records, so "this was written
 * by nobody" is never the whole story. A system principal is trusted because
 * its channel authenticated (cron secret, webhook signature) — never because
 * the caller said so.
 */
export type SystemPrincipal = {
  readonly kind: "system";
  readonly reason: string;
};

/**
 * An unauthenticated caller on an open route: the public booking page and the
 * inbound lead webhook.
 *
 * These are on the open internet, so the shared-admin argument gives them no
 * cover at all. A domain command reached this way must be explicitly written
 * for it — narrow, idempotent, and unable to widen what it returns.
 */
export type AnonymousPrincipal = {
  readonly kind: "anonymous";
  readonly source: string;
};

export function userPrincipal(
  user: Pick<User, "id" | "role"> & { customerId?: string | null },
): UserPrincipal {
  return {
    customerId: user.customerId ?? null,
    kind: "user",
    role: user.role,
    userId: user.id,
  };
}

export function systemPrincipal(reason: string): SystemPrincipal {
  return { kind: "system", reason };
}

export function anonymousPrincipal(source: string): AnonymousPrincipal {
  return { kind: "anonymous", source };
}

export function isUserPrincipal(
  principal: DomainPrincipal,
): principal is UserPrincipal {
  return principal.kind === "user";
}

/**
 * The user to attribute a write to, or null.
 *
 * Null is a normal answer — a cron or the booking route records the event
 * without attributing it to anyone, which is the behaviour
 * `resolveActingUserId` already has. Callers stamp `authorId` only when this
 * returns one.
 */
export function attributionUserId(principal: DomainPrincipal): string | null {
  return isUserPrincipal(principal) ? principal.userId : null;
}

/** A short label for audit rows and operator-facing history. */
export function describePrincipal(principal: DomainPrincipal): string {
  switch (principal.kind) {
    case "user":
      return `user:${principal.userId}`;
    case "system":
      return `system:${principal.reason}`;
    case "anonymous":
      return `anonymous:${principal.source}`;
  }
}

/**
 * Narrow to a signed-in user, or refuse.
 *
 * For a rule that is meaningless without one — "leads assigned to me", "the
 * offers I may open". A command that a cron legitimately runs should branch on
 * `principal.kind` instead of calling this.
 */
export function requireUserPrincipal(
  principal: DomainPrincipal,
): UserPrincipal {
  if (!isUserPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "This action requires a signed-in user.",
    );
  }
  return principal;
}

/**
 * Roles that are staff rather than a customer portal account.
 *
 * The office is on shared ADMIN logins, and from November 2026 one real
 * SITE_MANAGER holds the role, so this set separates staff from "a customer"
 * and nothing more: it does NOT say who may see leads, offers, client
 * messages or a project's money. Those ask `isOfficeRole` and
 * `canSeeProjectFinancials`, which leave a site manager out. GUEST is inside
 * this set because that is how `lib/offer/access.ts` has always scoped lead
 * access, and splitting the two rules apart is a change of behaviour, not a
 * refactor.
 */
export const INTERNAL_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.SITE_MANAGER,
  Role.GUEST,
];

const INTERNAL_ROLE_SET: ReadonlySet<Role> = new Set(INTERNAL_ROLES);

export function isInternalRole(role: Role): boolean {
  return INTERNAL_ROLE_SET.has(role);
}

/**
 * True for a caller who may act as internal staff.
 *
 * A system principal counts: a cron reconciling schedules or a webhook filing
 * an inbound lead acts with the office's authority by definition, and its
 * channel already authenticated. An anonymous principal never does.
 */
export function isInternalPrincipal(principal: DomainPrincipal): boolean {
  switch (principal.kind) {
    case "user":
      return isInternalRole(principal.role);
    case "system":
      return true;
    case "anonymous":
      return false;
  }
}

/**
 * The people who work the sales side of the business: leads, offers, client
 * calls and texts, ad-hoc email, and the figures that sum them up.
 *
 * `INTERNAL_ROLES` minus SITE_MANAGER. A site manager is staff, and works
 * projects, milestones, tradies and the project's own WhatsApp group — all of
 * which still ask `isInternalRole`. What a site manager has no business with is
 * a prospect's name, number, quoted price or conversation, so every rule that
 * opens those asks this one instead. Two rules, named for what each decides:
 * widening one into the other is how a site manager ended up reading every
 * client's pending calls.
 *
 * GUEST stays inside, for the same reason it stays in `INTERNAL_ROLES`: that is
 * how lead access has always been scoped, and `proxy.ts` already turns a GUEST
 * away from every page.
 */
export function isOfficeRole(role: Role): boolean {
  return isInternalRole(role) && role !== Role.SITE_MANAGER;
}

/**
 * `isOfficeRole` for a principal. A system principal counts (a cron filing an
 * inbound lead acts with the office's authority); an anonymous one never does.
 */
export function isOfficePrincipal(principal: DomainPrincipal): boolean {
  switch (principal.kind) {
    case "user":
      return isOfficeRole(principal.role);
    case "system":
      return true;
    case "anonymous":
      return false;
  }
}

/**
 * Refuse anyone who is not an ADMIN.
 *
 * A system principal passes: the crons and webhooks that reach admin-level
 * commands authenticated on their own channel and have no role to carry.
 */
export function requireAdminPrincipal(principal: DomainPrincipal): void {
  if (principal.kind === "system") return;
  if (principal.kind === "user" && principal.role === Role.ADMIN) return;
  throw new DomainAuthorizationError(
    "This action is restricted to administrators.",
  );
}
