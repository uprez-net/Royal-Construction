"use client";

import { Check, Clock3, CheckCircle2, X, type LucideIcon } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setQuery } from "@/lib/store/slices/tradieApprovalSlice";
import type {
  ApprovalView,
  TradieApprovalQuery,
} from "@/types/tradie-approvals";
import type { SafeTradieApproval } from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { Button } from "../ui/button";
import { MobileFilterSelect } from "@/components/common/mobile-filter-select";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  FilterChip,
  FilterChips,
  ListToolbar,
  TOOLBAR_BUTTON_CLASS,
  ToolbarSearch,
  VIEW_TAB_BAR_CLASS,
  viewTabClass,
} from "@/components/common/list-toolbar";

const viewTabs: { view: ApprovalView; label: string; icon: LucideIcon }[] = [
  { view: "needs-decision", label: "Needs decision", icon: Clock3 },
  { view: "decided", label: "Decided", icon: CheckCircle2 },
];

const chipLabel: Record<TradieApprovalActionType, string> = {
  PRICE_CHANGE: "Price Changes",
  INCIDENT_RESOLUTION: "Incidents",
  TRADIE_REMOVAL: "Deletions",
  SCHEDULE_APPROVAL: "Scheduling",
  SCHEDULE_DELETION: "Schedule Removals",
  TRADE_CANCELLATION: "Trade Cancellations",
};

const requestTypes = Object.values(TradieApprovalActionType);

/**
 * The toolbar: the two views on the left; search and bulk actions on the
 * right. Bulk approve goes through onApprove, which confirms a cancelling batch.
 */
export function TradieApprovalTabs({
  onApprove,
  processingIds,
}: {
  onApprove: (rows: SafeTradieApproval[]) => Promise<void>;
  processingIds: ReadonlySet<string>;
}) {
  const dispatch = useAppDispatch();
  const { query, selectedApprovalIds, approvals } = useAppSelector(
    (state) => state.tradieApproval,
  );

  const switchView = (view: ApprovalView) => {
    // Due dates only mean something for requests still waiting.
    dispatch(
      setQuery({
        view,
        page: 1,
        ...(view === "decided" ? { due: undefined } : {}),
      }),
    );
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setQuery({ search: e.target.value, page: 1 })); // Reset to page 1 on search change
  };

  const selectedRows = approvals.filter((a) =>
    selectedApprovalIds.includes(a.id),
  );

  const handleSelectedReject = () => {
    if (!selectedRows.length) return;
    dispatch(
      openModal({
        type: "rejectTradieApprovals",
        payload: {
          approvals: selectedRows,
        },
      }),
    );
  };

  return (
    <ListToolbar
      start={
        <div className="flex flex-wrap items-center gap-1.5">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            const active = query.view === tab.view;

            return (
              <button
                key={tab.view}
                type="button"
                aria-pressed={active}
                onClick={() => switchView(tab.view)}
                className={viewTabClass(active)}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{tab.label}</span>
                {active && <span className={VIEW_TAB_BAR_CLASS} />}
              </button>
            );
          })}
        </div>
      }
    >
      <ToolbarSearch
        id="search"
        aria-label="Search approvals"
        placeholder="Search approvals…"
        value={query.search ?? ""}
        onChange={handleSearchChange}
      />

      {selectedRows.length > 0 && (
        <>
          <Button
            variant="outline"
            className={`${TOOLBAR_BUTTON_CLASS} bg-success hover:bg-success text-white`}
            onClick={() => void onApprove(selectedRows)}
            disabled={selectedRows.some((row) => processingIds.has(row.id))}
          >
            <Check className="h-4 w-4" />
            Approve {selectedRows.length}
          </Button>
          <Button
            variant="destructive"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={handleSelectedReject}
          >
            <X className="h-4 w-4" />
            Reject {selectedRows.length}
          </Button>
        </>
      )}
    </ListToolbar>
  );
}

/**
 * The card header: request-type chips (desktop) or one select (phone). Counts
 * are for the view on screen. With the due-this-week filter on, no per-type
 * figure exists, so the counts are left off rather than shown wrong.
 */
export function TradieApprovalTypeFilters() {
  const dispatch = useAppDispatch();
  const { query, kpiData } = useAppSelector((state) => state.tradieApproval);
  const decided = query.view === "decided";
  const counts = decided ? kpiData.decidedByType : kpiData.waitingByType;
  const total = decided ? kpiData.decided : kpiData.waiting;
  // The counts are for the whole view; under a search or the due filter they
  // would not match the rows shown, so they are hidden there.
  const showCounts = !query.due && !query.search?.trim();

  const setType = (type: TradieApprovalQuery["type"]) =>
    dispatch(setQuery({ type, page: 1 }));

  // Clicking the active type clears it, back to all types.
  const toggleType = (type: TradieApprovalActionType) =>
    setType(query.type === type ? undefined : type);

  return (
    <>
      <MobileFilterSelect
        label="Request type"
        value={query.type ?? "all"}
        options={[
          {
            value: "all",
            label: "All types",
            count: showCounts ? total : undefined,
          },
          ...requestTypes.map((type) => ({
            value: type,
            label: chipLabel[type],
            count: showCounts ? counts[type] : undefined,
          })),
        ]}
        onChange={(value) =>
          setType(
            value === "all" ? undefined : (value as TradieApprovalActionType),
          )
        }
      />
      <FilterChips className="hidden md:flex">
        <FilterChip active={!query.type} onClick={() => setType(undefined)}>
          All types
          {showCounts && (
            <span className="tabular-nums opacity-70">{total}</span>
          )}
        </FilterChip>
        {requestTypes.map((type) => (
          <FilterChip
            key={type}
            active={query.type === type}
            onClick={() => toggleType(type)}
          >
            {chipLabel[type]}
            {showCounts && (
              <span className="tabular-nums opacity-70">{counts[type]}</span>
            )}
          </FilterChip>
        ))}
      </FilterChips>
    </>
  );
}
