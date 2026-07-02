import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import { calculateStageSubtotals } from "@/lib/offer/workspace-pricing";
import { formatCurrency } from "./offer-workspace-format";

type StageSubtotalStripProps = {
  readonly lines: readonly OfferWorkspaceCostLine[];
};

export function StageSubtotalStrip({ lines }: StageSubtotalStripProps) {
  const stageSubtotals = calculateStageSubtotals(lines);

  if (stageSubtotals.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Cost stage subtotals"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {stageSubtotals.map((stage) => (
        <div
          key={stage.stageCode}
          className="min-w-40 rounded-lg border border-border bg-background/70 px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold text-royal-gold">
              {stage.stageCode}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {stage.includedRowCount}/{stage.rowCount}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {stage.stageName}
          </p>
          <p className="font-mono text-sm font-semibold">
            {formatCurrency(stage.includedTotal)}
          </p>
        </div>
      ))}
    </section>
  );
}
