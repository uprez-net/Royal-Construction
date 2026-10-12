"use client";

import {
  ArrowUpRight,
  PiggyBank,
  ReceiptText,
  TriangleAlert,
  Wallet2,
} from "lucide-react";
import { useAppSelector } from "@/lib/store/hooks";
import { selectActiveProjectBudgetSummary } from "@/lib/store/slices/projectsSlice";
import { METRIC_TONES } from "@/components/common/metric-card";
import { budgetStatusConfig } from "@/components/projects/project-budget-status";
import { currency } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import { Role } from "@prisma/client";

/**
 * These cards stay bespoke rather than reusing `MetricCard` because each one
 * carries a derived badge in the top-right slot (budget health, burn percent,
 * data availability) that `MetricCard` has no room for — its third grid column
 * is reserved for `TrendBadge`. Typography follows DESIGN.md §5 Metric Cards
 * (`font-heading text-3xl font-semibold`), which is the same scale family
 * `MetricCard` uses at its more compact `text-2xl`.
 */

const CARD_SURFACE = "rounded-xl border border-border/70 bg-card p-5 shadow-sm";
// On a phone the three cards stacked at full size took about 500px before any
// of the project appeared. There each one is a single row instead: icon,
// figure over its label, badge. From md up the grid placement is inert and
// the card lays out as before.
const STAT_CARD = cn(
  CARD_SURFACE,
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 p-3 md:block md:p-5",
);
const STAT_CARD_TOP =
  "contents md:mb-2 md:flex md:items-start md:justify-between md:gap-2";
// DESIGN.md §5 puts metric values in the display face, which is also what
// `MetricCard` does. These three were overriding it back to `font-mono`, so the
// one editorial moment on the page read like terminal output. `tabular-nums`
// stays for even digit widths.
const CARD_VALUE =
  "col-start-2 row-start-1 font-heading text-xl font-semibold leading-tight tracking-tight tabular-nums text-foreground md:mt-2 md:text-3xl";
const CARD_LABEL =
  "col-start-2 row-start-2 text-xs text-muted-foreground md:mt-1";
const ICON_CONTAINER =
  "row-span-2 flex size-9 items-center justify-center rounded-xl text-white md:size-11 md:rounded-2xl";
const BADGE =
  "col-start-3 row-span-2 row-start-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

// Mirrors the three tones `StatusPill` exposes (neutral/success/danger) so the
// Contract Value badge stays on-token without coupling this bespoke card to
// the pill component.
const TONE_BADGE_CLASS: Record<"neutral" | "success" | "danger", string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-light text-success-ink",
  danger: "bg-destructive-light text-destructive-ink",
};

export function ProjectStatCards({ role }: { role: Role }) {
  const isAdmin = role === "ADMIN";
  const budgetSummary = useAppSelector(selectActiveProjectBudgetSummary);

  // Every card here is admin-only. The role check used to sit inside the grid,
  // so a non-admin got a loading panel that resolved into an empty <section> —
  // invisible, but still taking a gap from the page's `space-y-4`.
  if (!isAdmin) {
    return null;
  }

  // `selectActiveProjectBudgetSummary` returns null for exactly one reason:
  // `activeProject` is not in the store yet. It never returns null for a missing
  // contract value — a project with totalBudget 0 still yields a summary. So this
  // branch is the unhydrated state, and the old copy ("no contract value recorded
  // yet") asserted a fact about the project that the data did not support.
  if (!budgetSummary) {
    return (
      <section className={CARD_SURFACE} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading budget summary</span>
        <p className="text-base font-semibold text-foreground">
          Budget summary
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Loading this project&rsquo;s contract, spend and remaining figures.
        </p>
      </section>
    );
  }

  // A contract value of zero is a real, loaded state — not a missing one. It is
  // where the "nothing recorded" message actually belongs, and the percentage
  // figures below are meaningless without a denominator.
  if (budgetSummary.totalBudget <= 0) {
    return (
      <section className={CARD_SURFACE}>
        <p className="text-base font-semibold text-foreground">
          No contract value recorded
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Spend and remaining figures are calculated against the contract value,
          so they cannot be shown until one is set on this project.
        </p>
      </section>
    );
  }

  // The shared classifier is the single source of truth for budget health —
  // the badge, the Spent card framing and the Remaining card framing all
  // branch on it rather than each re-deriving their own `isOverBudget`.
  const status = budgetSummary.status;
  const statusConfig = budgetStatusConfig(status);
  const isOverBudget = status === "OVER_BUDGET";
  const isNotStarted = status === "NOT_STARTED";
  const overrun = isOverBudget ? Math.abs(budgetSummary.variance) : 0;
  const remainingPercent = Math.max(100 - budgetSummary.spentPercent, 0);
  const overrunPercent = Math.max(budgetSummary.spentPercent - 100, 0);

  return (
    // Three columns for three cards. It was four, leaving a column of dead
    // space beside Remaining on every desktop viewport. A future Workers-on-site
    // card (no attendance source is wired up yet) would take this back to four.
    //
    // One column straight to three: a two-column step would strand the third
    // card on a half-empty row at tablet widths, which is the same gap in a
    // different place.
    <section className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-4">
      {/* Contract Value — badge is driven by the shared classifier. */}
      <div className={STAT_CARD}>
        <div className={STAT_CARD_TOP}>
          <div className={cn(ICON_CONTAINER, METRIC_TONES.primary)}>
            <Wallet2 className="size-5" aria-hidden="true" />
          </div>
          <span className={cn(BADGE, TONE_BADGE_CLASS[statusConfig.tone])}>
            {isOverBudget ? (
              <TriangleAlert className="size-3" aria-hidden="true" />
            ) : statusConfig.tone === "success" ? (
              <ArrowUpRight className="size-3" aria-hidden="true" />
            ) : null}
            {statusConfig.label}
          </span>
        </div>
        <div className={CARD_VALUE}>
          {currency.format(budgetSummary.totalBudget)}
        </div>
        <div className={CARD_LABEL}>Total contract value</div>
      </div>

      {/* Spent. The label names the measure in every state: a $0 value and a 0%
      badge already say there are no actuals yet, and replacing the label with
      that same sentence left the figure unidentified while repeating what the
      two cards either side of it were also saying. */}
      <div className={STAT_CARD}>
        <div className={STAT_CARD_TOP}>
          <div className={cn(ICON_CONTAINER, METRIC_TONES.warning)}>
            <ReceiptText className="size-5" aria-hidden="true" />
          </div>
          {/* The badge says what its percentage measures. A bare "0%" beside a
              bare "100%" on the next card left the reader to work out which way
              round they ran, with the answer only in screen-reader text. */}
          <span
            className={cn(
              BADGE,
              isOverBudget
                ? "bg-destructive-light text-destructive-ink"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{budgetSummary.spentPercent}%</span>
            used
          </span>
        </div>
        <div className={CARD_VALUE}>{currency.format(budgetSummary.spent)}</div>
        <div className={CARD_LABEL}>Spent to date</div>
      </div>

      {/* Remaining — or, once spend passes the contract value, the overrun.
      Showing a clamped "$0 remaining" on an over-budget project hides the one
      number the site manager needs. NOT_STARTED keeps the label (the whole
      contract value is genuinely still remaining) but is toned neutral rather
      than a healthy green, so the card states the figure without implying
      spend is tracking. */}
      <div className={STAT_CARD}>
        <div className={STAT_CARD_TOP}>
          <div
            className={cn(
              ICON_CONTAINER,
              isOverBudget
                ? METRIC_TONES.danger
                : isNotStarted
                  ? METRIC_TONES.neutral
                  : METRIC_TONES.success,
            )}
          >
            {isOverBudget ? (
              <TriangleAlert className="size-5" aria-hidden="true" />
            ) : (
              <PiggyBank className="size-5" aria-hidden="true" />
            )}
          </div>
          <span
            className={cn(
              BADGE,
              isOverBudget
                ? "bg-destructive-light text-destructive-ink"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span className="tabular-nums">
              {isOverBudget ? `+${overrunPercent}%` : `${remainingPercent}%`}
            </span>
            {isOverBudget ? "over" : "left"}
          </span>
        </div>
        <div className={cn(CARD_VALUE, isOverBudget && "text-destructive-ink")}>
          {currency.format(isOverBudget ? overrun : budgetSummary.remaining)}
        </div>
        <div className={CARD_LABEL}>
          {isOverBudget ? "Over budget by" : "Remaining budget"}
        </div>
      </div>
    </section>
  );
}
