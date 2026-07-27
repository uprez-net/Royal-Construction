import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TRADE_CHIP_CLASS } from "@/constants/tradeChip";

const convertCategoryToTradieType = (
  category: string,
): keyof typeof TRADIE_TYPES | null => {
  const entry = Object.entries(TRADIE_TYPES).find(
    ([, value]) => value === category,
  );

  return (entry?.[0] as keyof typeof TRADIE_TYPES) ?? null;
};

export function TradieBadge({ trade }: { trade: string }) {
  const Icon = TRADIE_TYPE_ICONS[convertCategoryToTradieType(trade)!] ?? Square;
  return (
    // Trade identity comes from the icon, not a hashed hue — see
    // constants/tradeChip.ts.
    <Badge variant="secondary" className={TRADE_CHIP_CLASS}>
      <Icon className="size-3" aria-hidden="true" />
      {trade}
    </Badge>
  );
}
