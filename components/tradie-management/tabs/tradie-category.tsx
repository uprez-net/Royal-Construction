import { TradiesByCategory } from "@/types/tradie";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { randomColourHexGenerator } from "@/utils/generator";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  setSelectedCategory,
  setActiveTab,
} from "@/lib/store/slices/tradieManagementSlice";
import { convertCategoryToTradieType, type TradieType } from "@/utils/normalize-tradie-type";

interface CategoryCardProps {
  name: string;
  count: number;
  totalJobs: number;
  icon?: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

export function TradieCategory({
  filteredTradies,
}: {
  filteredTradies: TradiesByCategory[];
}) {
  const dispatch = useAppDispatch();

  const handleActionClick = (category: string) => {
    dispatch(setActiveTab("list"));
    dispatch(setSelectedCategory(category));
  };

  return (
    <div className="space-y-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {filteredTradies.map((category) => {
        const Icon =
          TRADIE_TYPE_ICONS[convertCategoryToTradieType(category.category)!] ||
          Square;
        return (
          <CategoryCard
            key={category.category}
            name={TRADIE_TYPES[category.category as TradieType]}
            count={category.tradies.length}
            totalJobs={category.totalCategoryJobsCompleted}
            icon={<Icon className="h-5 w-5" />}
            color={randomColourHexGenerator(TRADIE_TYPES[category.category as TradieType])}
            onClick={() => handleActionClick(TRADIE_TYPES[category.category as TradieType])}
          />
        );
      })}
    </div>
  );
}

function CategoryCard({
  name,
  count,
  totalJobs,
  icon = <Square className="h-5 w-5" />,
  color = "#2563EB",
  onClick,
}: CategoryCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-4 text-left transition-all",
        "hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
        {count}
      </span>

      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
        style={{
          backgroundColor: `${color}15`,
          color,
        }}
      >
        {icon}
      </div>

      <h4 className="font-semibold">{name}</h4>

      <p className="text-sm text-muted-foreground">{totalJobs} total jobs</p>
    </button>
  );
}
