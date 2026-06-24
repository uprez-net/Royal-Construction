import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setActiveTab,
  setQuery,
} from "@/lib/store/slices/tradieManagementSlice";
import {
  AlertTriangle,
  Grid3x3,
  List,
  LucideIcon,
  Search,
  Star,
  Table,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMemo } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { cn } from "@/lib/utils";

export function TradieTabs() {
  const dispatch = useAppDispatch();
  const { query, activeTab, tradies } = useAppSelector(
    (state) => state.tradieManagement,
  );

  const { totalCount, flaggedCount } = useMemo(() => {
    return {
      totalCount: tradies.length,
      flaggedCount: tradies.reduce(
        (count, tradie) => count + tradie.incidentCount.open,
        0,
      ),
    };
  }, [tradies]);

  const handleTabChange = (tab: "category" | "list" | "table") => {
    dispatch(setActiveTab(tab));
  };

  const changeQueryTab = (tab: "all" | "flagged") => {
    dispatch(setActiveTab("table"));
    dispatch(setQuery({ tab }));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchQuery = e.target.value;
    if (searchQuery.trim() === "") return;
    dispatch(setQuery({ search: searchQuery }));
  };

  const setFavouriteTab = (on: boolean) => {
    dispatch(setQuery({ tab: "all", favourite: on }));
  };

  const setCategoryQuery = (category: string | undefined) => {
    dispatch(setQuery({ category }));
  };

  const setRatingQuery = (rating: number | undefined) => {
    dispatch(setQuery({ rating }));
  };

  const tabsWithIcons: {
    label: string;
    value: "category" | "list" | "table";
    icon: LucideIcon;
  }[] = [
    { label: "Category", value: "category", icon: Grid3x3 },
    { label: "List", value: "list", icon: List },
    { label: "Table", value: "table", icon: Table },
  ] as const;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 bg-white p-1 text-sm font-medium text-muted-foreground">
        {tabsWithIcons.map((tab) => (
          <Button
            key={tab.value}
            variant={activeTab === tab.value ? "default" : "ghost"}
            onClick={() => handleTabChange(tab.value)}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </Button>
        ))}
      </div>

      <div className="relative max-w-70 flex-1">
        <label htmlFor="search" className="sr-only">
          Search
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

        <Input
          id="search"
          className="h-10 rounded-lg border-border bg-background pl-9 text-[13px] shadow-none transition-all focus-visible:ring-4 focus-visible:ring-teal-500/10 focus-visible:border-teal-600"
          placeholder="Search offers..."
          value={query.search}
          onChange={handleSearchChange}
        />
      </div>

      {activeTab === "table" && (
        <div className="flex items-center gap-2">
          <Select
            value={query.category ?? "all"}
            onValueChange={(value) =>
              setCategoryQuery(value === "all" ? undefined : value)
            }
          >
            <SelectTrigger className="h-9 flex-none rounded-full border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:ring-1 focus:ring-rc-gold">
              <SelectValue placeholder="Select Trade" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-40 rounded-md border border-gray-200 bg-white shadow-lg">
              <SelectItem value={"all"} className="text-sm text-gray-700">
                All Trades
              </SelectItem>
              {Object.entries(TRADIE_TYPES).map(([key, label]) => {
                const Icon =
                  TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES];
                return (
                  <SelectItem
                    key={key}
                    value={key}
                    className="text-sm text-gray-700"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-3 w-3 text-gray-500" />
                      <span>{label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            value={query.rating?.toString() ?? "all"}
            onValueChange={(value) =>
              setRatingQuery(value === "all" ? undefined : parseFloat(value))
            }
          >
            <SelectTrigger className="h-9 flex-none rounded-full border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:ring-1 focus:ring-rc-gold">
              <SelectValue placeholder="Select Rating" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-40 rounded-md border border-gray-200 bg-white shadow-lg">
              <SelectItem value={"all"} className="text-sm text-gray-700">
                All Ratings
              </SelectItem>
              {Array.from({ length: 5 }, (_, i) => i + 1).map((rating) => {
                return (
                  <SelectItem
                    key={rating}
                    value={rating.toString()}
                    className="text-sm text-gray-700"
                  >
                    <div className="flex items-center gap-2">
                      <Star className="h-3 w-3 text-gray-500" />
                      <span>{rating} Stars</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setFavouriteTab(!query.favourite)}
        className="hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300"
      >
        <Star className="mr-2 size-4" />
        Favourite
      </Button>
      {activeTab === "table" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeQueryTab("all")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              query.tab === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <Users className="h-3.5 w-3.5" />
            <span>All Tradies</span>

            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                query.tab === "all"
                  ? "bg-primary-foreground/20"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => changeQueryTab("flagged")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              query.tab === "flagged"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />

            <span>Flagged</span>

            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                query.tab === "flagged"
                  ? "bg-red-600 text-white"
                  : "bg-red-100 text-red-700",
              )}
            >
              {flaggedCount}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
