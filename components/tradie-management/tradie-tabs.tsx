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
  Star,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import { useMemo, useRef } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import { useTradeTypes } from "@/hooks/use-trade-types";
import { TradeIconGlyph } from "./trade-icon";
import { cn } from "@/lib/utils";
import {
  FilterChip,
  FilterChips,
  ListToolbar,
  TOOLBAR_BUTTON_CLASS,
  TOOLBAR_SELECT_TRIGGER_CLASS,
  ToolbarSearch,
  VIEW_TAB_BAR_CLASS,
  viewTabClass,
} from "@/components/common/list-toolbar";
import type { TradieTableQuery, TradieViewTab } from "@/types/tradie";

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
    Boolean(query.search?.trim())
    || query.category !== undefined
    || query.rating !== undefined
    || query.favourite !== undefined
    || query.tab === "flagged"
  );
}

const VIEW_TABS: { label: string; value: TradieViewTab; icon: LucideIcon }[] = [
  { label: "Category", value: "category", icon: Grid3x3 },
  { label: "List", value: "list", icon: List },
];

export function TradieTabs() {
  const dispatch = useAppDispatch();
  const { tradeTypes } = useTradeTypes();
  const { query, activeTab } = useAppSelector(
    (state) => state.tradieManagement,
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
      // Minimum-rating semantics: "3+ stars" matches 3.4 too. Always plural —
      // "1+ star" would read as exactly one.
      labels.push(`Rating: ${query.rating}+ stars`);
    }
    if (query.favourite !== undefined) {
      labels.push(query.favourite ? "Favourites only" : "Non-favourites only");
    }
    if (query.tab === "flagged") labels.push("Flagged only");
    return labels;
  }, [query]);

  return (
    <>
      <ListToolbar
        start={
          <div
            role="tablist"
            aria-label="Tradie view"
            aria-orientation="horizontal"
            className="flex flex-wrap items-center gap-1.5"
          >
            {VIEW_TABS.map((tab, index) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={tradieViewTabId(tab.value)}
                  aria-selected={isActive}
                  aria-controls={isActive ? TRADIE_VIEW_PANEL_ID : undefined}
                  aria-label={tab.label}
                  tabIndex={isActive ? 0 : -1}
                  className={viewTabClass(isActive)}
                  onClick={() => handleTabChange(tab.value)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <tab.icon className="size-4" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {isActive ? (
                    <span className={VIEW_TAB_BAR_CLASS} aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        }
      >
        {/* Trade and rating filters live in both views. They used to render only
            in the List view while their state persisted in Redux, so a filter
            set there kept applying with no visible control to undo it. */}
        <Select
          value={query.category ?? "all"}
          onValueChange={(value) =>
            setCategoryQuery(value === "all" ? undefined : value)
          }
        >
          <SelectTrigger
            aria-label="Filter by trade"
            className={cn(TOOLBAR_SELECT_TRIGGER_CLASS, "min-w-36")}
          >
            <SelectValue placeholder="All trades" />
          </SelectTrigger>

          <SelectContent className="w-auto min-w-40">
            <SelectItem value="all" className="text-sm">
              All trades
            </SelectItem>
            {tradeTypes.map((tradeType) => (
              <SelectItem
                key={tradeType.id}
                value={tradeType.label}
                className="text-sm"
              >
                <div className="flex items-center gap-2">
                  <TradeIconGlyph
                    icon={tradeType.icon}
                    className="size-3 text-muted-foreground"
                  />
                  <span>{tradeType.label}</span>
                </div>
              </SelectItem>
            ))}
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
            className={cn(TOOLBAR_SELECT_TRIGGER_CLASS, "min-w-36")}
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
                  <span>{rating}+ stars</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          aria-pressed={query.favourite === true}
          onClick={toggleFavouriteOnly}
          className={cn(
            TOOLBAR_BUTTON_CLASS,
            query.favourite
              && "border-warning bg-warning-light text-warning-ink hover:bg-warning-light",
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

        <ToolbarSearch
          id="tradie-search"
          aria-label="Search tradies by name"
          placeholder="Search tradies by name"
          value={query.search}
          onChange={handleSearchChange}
        />
      </ListToolbar>

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
    </>
  );
}

/**
 * The quick status filters (All tradies, Flagged) in the list card's header
 * strip, as Leads' stage chips are. Both views read the same `query.tab`.
 */
export function TradieStatusFilters() {
  const dispatch = useAppDispatch();
  const { query, tradies } = useAppSelector((state) => state.tradieManagement);

  const { totalCount, flaggedCount } = useMemo(() => {
    return {
      totalCount: tradies.length,
      // Counts flagged *tradies*, not incidents: this number sits beside a list
      // of tradies, so summing incidents made the badge disagree with the rows.
      flaggedCount: tradies.filter((tradie) => tradie.incidentCount.open > 0)
        .length,
    };
  }, [tradies]);

  const changeQueryTab = (tab: "all" | "flagged") => {
    dispatch(setQuery({ tab }));
  };

  return (
    <FilterChips role="group" aria-label="Filter by incident status">
      <FilterChip
        active={query.tab === "all"}
        onClick={() => changeQueryTab("all")}
      >
        <Users className="size-3.5" aria-hidden="true" />
        <span>All tradies</span>

        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
            query.tab === "all"
              ? "bg-card text-royal-gold-ink-text"
              : "bg-muted text-muted-foreground",
          )}
        >
          {totalCount}
        </span>
      </FilterChip>

      <FilterChip
        active={query.tab === "flagged"}
        onClick={() => changeQueryTab("flagged")}
      >
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        <span>Flagged</span>

        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
            query.tab === "flagged"
              ? "bg-card text-warning-ink"
              : "bg-warning-light text-warning-ink",
          )}
        >
          {flaggedCount}
        </span>
      </FilterChip>
    </FilterChips>
  );
}
