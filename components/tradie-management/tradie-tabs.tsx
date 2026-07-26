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
  Square,
  Star,
  Table,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMemo, useRef } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { cn } from "@/lib/utils";
import type { TradieTableQuery } from "@/types/tradie";

export type TradieViewTab = "category" | "list" | "table";

/** Shared ids so the tablist here and the tabpanel in `tradie-body` line up. */
export const TRADIE_VIEW_PANEL_ID = "tradie-view-panel";
export const tradieViewTabId = (tab: TradieViewTab) => `tradie-view-tab-${tab}`;

/** The "no filters applied" query. Used by Clear filters affordances. */
export const CLEARED_TRADIE_QUERY: TradieTableQuery = {
  search: "",
  category: undefined,
  rating: undefined,
  favourite: undefined,
  tab: "all",
};

export function hasActiveTradieFilters(query: TradieTableQuery): boolean {
  return (
    Boolean(query.search?.trim()) ||
    query.category !== undefined ||
    query.rating !== undefined ||
    query.favourite !== undefined ||
    query.tab === "flagged"
  );
}

const VIEW_TABS: { label: string; value: TradieViewTab; icon: LucideIcon }[] = [
  { label: "Category", value: "category", icon: Grid3x3 },
  { label: "List", value: "list", icon: List },
  { label: "Table", value: "table", icon: Table },
];

export function TradieTabs() {
  const dispatch = useAppDispatch();
  const { query, activeTab, tradies } = useAppSelector(
    (state) => state.tradieManagement,
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { totalCount, flaggedCount } = useMemo(() => {
    return {
      totalCount: tradies.length,
      // Counts flagged *tradies*, not incidents: this number sits beside a list
      // of tradies, so summing incidents made the badge disagree with the rows.
      flaggedCount: tradies.filter((tradie) => tradie.incidentCount.open > 0)
        .length,
    };
  }, [tradies]);

  const handleTabChange = (tab: TradieViewTab) => {
    dispatch(setActiveTab(tab));
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = VIEW_TABS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    if (next === null) return;
    event.preventDefault();
    handleTabChange(VIEW_TABS[next].value);
    tabRefs.current[next]?.focus();
  };

  const changeQueryTab = (tab: "all" | "flagged") => {
    dispatch(setQuery({ tab }));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setQuery({ search: e.target.value }));
  };

  // Off must be `undefined`, not `false`: `favourite: false` is a real filter
  // that shows only non-favourites, so the old !on toggle inverted the list.
  const toggleFavouriteOnly = () => {
    dispatch(setQuery({ favourite: query.favourite ? undefined : true }));
  };

  const setCategoryQuery = (category: string | undefined) => {
    dispatch(setQuery({ category }));
  };

  const setRatingQuery = (rating: number | undefined) => {
    dispatch(setQuery({ rating }));
  };

  const filtersActive = hasActiveTradieFilters(query);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const search = query.search?.trim();
    if (search) labels.push(`Search: “${search}”`);
    if (query.category) labels.push(`Trade: ${query.category}`);
    if (query.rating !== undefined) {
      labels.push(`Rating: ${query.rating} star${query.rating === 1 ? "" : "s"}`);
    }
    if (query.favourite !== undefined) {
      labels.push(query.favourite ? "Favourites only" : "Non-favourites only");
    }
    if (query.tab === "flagged") labels.push("Flagged only");
    return labels;
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Tradie view"
          aria-orientation="horizontal"
          className="flex items-center gap-1 rounded-lg border border-border/70 bg-card p-1"
        >
          {VIEW_TABS.map((tab, index) => {
            const isActive = activeTab === tab.value;
            return (
              <Button
                key={tab.value}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={tradieViewTabId(tab.value)}
                size="lg"
                aria-selected={isActive}
                aria-controls={isActive ? TRADIE_VIEW_PANEL_ID : undefined}
                aria-label={tab.label}
                tabIndex={isActive ? 0 : -1}
                variant={isActive ? "default" : "ghost"}
                onClick={() => handleTabChange(tab.value)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <tab.icon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{tab.label}</span>
              </Button>
            );
          })}
        </div>

        <div className="relative min-w-52 max-w-70 flex-1">
          <label htmlFor="tradie-search" className="sr-only">
            Search tradies by name
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />

          <Input
            id="tradie-search"
            type="search"
            className="h-9 pl-9 text-sm"
            placeholder="Search tradies by name"
            value={query.search}
            onChange={handleSearchChange}
          />
        </div>

        {/* Trade and rating filters live in every view. They used to render only
            in Table view while their state persisted in Redux, so a filter set
            in Table view kept applying with no visible control to undo it. */}
        <Select
          value={query.category ?? "all"}
          onValueChange={(value) =>
            setCategoryQuery(value === "all" ? undefined : value)
          }
        >
          <SelectTrigger
            aria-label="Filter by trade"
            className="h-9 w-auto min-w-36 flex-none text-sm font-medium"
          >
            <SelectValue placeholder="All trades" />
          </SelectTrigger>

          <SelectContent className="w-auto min-w-40">
            <SelectItem value="all" className="text-sm">
              All trades
            </SelectItem>
            {Object.entries(TRADIE_TYPES).map(([key, label]) => {
              const Icon =
                TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES] ?? Square;
              return (
                <SelectItem key={key} value={label} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="size-3 text-muted-foreground"
                      aria-hidden="true"
                    />
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
          <SelectTrigger
            aria-label="Filter by rating"
            className="h-9 w-auto min-w-36 flex-none text-sm font-medium"
          >
            <SelectValue placeholder="All ratings" />
          </SelectTrigger>

          <SelectContent className="w-auto min-w-40">
            <SelectItem value="all" className="text-sm">
              All ratings
            </SelectItem>
            {Array.from({ length: 5 }, (_, i) => i + 1).map((rating) => (
              <SelectItem
                key={rating}
                value={rating.toString()}
                className="text-sm"
              >
                <div className="flex items-center gap-2">
                  <Star
                    className="size-3 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    {rating} star{rating === 1 ? "" : "s"}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-pressed={query.favourite === true}
          onClick={toggleFavouriteOnly}
          className={cn(
            query.favourite &&
              "border-warning bg-warning-light text-warning-ink hover:bg-warning-light",
          )}
        >
          <Star
            className={cn(
              "mr-2 size-4",
              query.favourite && "fill-warning text-warning",
            )}
            aria-hidden="true"
          />
          Favourite
        </Button>

        <div
          role="group"
          aria-label="Filter by incident status"
          className="flex items-center gap-2"
        >
          <button
            type="button"
            aria-pressed={query.tab === "all"}
            onClick={() => changeQueryTab("all")}
            className={cn(
              "inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              query.tab === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted/40",
            )}
          >
            <Users className="size-3.5" aria-hidden="true" />
            <span>All tradies</span>

            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
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
            aria-pressed={query.tab === "flagged"}
            onClick={() => changeQueryTab("flagged")}
            className={cn(
              "inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              query.tab === "flagged"
                ? "border-destructive/40 bg-destructive-light text-destructive-ink"
                : "border-border bg-background hover:bg-muted/40",
            )}
          >
            <AlertTriangle className="size-3.5" aria-hidden="true" />

            <span>Flagged</span>

            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
                query.tab === "flagged"
                  ? "bg-destructive-ink text-white"
                  : "bg-destructive-light text-destructive-ink",
              )}
            >
              {flaggedCount}
            </span>
          </button>
        </div>
      </div>

      {filtersActive && (
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <span>Filters applied:</span>
          {activeFilterLabels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground"
            >
              {label}
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() => dispatch(setQuery(CLEARED_TRADIE_QUERY))}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
