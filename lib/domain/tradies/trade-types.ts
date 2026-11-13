import { Prisma, type TradeType } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { assertCanReadTradieDirectory } from "../access/tradies";
import { DIRECTORY_PICKED_TRADE_LABELS } from "@/constants/complianceDocuments";
import {
  isTradeIconKey,
  type TradeIconKey,
  type TradeTypeAdminRow,
  type TradeTypeOption,
} from "@/types/trade-type";

// The trade list: what a tradie's `trade` may be, and who may change the list.
//
// It used to be a constant (constants/tradieTypes.ts), so adding "Lighting"
// needed a deploy. It is a table now, edited under Admin → Trade types.
//
// `Tradie.trade` keeps holding the label rather than a foreign key. Every
// screen, the Compliance tab's contact pickers and Eve already read it that
// way, and a label is what an operator sees. The cost is that a rename has to
// carry the tradies with it, which `updateTradeType` does in one transaction.

const MAX_LABEL_LENGTH = 60;

/** Glyph for a row whose stored icon is no longer one the app draws. */
const FALLBACK_ICON: TradeIconKey = "hard-hat";

function cleanLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function sameLabel(a: string, b: string): boolean {
  return a.localeCompare(b, "en", { sensitivity: "accent" }) === 0;
}

/**
 * Picked by name from the Compliance tab, so renaming, archiving or deleting it
 * would leave that party's contact picker empty.
 */
export function isLockedTradeLabel(label: string): boolean {
  return DIRECTORY_PICKED_TRADE_LABELS.some((locked) =>
    sameLabel(locked, label),
  );
}

function toOption(row: TradeType): TradeTypeOption {
  return {
    id: row.id,
    label: row.label,
    icon: isTradeIconKey(row.icon) ? row.icon : FALLBACK_ICON,
  };
}

function validLabel(raw: string): string {
  const label = cleanLabel(raw);
  if (!label) {
    throw new DomainValidationError("Give the trade a name.", "label");
  }
  if (label.length > MAX_LABEL_LENGTH) {
    throw new DomainValidationError(
      `Keep the trade name to ${MAX_LABEL_LENGTH} characters or fewer.`,
      "label",
    );
  }
  return label;
}

function validIcon(raw: string): TradeIconKey {
  if (!isTradeIconKey(raw)) {
    throw new DomainValidationError("Pick an icon from the list.", "icon");
  }
  return raw;
}

async function requireTradeType(id: string, db: DomainDb): Promise<TradeType> {
  const row = await db.tradeType.findUnique({ where: { id } });
  if (!row) throw new DomainNotFoundError("That trade no longer exists.");
  return row;
}

/** Refuse a label another trade already has, whatever its case. */
async function assertLabelFree(
  label: string,
  db: DomainDb,
  exceptId?: string,
): Promise<void> {
  const clash = await db.tradeType.findFirst({
    where: {
      label: { equals: label, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (!clash) return;
  throw new DomainValidationError(
    clash.archivedAt
      ? `"${clash.label}" already exists but is archived. Restore it instead.`
      : `"${clash.label}" is already a trade.`,
    "label",
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}

/** The trades a tradie can be given, for the pickers. Staff. */
export async function listTradeTypes(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<TradeTypeOption[]> {
  assertCanReadTradieDirectory(principal);
  const rows = await db.tradeType.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
  });
  return rows.map(toOption);
}

/** Every trade, archived too, with how many tradies each holds. ADMIN only. */
export async function listTradeTypesForAdmin(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<TradeTypeAdminRow[]> {
  requireAdminPrincipal(principal);
  const [rows, counts] = await Promise.all([
    db.tradeType.findMany({ orderBy: { label: "asc" } }),
    db.tradie.groupBy({ by: ["trade"], _count: { _all: true } }),
  ]);
  const tradiesByLabel = new Map(
    counts.map((count) => [count.trade, count._count._all]),
  );
  return rows.map((row) => ({
    ...toOption(row),
    archived: row.archivedAt !== null,
    tradieCount: tradiesByLabel.get(row.label) ?? 0,
    locked: isLockedTradeLabel(row.label),
  }));
}

/** Add a trade to the list. ADMIN only. */
export async function createTradeType(
  principal: DomainPrincipal,
  input: { readonly label: string; readonly icon: string },
  db: DomainDb,
): Promise<TradeTypeOption> {
  requireAdminPrincipal(principal);
  const label = validLabel(input.label);
  const icon = validIcon(input.icon);
  await assertLabelFree(label, db);

  try {
    return toOption(await db.tradeType.create({ data: { label, icon } }));
  } catch (error) {
    // A double-clicked Add: the first one won, and this one is the duplicate.
    if (isUniqueViolation(error)) {
      throw new DomainValidationError(
        `"${label}" is already a trade.`,
        "label",
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export type UpdateTradeTypeOutcome = {
  readonly tradeType: TradeTypeOption;
  /** Tradies moved from the old name to the new one, for cache invalidation. */
  readonly renamedTradieIds: readonly string[];
};

/**
 * Rename a trade or change its icon. ADMIN only.
 *
 * A rename moves every tradie under the old name to the new one in the same
 * transaction, so the directory never shows a trade with nobody in it beside
 * a name the list no longer has.
 */
export async function updateTradeType(
  principal: DomainPrincipal,
  input: {
    readonly id: string;
    readonly label?: string;
    readonly icon?: string;
  },
  db: TransactionalDomainDb,
): Promise<UpdateTradeTypeOutcome> {
  requireAdminPrincipal(principal);
  const label = input.label === undefined ? undefined : validLabel(input.label);
  const icon = input.icon === undefined ? undefined : validIcon(input.icon);

  return db.$transaction(async (tx) => {
    const current = await requireTradeType(input.id, tx);
    const renaming = label !== undefined && label !== current.label;

    if (renaming && isLockedTradeLabel(current.label)) {
      throw new DomainValidationError(
        `"${current.label}" is how the Compliance tab finds its contacts, so it keeps its name. You can still change its icon.`,
        "label",
      );
    }
    if (renaming) await assertLabelFree(label, tx, current.id);

    const updated = await tx.tradeType.update({
      where: { id: current.id },
      data: { ...(renaming ? { label } : {}), ...(icon ? { icon } : {}) },
    });
    const moved = renaming
      ? await tx.tradie.findMany({
          where: { trade: current.label },
          select: { id: true },
        })
      : [];
    if (moved.length > 0) {
      await tx.tradie.updateMany({
        where: { id: { in: moved.map((tradie) => tradie.id) } },
        data: { trade: label },
      });
    }

    return {
      tradeType: toOption(updated),
      renamedTradieIds: moved.map((tradie) => tradie.id),
    };
  });
}

/**
 * Take a trade off the pickers, or put it back. ADMIN only.
 *
 * Tradies already under an archived trade keep it; they just cannot be given
 * it again until it is restored.
 */
export async function setTradeTypeArchived(
  principal: DomainPrincipal,
  input: { readonly id: string; readonly archived: boolean },
  db: DomainDb,
): Promise<TradeTypeOption> {
  requireAdminPrincipal(principal);
  const current = await requireTradeType(input.id, db);

  if (input.archived && isLockedTradeLabel(current.label)) {
    throw new DomainValidationError(
      `"${current.label}" is how the Compliance tab finds its contacts, so it cannot be archived.`,
    );
  }
  // Already in the state asked for: a second click, or a second tab.
  if ((current.archivedAt !== null) === input.archived)
    return toOption(current);

  return toOption(
    await db.tradeType.update({
      where: { id: current.id },
      data: { archivedAt: input.archived ? new Date() : null },
    }),
  );
}

/**
 * Remove a trade nobody holds — a typo, a trade added by mistake. ADMIN only.
 * One that tradies are listed under is archived instead, so their history
 * keeps its name.
 */
export async function deleteTradeType(
  principal: DomainPrincipal,
  input: { readonly id: string },
  db: DomainDb,
): Promise<void> {
  requireAdminPrincipal(principal);
  const current = await requireTradeType(input.id, db);

  if (isLockedTradeLabel(current.label)) {
    throw new DomainValidationError(
      `"${current.label}" is how the Compliance tab finds its contacts, so it cannot be deleted.`,
    );
  }
  const holders = await db.tradie.count({ where: { trade: current.label } });
  if (holders > 0) {
    throw new DomainValidationError(
      `${holders} ${holders === 1 ? "tradie is" : "tradies are"} listed under "${current.label}". Archive it instead, or move them to another trade first.`,
    );
  }

  // The dependency join rows cascade, so the database no longer refuses this
  // delete itself: without the check it would silently drop the dependency.
  const [activities, milestones] = await Promise.all([
    db.milestoneTemplate.count({
      where: { requiredTradeTypes: { some: { id: current.id } } },
    }),
    db.milestone.count({
      where: { requiredTradeTypes: { some: { id: current.id } } },
    }),
  ]);
  if (activities + milestones > 0) {
    throw new DomainValidationError(
      "This category is required by a build sequence activity or project milestone. Archive it instead.",
    );
  }

  await db.tradeType.delete({ where: { id: current.id } });
}

/**
 * A trade typed by a caller, as the list spells it — or as typed when the list
 * has no such trade. For a lookup, not a write: `Tradie.trades` holds listed
 * spellings and matches exactly, so "gas fitting" has to become "Gas Fitting"
 * before it can find a secondary trade. Never refuses; `resolveTradeLabel` is
 * the strict one, for giving a tradie a trade.
 */
export async function canonicalTradeLabel(
  trade: string,
  db: DomainDb,
): Promise<string> {
  const requested = trade.trim();
  const row = await db.tradeType.findFirst({
    select: { label: true },
    where: { label: { equals: requested, mode: "insensitive" } },
  });
  return row?.label ?? requested;
}

/**
 * How the office says a trade, as a fragment of the trade's listed name.
 *
 * Search matched only the text as typed, so "electrician" missed a trade
 * listed as "Electrical" and "sparky", "chippy" and "brickie" — the words the
 * office uses, and the handbook teaches the agent — matched nothing (#429).
 * The values are fragments rather than labels because the list is the
 * office's to edit (staging lists "Electrician", another database may say
 * "Electrical"); a fragment finds either.
 */
const TRADE_WORD_FRAGMENTS: Readonly<Record<string, readonly string[]>> = {
  sparky: ["electric"],
  sparkie: ["electric"],
  sparkies: ["electric"],
  sparkys: ["electric"],
  electrician: ["electric"],
  electricians: ["electric"],
  electrical: ["electric"],
  electrics: ["electric"],
  chippy: ["carpent"],
  chippie: ["carpent"],
  chippies: ["carpent"],
  carpenter: ["carpent"],
  carpenters: ["carpent"],
  brickie: ["brick"],
  brickies: ["brick"],
  bricky: ["brick"],
  bricklayer: ["brick"],
  bricklayers: ["brick"],
  plumber: ["plumb"],
  plumbers: ["plumb"],
  plumbo: ["plumb"],
  tiler: ["tiling"],
  tilers: ["tiling"],
  painter: ["paint"],
  painters: ["paint"],
  roofer: ["roof"],
  roofers: ["roof"],
  plasterer: ["plaster", "gyprock"],
  plasterers: ["plaster", "gyprock"],
  gyprocker: ["gyprock", "plaster"],
  gyprockers: ["gyprock", "plaster"],
  concreter: ["concrete"],
  concreters: ["concrete"],
  concretor: ["concrete"],
  glazier: ["glaz", "window"],
  glaziers: ["glaz", "window"],
  landscaper: ["landscap"],
  landscapers: ["landscap"],
  scaffolder: ["scaffold"],
  scaffolders: ["scaffold"],
  scaffy: ["scaffold"],
  surveyor: ["survey"],
  surveyors: ["survey"],
  engineer: ["engineer"],
  engineers: ["engineer"],
  waterproofer: ["waterproof"],
  waterproofers: ["waterproof"],
  architect: ["architect"],
  architects: ["architect"],
  joiner: ["joinery"],
  joiners: ["joinery"],
  cabinetmaker: ["joinery", "kitchen"],
  aircon: ["hvac", "air con"],
  floorer: ["floor"],
  floorers: ["floor"],
};

/**
 * The text to look a trade up by: what was typed, plus the listed-name
 * fragment for each office word in it ("best sparky" → "electric").
 */
export function tradeSearchTerms(text: string): string[] {
  const query = text.trim();
  if (!query) return [];
  const terms = new Set([query]);
  for (const word of query.toLowerCase().match(/[a-z]+/g) ?? []) {
    for (const fragment of TRADE_WORD_FRAGMENTS[word] ?? []) {
      terms.add(fragment);
    }
  }
  return [...terms];
}

/**
 * Every listed trade whose name contains this text, or the trade an office
 * word in it means, archived ones included — a tradie keeps a trade after it
 * is archived. How a search reaches secondary trades: a scalar list has no
 * `contains`, so the text becomes the labels it matches and those go to
 * `hasSome`.
 */
export async function tradeLabelsMatching(
  text: string,
  db: DomainDb,
): Promise<string[]> {
  const terms = tradeSearchTerms(text);
  if (terms.length === 0) return [];
  const rows = await db.tradeType.findMany({
    select: { label: true },
    where: {
      OR: terms.map((term) => ({
        label: { contains: term, mode: "insensitive" as const },
      })),
    },
  });
  return rows.map((row) => row.label);
}

/**
 * The listed trades a trade filter means: the exact label when the list has
 * it ("plumbing" → "Plumbing"), otherwise every label the text or its office
 * word matches ("sparky" → "Electrician"). Empty when nothing matches, and
 * the caller filters by the text as typed.
 */
export async function tradeFilterLabels(
  trade: string,
  db: DomainDb,
): Promise<string[]> {
  const requested = trade.trim();
  if (!requested) return [];
  const exact = await db.tradeType.findFirst({
    select: { label: true },
    where: { label: { equals: requested, mode: "insensitive" } },
  });
  if (exact) return [exact.label];
  return tradeLabelsMatching(requested, db);
}

/**
 * The trade a tradie is being given, as the list spells it.
 *
 * "plumbing" becomes "Plumbing". A name the list does not have, or one that is
 * archived, is refused: the pickers only offer the list, so this is what stops
 * Eve or a hand-written request filing a tradie under a trade no filter, tile
 * or compliance picker will ever find. A tradie keeping the trade it already
 * has is left alone, even if that trade has since been archived.
 */
export async function resolveTradeLabel(
  trade: string,
  db: DomainDb,
  options: { readonly current?: string } = {},
): Promise<string> {
  const requested = cleanLabel(trade);
  if (options.current !== undefined && requested === options.current) {
    return options.current;
  }

  const row = await db.tradeType.findFirst({
    where: { label: { equals: requested, mode: "insensitive" } },
  });
  if (row && !row.archivedAt) return row.label;

  if (row) {
    throw new DomainValidationError(
      `"${row.label}" is archived. Restore it under Admin → Trade types to use it again.`,
      "trade",
    );
  }
  const available = await db.tradeType.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { label: true },
  });
  throw new DomainValidationError(
    `"${requested}" is not a trade in the directory. Use one of: ${available
      .map((option) => option.label)
      .join(", ")} — or add it under Admin → Trade types first.`,
    "trade",
  );
}
