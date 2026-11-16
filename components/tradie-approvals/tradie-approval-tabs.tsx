"use client";

import {
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useTransition } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setQuery,
  setActiveTab,
  fetchApprovalsByQuery,
  approveRequests,
} from "@/lib/store/slices/tradieApprovalSlice";
import { ApprovalKPI, TabKey } from "@/types/tradie-approvals";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { ApprovalInput, SafeTradieApproval } from "@/types/tradie";
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

const handlePayload = (approval: SafeTradieApproval, resolution: string) => {
  switch (approval.actionType) {
    case "PRICE_CHANGE":
      return {
        newHourlyRate: (approval.updationData as { newHourlyRate: number })
          .newHourlyRate,
      };
    case "INCIDENT_RESOLUTION":
      return {
        resolution,
      };
    default:
      return undefined;
  }
};

// Status views sit on the toolbar (desktop); request types are quick chips in
// the card header. Below md one select holds all of them, as before.
interface Tab {
  key: TabKey;
  label: string;
  count: number;
}

interface ViewTab extends Tab {
  icon: LucideIcon;
}

const statusViews = (kpi: ApprovalKPI): ViewTab[] => [
  {
    key: "all",
    label: "All",
    count:
      kpi.pendingCount
      + kpi.resolvedCount.accepted
      + kpi.resolvedCount.rejected,
    icon: Clock3,
  },
  {
    key: "pending",
    label: "Pending",
    count: kpi.pendingCount,
    icon: Clock3,
  },
  {
    key: "approved",
    label: "Approved",
    count: kpi.resolvedCount.accepted,
    icon: CheckCircle2,
  },
  {
    key: "rejected",
    label: "Rejected",
    count: kpi.resolvedCount.rejected,
    icon: XCircle,
  },
];

const requestTypes = (kpi: ApprovalKPI): Tab[] => [
  { key: "price", label: "Price Changes", count: kpi.priceChangeCount },
  { key: "incident", label: "Incidents", count: kpi.incidentReportCount },
  { key: "delete", label: "Deletions", count: kpi.deletionCount },
  { key: "schedule", label: "Scheduling", count: kpi.scheduleCount },
  {
    key: "scheduleDeletion",
    label: "Schedule Removals",
    count: kpi.scheduleDeletionCount,
  },
];

/** The tab change: sets the active tab and the query it implies. */
function useApprovalTabChange() {
  const dispatch = useAppDispatch();
  const query = useAppSelector((state) => state.tradieApproval.query);

  return (tab: TabKey) => {
    dispatch(setActiveTab(tab));

    const updates: Partial<typeof query> = { page: 1 };

    switch (tab) {
      case "all":
        updates.status = undefined;
        updates.type = undefined;
        break;
      case "pending":
        updates.type = undefined;
        updates.status = "PENDING";
        break;
      case "approved":
        updates.type = undefined;
        updates.status = "APPROVED";
        break;
      case "rejected":
        updates.type = undefined;
        updates.status = "REJECTED";
        break;
      case "delete":
        updates.type = "TRADIE_REMOVAL";
        updates.status = undefined;
        break;
      case "incident":
        updates.type = "INCIDENT_RESOLUTION";
        updates.status = undefined;
        break;
      case "price":
        updates.type = "PRICE_CHANGE";
        updates.status = undefined;
        break;
      case "schedule":
        updates.type = "SCHEDULE_APPROVAL";
        updates.status = undefined;
        break;
      case "scheduleDeletion":
        updates.type = "SCHEDULE_DELETION";
        updates.status = undefined;
        break;
      default:
        return;
    }

    dispatch(
      setQuery({
        ...query,
        ...updates,
      }),
    );
  };
}

/** The toolbar: status view tabs on the left; search and bulk actions on the right. */
export function TradieApprovalTabs() {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const { query, activeTab, selectedApprovalIds, approvals, kpiData } =
    useAppSelector((state) => state.tradieApproval);
  const onTabChange = useApprovalTabChange();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setQuery({ search: e.target.value, page: 1 })); // Reset to page 1 on search change
  };

  useEffect(() => {
    dispatch(fetchApprovalsByQuery(query));
  }, [query, dispatch]);

  const handleSelectedApprove = async () => {
    try {
      const approvalsToApprove = approvals.filter((a) =>
        selectedApprovalIds.includes(a.id),
      );
      if (!approvalsToApprove.length) {
        throw new Error("No selected approvals found");
      }

      const approvalInputs = approvalsToApprove.map((approval) => ({
        approvalId: approval.id,
        resolution: "approved",
        type: approval.actionType,
        payload: handlePayload(approval, "approved"),
      })) satisfies ApprovalInput[];

      await dispatch(approveRequests(approvalInputs)).unwrap();
      toast.success("Approval request approved successfully");
    } catch (error) {
      console.error("Error creating approval input:", error);
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    }
  };

  const handleSelectedReject = async () => {
    try {
      const approvalsToReject = approvals.filter((a) =>
        selectedApprovalIds.includes(a.id),
      );
      if (!approvalsToReject.length) {
        throw new Error("No selected approvals found");
      }

      dispatch(
        openModal({
          type: "rejectTradieApprovals",
          payload: {
            approvals: approvalsToReject,
          },
        }),
      );
    } catch (error) {
      console.error("Error creating approval input:", error);
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    }
  };

  return (
    <ListToolbar
      start={
        <div className="hidden flex-wrap items-center gap-1.5 md:flex">
          {statusViews(kpiData).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={active}
                onClick={() => onTabChange(tab.key)}
                className={viewTabClass(active)}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{tab.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {tab.count}
                </span>
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
        value={query.search}
        onChange={handleSearchChange}
      />

      {selectedApprovalIds.length > 0 && (
        <>
          <Button
            variant="outline"
            className={`${TOOLBAR_BUTTON_CLASS} bg-success hover:bg-success text-white`}
            onClick={() => startTransition(handleSelectedApprove)}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Approving {selectedApprovalIds.length}...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Approve {selectedApprovalIds.length}
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startTransition(handleSelectedReject)}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rejecting {selectedApprovalIds.length}...
              </>
            ) : (
              <>
                <X className="h-4 w-4" />
                Reject {selectedApprovalIds.length}
              </>
            )}
          </Button>
        </>
      )}
    </ListToolbar>
  );
}

/** The card header: request-type chips (desktop) or one select (phone). */
export function TradieApprovalTypeFilters() {
  const { activeTab, kpiData } = useAppSelector(
    (state) => state.tradieApproval,
  );
  const onTabChange = useApprovalTabChange();
  const [all, pending, approved, rejected] = statusViews(kpiData);
  const types = requestTypes(kpiData);

  return (
    <>
      <MobileFilterSelect
        label="Approval status or request type"
        value={activeTab}
        options={[all, pending, ...types, approved, rejected].map((tab) => ({
          value: tab.key,
          label: tab.label,
          count: tab.count,
        }))}
        onChange={(value) => onTabChange(value as TabKey)}
      />
      <FilterChips className="hidden md:flex">
        {types.map((tab) => (
          <FilterChip
            key={tab.key}
            active={activeTab === tab.key}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
            <span className="tabular-nums opacity-70">{tab.count}</span>
          </FilterChip>
        ))}
      </FilterChips>
    </>
  );
}
