"use server";

import { updateTag } from "next/cache";

import { requireAdminUser } from "@/lib/auth/require-admin";
import prisma from "@/lib/prisma";
import { findUserById } from "@/lib/domain/identity/users";
import { userPrincipal, type UserPrincipal } from "@/lib/domain/principal";
import {
  createTradeType,
  deleteTradeType,
  setTradeTypeArchived,
  updateTradeType,
} from "@/lib/domain/tradies/trade-types";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import { TRADE_TYPES_TAG } from "@/types/trade-type";

// Admin → Trade types. The rules — who may, what a name may be, what cannot
// be renamed or deleted — are lib/domain/tradies/trade-types.ts. These
// authenticate, call it, and drop the cached trade list.
//
// Each checks for an admin itself: a Server Action posts to whatever page it
// was called from, so the /admin route guard does not cover it
// (lib/auth/require-admin.ts).

export type TradeTypeActionResult =
  | { readonly ok: true; readonly tradiesRenamed?: number }
  | DomainActionFailure
  | { readonly ok: false; readonly error: string };

async function adminPrincipal(): Promise<
  UserPrincipal | { readonly ok: false; readonly error: string }
> {
  const access = await requireAdminUser();
  if (!access.ok) return { ok: false, error: access.error };
  const user = await findUserById(access.userId, prisma);
  if (!user) {
    return {
      ok: false,
      error: "Could not verify your permissions. Try again.",
    };
  }
  return userPrincipal(user);
}

async function run(
  write: (
    principal: UserPrincipal,
  ) => Promise<{ renamedTradieIds?: readonly string[] }>,
  failure: string,
): Promise<TradeTypeActionResult> {
  const principal = await adminPrincipal();
  if ("ok" in principal) return principal;

  try {
    const { renamedTradieIds = [] } = await write(principal);
    // updateTag, not revalidateTag: the admin page reloads the pickers' list
    // straight after this returns, and a stale-while-revalidate read would
    // hand it the list from before the edit.
    updateTag(TRADE_TYPES_TAG);
    updateTag("milestone-trade-dependencies");
    // A rename also rewrote those tradies' `trade`, so every cached read that
    // shows one has to go too, or the directory groups them under a name the
    // list no longer has.
    if (renamedTradieIds.length > 0) {
      for (const tag of ["tradies", "tradie-management", "tradies-schedules"]) {
        updateTag(tag);
      }
      for (const id of renamedTradieIds) {
        updateTag(`tradie-${id}`);
      }
    }
    return { ok: true, tradiesRenamed: renamedTradieIds.length };
  } catch (error) {
    const refused = domainActionFailure(error);
    if (refused) return refused;
    console.error(failure, error);
    return { ok: false, error: failure };
  }
}

export async function createTradeTypeAction(input: {
  label: string;
  icon: string;
}): Promise<TradeTypeActionResult> {
  return run(async (principal) => {
    await createTradeType(
      principal,
      { label: String(input?.label ?? ""), icon: String(input?.icon ?? "") },
      prisma,
    );
    return {};
  }, "Couldn't add the trade. Try again.");
}

export async function updateTradeTypeAction(input: {
  id: string;
  label?: string;
  icon?: string;
}): Promise<TradeTypeActionResult> {
  return run(async (principal) => {
    const outcome = await updateTradeType(
      principal,
      {
        id: String(input?.id ?? ""),
        label: input?.label === undefined ? undefined : String(input.label),
        icon: input?.icon === undefined ? undefined : String(input.icon),
      },
      prisma,
    );
    return { renamedTradieIds: outcome.renamedTradieIds };
  }, "Couldn't save the trade. Try again.");
}

export async function setTradeTypeArchivedAction(input: {
  id: string;
  archived: boolean;
}): Promise<TradeTypeActionResult> {
  return run(async (principal) => {
    await setTradeTypeArchived(
      principal,
      { id: String(input?.id ?? ""), archived: input?.archived === true },
      prisma,
    );
    return {};
  }, "Couldn't update the trade. Try again.");
}

export async function deleteTradeTypeAction(input: {
  id: string;
}): Promise<TradeTypeActionResult> {
  return run(async (principal) => {
    await deleteTradeType(principal, { id: String(input?.id ?? "") }, prisma);
    return {};
  }, "Couldn't delete the trade. Try again.");
}
