import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { randomColourHexGenerator } from "@/utils/generator";

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
  const color = randomColourHexGenerator(trade);
  return (
    <Badge
      variant="secondary"
      className="gap-1"
      style={{ color, backgroundColor: `${color}15` }}
    >
      <Icon className="h-3 w-3" />
      {trade}
    </Badge>
  );
}
