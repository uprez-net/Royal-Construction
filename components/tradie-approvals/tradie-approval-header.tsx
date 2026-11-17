"use client";
import { KpiBand, MOBILE_METRIC_STRIP_CLASS } from "../common/kpi-band";
import { LeadMetricCard } from "../common/lead-onclick-metric-card";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  approvalTypeLabel,
  setQuery,
} from "@/lib/store/slices/tradieApprovalSlice";
import { openModal } from "@/lib/store/slices/uiSlice";

/**
 * The three figures above the list. Waiting and Due this week are filters;
 * Oldest waiting opens that request's review window. None of them is a count
 * the list does not show: each click lands on the rows it counts.
 */
export function TradieApprovalKPI() {
  const dispatch = useAppDispatch();
  const { kpiData, query } = useAppSelector((state) => state.tradieApproval);
  const oldest = kpiData.oldestWaiting;

  // A search narrows the rows, so no filter tile is lit while one is typed.
  const searching = Boolean(query.search?.trim());
  const waitingActive =
    query.view === "needs-decision" && !query.type && !query.due && !searching;
  const dueActive =
    query.view === "needs-decision" && query.due === "week" && !searching;

  return (
    <KpiBand className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-3")}>
      <LeadMetricCard
        label="Waiting"
        value={String(kpiData.waiting)}
        note="Need a decision"
        active={waitingActive}
        onClick={() =>
          dispatch(
            setQuery({
              view: "needs-decision",
              type: undefined,
              due: undefined,
              search: "",
              page: 1,
            }),
          )
        }
      />
      <LeadMetricCard
        label="Oldest waiting"
        toggle={false}
        value={
          oldest
            ? `${oldest.days} ${oldest.days === 1 ? "day" : "days"}`
            : "None"
        }
        note={
          oldest
            ? `${approvalTypeLabel[oldest.actionType]} request`
            : "Nothing waiting"
        }
        onClick={
          oldest
            ? () =>
                dispatch(
                  openModal({
                    type: "adminApproval",
                    payload: {
                      approvalId: oldest.approvalId,
                      approvalType: oldest.actionType,
                    },
                  }),
                )
            : undefined
        }
      />
      <LeadMetricCard
        label="Due this week"
        value={String(kpiData.dueThisWeek)}
        note="Booked within 7 days, or overdue"
        active={dueActive}
        onClick={() =>
          dispatch(
            setQuery({
              view: "needs-decision",
              due: "week",
              type: undefined,
              search: "",
              page: 1,
            }),
          )
        }
      />
    </KpiBand>
  );
}
