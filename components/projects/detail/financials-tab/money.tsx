import type {
  FinancialFigures,
  FinancialOutcome,
} from "@/lib/domain/projects/financial-report";
import { cn } from "@/lib/utils";

// How the Financials tab writes money. Amounts arrive as whole cents from the
// report, so nothing here does arithmetic beyond putting the dollar sign on.

// To the cent, unlike the app's `currency`: an invoice is checked against the
// tradie's own figure, and a rounded $1,200 beside an invoice for $1,199.50
// reads as a discrepancy that is not there. Not `rateCurrency` either, which
// is for a tradie's rate and is always shown with its unit.
const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

export function formatCents(cents: number): string {
  return MONEY.format(cents / 100);
}

/** "+$151.00" / "−$100.00", with a real minus sign. */
export function formatSignedCents(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${formatCents(Math.abs(cents))}`;
}

function formatPercent(percent: number | null): string | null {
  return percent === null ? null : `${Math.abs(percent).toFixed(1)}%`;
}

const OUTCOME_WORDS: Record<FinancialOutcome, string> = {
  EVEN: "Break-even",
  LOSS: "Loss",
  NOT_INVOICED: "Not invoiced",
  PROFIT: "Profit",
};

/**
 * The row tint for an outcome. Green for profit, red for loss, none for
 * break-even or nothing invoiced yet. The words in the Profit/Loss cell carry
 * the same meaning, so the colour is never the only signal.
 */
export function outcomeRowClass(outcome: FinancialOutcome): string {
  switch (outcome) {
    case "PROFIT":
      return "bg-success-light/60 hover:bg-success-light";
    case "LOSS":
      return "bg-destructive-light/60 hover:bg-destructive-light";
    default:
      return "";
  }
}

/** A money figure in a table cell: mono, right-aligned by the column. */
export function Money({
  cents,
  muted = false,
  className,
}: {
  cents: number;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        muted ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {formatCents(cents)}
    </span>
  );
}

/**
 * The Profit/Loss cell: "+$151.00 30.2% Profit" or "−$100.00 8.3% Loss", as
 * issue #405 writes it. Nothing invoiced yet reads "Not invoiced", with the
 * forecast under it when there is a price to forecast from.
 */
export function ProfitLoss({
  figures,
  showForecast = true,
}: {
  figures: FinancialFigures;
  /** Off where the forecast is shown beside it already, as in the footer. */
  showForecast?: boolean;
}) {
  if (figures.profitCents === null) {
    const hasForecast =
      showForecast
      && (figures.quotedCents > 0 || figures.forecastCostCents > 0);
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="text-muted-foreground">Not invoiced</span>
        {hasForecast ? (
          <span className="text-xs text-muted-foreground">
            Forecast{" "}
            <span className="font-mono tabular-nums">
              {formatSignedCents(figures.forecastProfitCents)}
            </span>
          </span>
        ) : null}
      </span>
    );
  }
  const percent = formatPercent(figures.profitPercent);
  const tone =
    figures.outcome === "PROFIT"
      ? "text-success-ink"
      : figures.outcome === "LOSS"
        ? "text-destructive-ink"
        : "text-foreground";
  const stillBilling =
    showForecast && figures.forecastCostCents > figures.invoicedCents;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={cn("font-medium", tone)}>
        <span className="font-mono tabular-nums">
          {formatSignedCents(figures.profitCents)}
        </span>{" "}
        {percent ? (
          <span className="font-mono tabular-nums">{percent}</span>
        ) : (
          <span aria-label="no tender to compare with">&mdash;</span>
        )}{" "}
        {OUTCOME_WORDS[figures.outcome]}
      </span>
      {stillBilling ? (
        <span className="text-xs text-muted-foreground">
          Forecast{" "}
          <span className="font-mono tabular-nums">
            {formatSignedCents(figures.forecastProfitCents)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
