"use client";

import {
  ArrowUpRight,
  PiggyBank,
  ReceiptText,
  TriangleAlert,
  Users,
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
const CARD_VALUE =
  "mt-2 font-heading text-3xl font-semibold leading-tight tracking-tight text-foreground";
const CARD_LABEL = "mt-1 text-xs text-muted-foreground";
const ICON_CONTAINER =
  "flex size-11 items-center justify-center rounded-2xl text-white";
const BADGE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

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
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {isAdmin && (
        <>
          {/* Contract Value — badge is driven by the shared classifier. */}
          <div className={CARD_SURFACE}>
            <div className="mb-2 flex items-start justify-between">
              <div className={cn(ICON_CONTAINER, METRIC_TONES.primary)}>
                <Wallet2 className="size-5" aria-hidden="true" />
              </div>
              <span
                className={cn(BADGE, TONE_BADGE_CLASS[statusConfig.tone])}
              >
                {isOverBudget ? (
                  <TriangleAlert className="size-3" aria-hidden="true" />
                ) : statusConfig.tone === "success" ? (
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                ) : null}
                {statusConfig.label}
              </span>
            </div>
            <div className={cn(CARD_VALUE, "font-mono tabular-nums")}>
              {currency.format(budgetSummary.totalBudget)}
            </div>
            <div className={CARD_LABEL}>Total contract value</div>
          </div>

          {/* Spent — in the NOT_STARTED state there are no actuals yet, so the
          copy says so rather than implying spend is tracking against budget. */}
          <div className={CARD_SURFACE}>
            <div className="mb-2 flex items-start justify-between">
              <div className={cn(ICON_CONTAINER, METRIC_TONES.warning)}>
                <ReceiptText className="size-5" aria-hidden="true" />
              </div>
              <span
                className={cn(
                  BADGE,
                  isOverBudget
                    ? "bg-destructive-light text-destructive-ink"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <span className="font-mono tabular-nums">
                  {budgetSummary.spentPercent}%
                </span>
                <span className="sr-only">of contract value spent</span>
              </span>
            </div>
            <div className={cn(CARD_VALUE, "font-mono tabular-nums")}>
              {currency.format(budgetSummary.spent)}
            </div>
            <div className={CARD_LABEL}>
              {isNotStarted ? "No spend recorded yet" : "Spent to date"}
            </div>
          </div>

          {/* Remaining — or, once spend passes the contract value, the overrun.
          Showing a clamped "$0 remaining" on an over-budget project hides the
          one number the site manager needs. NOT_STARTED is rendered neutral
          rather than as a healthy green "Remaining budget" so the card does
          not imply spend is tracking. */}
          <div className={CARD_SURFACE}>
            <div className="mb-2 flex items-start justify-between">
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
                <span className="font-mono tabular-nums">
                  {isOverBudget
                    ? `+${overrunPercent}%`
                    : `${remainingPercent}%`}
                </span>
                <span className="sr-only">
                  {isOverBudget
                    ? "over the contract value"
                    : "of contract value remaining"}
                </span>
              </span>
            </div>
            <div
              className={cn(
                CARD_VALUE,
                "font-mono tabular-nums",
                isOverBudget && "text-destructive-ink",
              )}
            >
              {currency.format(
                isOverBudget ? overrun : budgetSummary.remaining,
              )}
            </div>
            <div className={CARD_LABEL}>
              {isOverBudget
                ? "Over budget by"
                : isNotStarted
                  ? "No spend recorded"
                  : "Remaining budget"}
            </div>
          </div>
        </>
      )}
      {/* Workers on site — no attendance source is wired up yet. */}
      <div className={CARD_SURFACE}>
        <div className="mb-2 flex items-start justify-between">
          <div className={cn(ICON_CONTAINER, METRIC_TONES.neutral)}>
            <Users className="size-5" aria-hidden="true" />
          </div>
          <span className={cn(BADGE, "bg-muted text-muted-foreground")}>
            Not enabled
          </span>
        </div>
        <div
          className={cn(CARD_VALUE, "text-muted-foreground")}
          aria-hidden="true"
        >
          —
        </div>
        <div className={CARD_LABEL}>
          Site attendance tracking is not enabled for this project, so there is
          no live worker count.
        </div>
      </div>
    </section>
  );
}
