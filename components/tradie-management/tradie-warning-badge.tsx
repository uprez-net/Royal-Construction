import { Card } from "@/components/ui/card";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setQuery } from "@/lib/store/slices/tradieManagementSlice";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useMemo } from "react";

export function UnresolvedIncidentsCard() {
  const dispatch = useAppDispatch();
  const { tradies } = useAppSelector((state) => state.tradieManagement);
  const count: number = useMemo(() => {
    return tradies.reduce((acc, tradies) => {
      return acc + tradies.incidentCount.open;
    }, 0);
  }, [tradies]);

  const handleAction = () => {
    dispatch(setQuery({ tab: "flagged" }));
  };

  if(count === 0) {
    return null;
  }

  return (
    <Card
      onClick={handleAction}
      className="flex cursor-pointer items-start gap-3 border-red-200 bg-red-50 p-4 transition-colors hover:bg-red-100"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
        <AlertTriangle className="h-5 w-5" />
      </div>

      <div className="flex-1">
        <div className="mb-0.5 text-sm font-bold text-red-600">
          {count} Unresolved Incident{count !== 1 ? "s" : ""}
        </div>

        <div className="text-xs text-muted-foreground">
          Click to view flagged tradies in table view
        </div>
      </div>

      <ChevronRight className="mt-2 h-4 w-4 text-red-600" />
    </Card>
  );
}
