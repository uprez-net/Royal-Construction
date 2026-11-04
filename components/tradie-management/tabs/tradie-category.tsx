import { TradiesByCategory } from "@/types/tradie";
import { Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRADE_ICON_TILE_CLASS } from "@/constants/tradeChip";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  setActiveTab,
  setQuery,
} from "@/lib/store/slices/tradieManagementSlice";
import { TradeIcon } from "../trade-icon";

interface CategoryCardProps {
  name: string;
  count: number;
  totalJobs: number;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export function TradieCategory({
  filteredTradies,
}: {
  filteredTradies: TradiesByCategory[];
}) {
  const dispatch = useAppDispatch();

  // A tile is a drill-down into the List view. It filters through `query`, the
  // same state the trade Select writes, so the choice shows up as a removable
  // filter chip. The accordion this replaced tracked its own selected category
  // with no visible control to undo it.
  const handleActionClick = (category: string) => {
    dispatch(setQuery({ category }));
    dispatch(setActiveTab("list"));
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {/* A category is the trade's label as the tradies hold it. */}
      {filteredTradies.map((category) => (
        <CategoryCard
          key={category.category}
          name={category.category}
          count={category.tradies.length}
          totalJobs={category.totalCategoryJobsCompleted}
          icon={<TradeIcon trade={category.category} className="size-5" />}
          onClick={() => handleActionClick(category.category)}
        />
      ))}
    </div>
  );
}

function CategoryCard({
  name,
  count,
  totalJobs,
  icon = <Square className="size-5" aria-hidden="true" />,
  onClick,
}: CategoryCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${name}: ${count} tradie${count === 1 ? "" : "s"}, ${totalJobs} total jobs`}
      className={cn(
        "relative flex flex-col rounded-lg border border-border/70 bg-card p-4 text-left shadow-sm transition-colors",
        "hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
        {count}
      </span>

      {/* Trade identity is carried by the icon, not a per-trade hue — see
          constants/tradeChip.ts for why the hashed colour was removed. */}
      <div className={cn(TRADE_ICON_TILE_CLASS, "mb-3 size-10")}>{icon}</div>

      <span className="font-medium text-foreground">{name}</span>

      <span className="text-sm text-muted-foreground">
        {totalJobs} total jobs
      </span>
    </button>
  );
}
