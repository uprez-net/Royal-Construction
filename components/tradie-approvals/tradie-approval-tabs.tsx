"use client";

import {
  CheckCircle2,
  Clock3,
  Calendar,
  DollarSign,
  AlertTriangle,
  Trash2,
  XCircle,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import { Input } from "../ui/input";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setQuery,
  setActiveTab,
  fetchApprovalsByQuery,
  approveRequests,
} from "@/lib/store/slices/tradieApprovalSlice";
import { TabKey } from "@/types/tradie-approvals";
import { Button } from "../ui/button";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { ApprovalInput, SafeTradieApproval } from "@/types/tradie";

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

export function TradieApprovalTabs() {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const { query, activeTab, selectedApprovalIds, approvals } = useAppSelector(
    (state) => state.tradieApproval,
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setQuery({ search: e.target.value, page: 1 })); // Reset to page 1 on search change
  };

  const handleTabChange = (tab: TabKey) => {
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

      const approvalInputs = approvalsToReject.map((approval) => ({
        approvalId: approval.id,
        resolution: "rejected",
        type: approval.actionType,
        payload: handlePayload(approval, "rejected"),
      })) satisfies ApprovalInput[];

      await dispatch(approveRequests(approvalInputs)).unwrap();
      toast.success("Approval request rejected successfully");
    } catch (error) {
      console.error("Error creating approval input:", error);
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    }
  };

  return (
    <>
      <div className="flex w-full items-center justify-between gap-4">
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

        {selectedApprovalIds.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="bg-green-500 hover:bg-green-600 text-white"
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
              variant="outline"
              className="bg-red-500 hover:bg-red-600 text-white"
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
          </div>
        )}
      </div>
      <ApprovalTabs activeTab={activeTab} onTabChange={handleTabChange} />
    </>
  );
}

interface TabItem {
  key: TabKey;
  label: string;
  count: number;
  icon: React.ElementType;
}

interface ApprovalTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

function ApprovalTabs({ activeTab, onTabChange }: ApprovalTabsProps) {
  const { kpiData } = useAppSelector((state) => state.tradieApproval);
  const tabs: TabItem[] = [
    {
      key: "all",
      label: "All",
      count:
        kpiData.pendingCount +
        kpiData.resolvedCount.accepted +
        kpiData.resolvedCount.rejected,
      icon: Clock3,
    },
    {
      key: "pending",
      label: "Pending",
      count: kpiData.pendingCount,
      icon: Clock3,
    },
    {
      key: "price",
      label: "Price Changes",
      count: kpiData.priceChangeCount,
      icon: DollarSign,
    },
    {
      key: "incident",
      label: "Incidents",
      count: kpiData.incidentReportCount,
      icon: AlertTriangle,
    },
    {
      key: "delete",
      label: "Deletions",
      count: kpiData.deletionCount,
      icon: Trash2,
    },
    {
      key: "schedule",
      label: "Scheduling",
      count: kpiData.scheduleCount,
      icon: Calendar,
    },
  ];

  const statusTabs: TabItem[] = [
    {
      key: "approved",
      label: "Approved",
      count: kpiData.resolvedCount.accepted,
      icon: CheckCircle2,
    },
    {
      key: "rejected",
      label: "Rejected",
      count: kpiData.resolvedCount.rejected,
      icon: XCircle,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" />

            <span>{tab.label}</span>

            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeTab === tab.key
                  ? "bg-primary-foreground/20"
                  : "bg-muted-foreground/10",
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}

      <div className="flex-1" />

      {statusTabs.map((tab) => {
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" />

            <span>{tab.label}</span>

            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeTab === tab.key
                  ? "bg-primary-foreground/20"
                  : "bg-muted-foreground/10",
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
