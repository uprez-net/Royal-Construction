import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setActiveTab,
  setQuery,
} from "@/lib/store/slices/tradieManagementSlice";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

export function UnresolvedIncidentsCard() {
  const dispatch = useAppDispatch();
  const { tradies } = useAppSelector((state) => state.tradieManagement);
  const count: number = useMemo(() => {
    return tradies.reduce((acc, tradie) => {
      return acc + tradie.incidentCount.open;
    }, 0);
  }, [tradies]);

  // The callout is an action, not a link: it filters the surface to the tradies
  // carrying open incidents and shows them in the table view, where the incident
  // counts are visible. The label says exactly that, so there is no chevron
  // implying navigation to another page.
  const handleAction = () => {
    dispatch(setActiveTab("table"));
    dispatch(setQuery({ tab: "flagged" }));
  };

  if (count === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-destructive-light p-4 shadow-sm">
      <AlertTriangle
        className="size-5 shrink-0 text-destructive-ink"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive-ink">
          {count} unresolved incident{count !== 1 ? "s" : ""}
        </p>

        <p className="text-xs text-muted-foreground">
          Reported against tradies you are still working with.
        </p>
      </div>

      <Button variant="outline" onClick={handleAction}>
        View flagged tradies
      </Button>
    </div>
  );
}
