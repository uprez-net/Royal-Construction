import { Badge } from "@/components/ui/badge";
import { TRADE_CHIP_CLASS } from "@/constants/tradeChip";
import { TradeIcon } from "./trade-icon";

export function TradieBadge({ trade }: { trade: string }) {
  return (
    // Trade identity comes from the icon, not a hashed hue — see
    // constants/tradeChip.ts.
    <Badge variant="secondary" className={TRADE_CHIP_CLASS}>
      <TradeIcon trade={trade} className="size-3" />
      {trade}
    </Badge>
  );
}
