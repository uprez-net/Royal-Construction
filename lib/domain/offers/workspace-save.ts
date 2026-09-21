import { type OfferStatus, Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import { authorizeOffer } from "../access/offers";
import {
  CURRENT_CALC_VERSION,
  LEGACY_CALC_VERSION,
  deserializeWorkspace,
  parseWorkspaceState,
  planWorkspaceSave,
  serializeWorkspace,
  validatePersistedWorkspace,
  type OfferWorkspaceSnapshot,
  type PersistedOfferWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { splitContractValueByGst } from "@/lib/offer/workspace-pricing";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";

// Saving an offer workspace: the one implementation.
//
// This is the single most customer-visible write in the application. The three
// money columns it derives are what the Offers list prints, what the proposal
// PDF prints, and what the lead's deal value becomes — so two implementations
// of it is two different prices for the same offer.
//
// And there were two. The app's (lib/data/offer-workspace.ts) pinned the
// calculation version, handled an unreadable stored snapshot, distinguished a
// superseded revision from a stale one, and synced the lead's deal value.
// Eve's (agent/lib/offer-operations.ts) did none of those four. An offer
// edited through Eve kept a lead value from whenever it was last touched in
// the app, and a tab that had been superseded was told its version was stale —
// a recovery that reconciles against a revision that is no longer live.
//
// The app's is the canonical one, extracted here whole. Eve's is gone.

export type SaveOfferWorkspaceResult =
  | {
      ok: true;
      stateVersion: number;
      /**
       * Whether any of the four money columns actually moved. The Offers list
       * and its KPIs print them from a cached read, and most autosaves are
       * copy edits, so the App adapter uses this to decide whether to expire
       * that cache. Not a Next concept — just "did the price change".
       */
      moneyChanged: boolean;
      contractValueIncGst: number;
      totalIncGst: number;
      /**
       * The status the offer was at when the save landed. Returned because the
       * save already read it under the same predicate that guarded the write —
       * a caller that wants to record the edit in the offer's timeline would
       * otherwise re-read it, and could read a different one.
       */
      offerStatus: OfferStatus;
    }
  | { ok: false; reason: "superseded" }
  | { ok: false; reason: "locked"; error?: string }
  | { ok: false; reason: "invalid"; error?: string }
  | { ok: false; reason: "stale"; currentStateVersion: number | null };

/**
 * Sections of the workspace a patch may name.
 *
 * A patch arrives from an Eve tool call, so it is an allowlist rather than a
 * blocklist: an unknown key is refused, never merged. Kept beside the save it
 * guards so the two cannot drift.
 */
export const OFFER_WORKSPACE_PATCH_KEYS: ReadonlySet<string> = new Set([
  "adminContentVersion",
  "allowances",
  "areaCalculator",
  "calcVersion",
  "costLines",
  "draft",
  "exclusions",
  "images",
  "job",
  "overrideReason",
  "paymentSchedule",
  "priceAdjustmentLabel",
  "pricingSettings",
  "rateCardProduct",
  "rateCardTier",
  "selectedPriceCents",
  "standardPriceCents",
  "tenderGate",
]);

// The ONLY place CURRENT_CALC_VERSION is named on the server. See the
// CalcVersion notes in lib/offer/workspace-persistence.ts.
function pinCalcVersion(
  persisted: PersistedOfferWorkspaceState,
  storedCalcVersion: number | null,
): PersistedOfferWorkspaceState {
  return {
    ...persisted,
    calcVersion: storedCalcVersion ?? CURRENT_CALC_VERSION,
  };
}

function sameMoney(
  stored: Prisma.Decimal | null,
  next: Prisma.Decimal,
): boolean {
  return stored !== null && stored.equals(next);
}

/**
 * Read the calc-version pin off a raw stored blob without running the full
 * parse — this runs on the save path and must not throw on an offer whose
 * state is otherwise unparseable. A blob with no pin is pre-versioning.
 */
function readStoredCalcVersion(state: unknown): number | null {
  if (state === null || state === undefined) return null;
  if (typeof state !== "object") return LEGACY_CALC_VERSION;
  const raw = (state as Record<string, unknown>).calcVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? raw
    : LEGACY_CALC_VERSION;
}

/**
 * Persist a whole workspace snapshot with optimistic concurrency (ADR 0002).
 *
 * The write lands only if the caller's `stateVersion` still matches, so a
 * second tab cannot clobber a newer save. With two or three staff sharing a
 * login this is rarely two people at once — it is one person with the offer
 * open twice, or a retry after a timeout — which is exactly why the version
 * has to be in the predicate rather than checked and then trusted.
 */
export async function saveOfferWorkspace(
  principal: DomainPrincipal,
  input: {
    offerId: string;
    expectedStateVersion: number;
    snapshot: OfferWorkspaceSnapshot;
  },
  db: DomainDb,
): Promise<SaveOfferWorkspaceResult> {
  // allowInactive so a superseded revision comes back as a recoverable result
  // rather than a throw: a second tab that was editing this offer when another
  // tab forked a revision should reload onto the live one, not sit in a
  // permanent error state.
  const access = await authorizeOffer(principal, input.offerId, db, {
    allowInactive: true,
  });
  if (!access.isActive) return { ok: false, reason: "superseded" };

  // The offer's calculation rules are stamped by the SERVER, never taken from
  // the client: this persists the client's serialized snapshot wholesale, so a
  // stale tab could otherwise up- or down-grade the maths of a live quote. A
  // row that has never been saved is a brand-new offer and gets today's rules;
  // anything already saved keeps its stored pin forever.
  const storedRow = await db.offer.findUnique({
    select: {
      amount: true,
      contractValueIncGst: true,
      gstAmount: true,
      offerStatus: true,
      totalAmount: true,
      workspaceState: true,
    },
    where: { id: input.offerId },
  });
  if (storedRow === null) {
    return { currentStateVersion: null, ok: false, reason: "stale" };
  }

  const persisted = pinCalcVersion(
    serializeWorkspace(input.snapshot),
    readStoredCalcVersion(storedRow.workspaceState),
  );
  const validated = validatePersistedWorkspace(persisted);
  if (!validated.ok) {
    console.error(
      `[offers] refused an invalid snapshot for offer ${input.offerId}: ${validated.error}`,
    );
    return { error: validated.error, ok: false, reason: "invalid" };
  }

  // The workspace locks a step's controls once the offer is issued, but this
  // writes the whole snapshot it is given. A tab still showing the offer as
  // pending after another tab sent it could otherwise change the cost lines
  // and reprice an issued offer. An accepted save still writes the frozen
  // parts as stored, so a tab's hydrated form of them never moves the price.
  const storedStatus =
    storedRow.offerStatus.toLowerCase() as OfferWorkspaceStatus;
  let storedState: PersistedOfferWorkspaceState | null = null;
  if (storedRow.workspaceState !== null) {
    try {
      storedState = parseWorkspaceState(storedRow.workspaceState);
    } catch (error) {
      // Unreadable, so nothing can be compared. A pending offer has no issued
      // record to protect and the save repairs the row; an issued one keeps it.
      if (storedStatus !== "pending") {
        console.error(
          `[offers] stored snapshot for issued offer ${input.offerId} is unreadable; refusing the save:`,
          error,
        );
        return { ok: false, reason: "locked" };
      }
    }
  }

  const plan = planWorkspaceSave(storedStatus, storedState, validated.state);
  if (!plan.ok) {
    return {
      error:
        "Issued offer details are locked; create a revision before editing them.",
      ok: false,
      reason: "locked",
    };
  }

  const savedSnapshot = deserializeWorkspace(plan.state);
  // Resolve the price through the same path the Tender/Contract and the
  // project handoff use. `selectedPriceCents` is only the OPTIONAL manual
  // override, and a blank override serialises to 0 cents — so reading it here
  // stamped $0 on every offer priced the normal way.
  //
  // Deliberately the written state, not the input snapshot: the money columns
  // must agree with what was actually persisted, including its calculation
  // rules and, once issued, its stored frozen slices.
  const selectedContractValueIncGst =
    buildProposalInput(savedSnapshot).customerPrice.selectedContractValueIncGst;
  const contractValue = new Prisma.Decimal(selectedContractValueIncGst);
  // Derived from the SAME number the proposal document prints, so the list and
  // the PDF can never disagree — see splitContractValueByGst for why GST is a
  // back-solve rather than a multiplication.
  const priceSplit = splitContractValueByGst({
    contractValueIncGst: selectedContractValueIncGst,
    gstRate: savedSnapshot.workspacePricingSettings.gstRate,
  });
  const amount = new Prisma.Decimal(priceSplit.amountExGst);
  const gstAmount = new Prisma.Decimal(priceSplit.gstAmount);
  const totalAmount = new Prisma.Decimal(priceSplit.totalIncGst);
  const moneyChanged =
    !sameMoney(storedRow.amount, amount) ||
    !sameMoney(storedRow.gstAmount, gstAmount) ||
    !sameMoney(storedRow.totalAmount, totalAmount) ||
    !sameMoney(storedRow.contractValueIncGst, contractValue);

  // isActive is part of the predicate, not just the check above: forking a
  // revision deactivates this row without touching its stateVersion, so a save
  // that passed the check moments earlier would still satisfy an id+version
  // predicate and land on the freshly archived revision. offerStatus is there
  // for the same reason: the lock above was decided against that status, and a
  // send landing in between must not let this write through.
  const result = await db.offer.updateMany({
    data: {
      amount,
      contractValueIncGst: contractValue,
      gstAmount,
      stateVersion: { increment: 1 },
      totalAmount,
      workspaceState: plan.state as unknown as Prisma.InputJsonValue,
    },
    where: {
      id: input.offerId,
      isActive: true,
      offerStatus: storedRow.offerStatus,
      stateVersion: input.expectedStateVersion,
    },
  });

  if (result.count === 0) {
    const current = await db.offer.findUnique({
      select: { isActive: true, stateVersion: true },
      where: { id: input.offerId },
    });
    // Distinguish the two ways the predicate can miss — they need different
    // recoveries: a stale version reconciles against the same revision, a
    // superseded one has to move to whichever revision is now live.
    if (current !== null && !current.isActive) {
      return { ok: false, reason: "superseded" };
    }
    return {
      currentStateVersion: current?.stateVersion ?? null,
      ok: false,
      reason: "stale",
    };
  }

  await syncLeadDealValue(input.offerId, contractValue, db);

  return {
    contractValueIncGst: selectedContractValueIncGst,
    moneyChanged,
    offerStatus: storedRow.offerStatus,
    ok: true,
    stateVersion: input.expectedStateVersion + 1,
    totalIncGst: priceSplit.totalIncGst,
  };
}

/**
 * Keep the lead's deal value in step with the quoted contract price.
 *
 * `Offer.contractValueIncGst` is the authoritative number once an offer
 * exists; a second hand-typed figure on the lead would only ever disagree with
 * it, and would leave the pipeline blank at exactly the stages where a real
 * price is known.
 *
 * Deliberately non-fatal. The offer write has ALREADY committed and bumped
 * stateVersion; letting a sync failure throw would report the save as failed
 * while it actually succeeded, and the client would then retry against a stale
 * expectedStateVersion and be told it is superseded.
 *
 * Eve's copy of the save simply did not do this, so an offer priced through
 * the agent left the pipeline showing whatever the lead was last worth.
 */
async function syncLeadDealValue(
  offerId: string,
  contractValue: Prisma.Decimal,
  db: DomainDb,
): Promise<void> {
  if (!contractValue.greaterThan(0)) return;
  try {
    const offerLead = await db.offer.findUnique({
      select: { leadId: true },
      where: { id: offerId },
    });
    if (!offerLead?.leadId) return;

    await db.lead.updateMany({
      data: {
        estimatedValue: contractValue,
        estimatedValueSource: "OFFER",
      },
      where: {
        id: offerLead.leadId,
        // Match the two syncable states EXPLICITLY. `NOT: { source: "MANUAL" }`
        // looks equivalent but is not: it compiles to NOT (col = 'MANUAL'),
        // which evaluates to NULL — not true — for rows where the column is
        // NULL. That is every lead never manually overridden, so the sync
        // would silently skip almost everything. Verified against Postgres.
        OR: [{ estimatedValueSource: null }, { estimatedValueSource: "OFFER" }],
      },
    });
  } catch (error) {
    console.error(
      `[offers] lead value sync failed for offer ${offerId}; the offer itself saved successfully`,
      error,
    );
  }
}

/**
 * Apply a partial change to a stored workspace, then save it.
 *
 * Eve's tools express an edit as a patch rather than a whole snapshot, because
 * the agent has not loaded the workspace into a form. The patch is merged onto
 * what is stored and then goes through exactly the same save — the allowlist,
 * the calc-version pin, the lock, the GST split, the optimistic predicate and
 * the lead sync — instead of a parallel write that had four of those.
 *
 * `draft` merges one level deep; every other section is replaced wholesale.
 * That asymmetry is the existing behaviour and is load-bearing: the draft is a
 * bag of independent text fields an agent edits one at a time, while a cost
 * line array replaced field-by-field would produce a hybrid nobody authored.
 */
export async function applyOfferWorkspacePatch(
  principal: DomainPrincipal,
  input: {
    offerId: string;
    expectedStateVersion: number;
    patch: Record<string, unknown>;
  },
  db: DomainDb,
): Promise<SaveOfferWorkspaceResult> {
  const unknownKey = Object.keys(input.patch).find(
    (key) => !OFFER_WORKSPACE_PATCH_KEYS.has(key),
  );
  if (unknownKey !== undefined) {
    return {
      error: "The patch contains an unsupported offer workspace section.",
      ok: false,
      reason: "invalid",
    };
  }

  const access = await authorizeOffer(principal, input.offerId, db, {
    allowInactive: true,
  });
  if (!access.isActive) return { ok: false, reason: "superseded" };

  const stored = await db.offer.findUnique({
    select: { workspaceState: true },
    where: { id: input.offerId },
  });
  if (stored === null) {
    return { currentStateVersion: null, ok: false, reason: "stale" };
  }
  if (stored.workspaceState === null) {
    return {
      error: "Save an initial offer workspace before applying detail changes.",
      ok: false,
      reason: "invalid",
    };
  }

  let current: PersistedOfferWorkspaceState;
  try {
    current = parseWorkspaceState(stored.workspaceState);
  } catch {
    return {
      error: "The stored offer workspace could not be read.",
      ok: false,
      reason: "locked",
    };
  }

  const merged = mergeWorkspacePatch(
    current as unknown as Record<string, unknown>,
    input.patch,
  );
  const validated = validatePersistedWorkspace(merged);
  if (!validated.ok) {
    return { error: validated.error, ok: false, reason: "invalid" };
  }

  return saveOfferWorkspace(
    principal,
    {
      expectedStateVersion: input.expectedStateVersion,
      offerId: input.offerId,
      snapshot: deserializeWorkspace(validated.state),
    },
    db,
  );
}

function mergeWorkspacePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (
      key === "draft" &&
      typeof value === "object" &&
      value !== null &&
      typeof current.draft === "object" &&
      current.draft !== null
    ) {
      merged.draft = {
        ...(current.draft as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
