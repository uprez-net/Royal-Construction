"use server";

import { auth } from "@clerk/nextjs/server";
import { assertCanAccessLead } from "@/lib/offer/access";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  generateInclusionCopy,
  MAX_INCLUSION_COPY_ITEMS,
} from "@/lib/offer/inclusion-copy-ai";
import type { InclusionCopyPatch } from "@/lib/offer/workspace-model";

// Draft the derived copy for inclusion entries: the short label printed beside
// the price, and the Category column value. Never the spec — see
// inclusion-copy-ai.ts for why that line matters.
//
// Returns PATCHES rather than mutating: the workspace draft is client state and
// the estimator reviews every suggestion before it is saved or sent.

export type InclusionCopyDraftResult =
  | { ok: true; patches: readonly InclusionCopyPatch[] }
  | { ok: false; message: string };

export async function draftInclusionCopy(input: {
  readonly leadId: number;
  readonly entries: readonly {
    readonly index: number;
    readonly spec: string;
    // Ask for a label for this row (it is featured beside the price).
    readonly wantSummary: boolean;
    // Ask for a category (this row would otherwise print "Miscellaneous").
    readonly wantCategory: boolean;
  }[];
}): Promise<InclusionCopyDraftResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return { ok: false, message: "No matching user." };
  }
  try {
    await assertCanAccessLead(user, input.leadId);
  } catch {
    return { ok: false, message: "You do not have access to this lead." };
  }

  const wanted = input.entries.filter(
    (entry) =>
      (entry.wantSummary || entry.wantCategory) && entry.spec.trim().length > 0,
  );
  if (wanted.length === 0) {
    return { ok: true, patches: [] };
  }
  if (wanted.length > MAX_INCLUSION_COPY_ITEMS) {
    return {
      ok: false,
      message: `Too many inclusions to draft at once (${wanted.length}, limit ${MAX_INCLUSION_COPY_ITEMS}).`,
    };
  }

  const result = await generateInclusionCopy(
    wanted.map((entry) => ({ index: entry.index, spec: entry.spec })),
  );
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const wantedByIndex = new Map(wanted.map((entry) => [entry.index, entry]));
  const patches: InclusionCopyPatch[] = [];
  for (const suggestion of result.suggestions) {
    const request = wantedByIndex.get(suggestion.index);
    if (!request) continue;
    // Only return what was actually asked for, so a model that helpfully
    // supplies a category for a row that already has one cannot overwrite it.
    const patch: InclusionCopyPatch = {
      index: suggestion.index,
      ...(request.wantSummary && suggestion.summary.length > 0
        ? { summary: suggestion.summary }
        : {}),
      ...(request.wantCategory && suggestion.category.length > 0
        ? { category: suggestion.category }
        : {}),
    };
    if (patch.summary !== undefined || patch.category !== undefined) {
      patches.push(patch);
    }
  }

  return { ok: true, patches };
}
