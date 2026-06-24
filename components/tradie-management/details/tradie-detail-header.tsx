import {
  AlertTriangle,
  BadgeAlert,
  Fan,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { TradieBadge } from "../trade-badge";

export function TradieCard() {
  const dispatch = useAppDispatch();
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }
  
  const { name, trade, incidents } = tradieDetails;
  const openIncidentsCount = incidents.filter(
    (incident) => incident.status === "OPEN",
  ).length;
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("");

  const handlePriceChange = () => {
    // Handle price change logic here
  };

  const handleReport = () => {};

  const handleSetPriority = () => {};

  const handleDelete = () => {};

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-100 text-lg font-bold text-emerald-600">
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-extrabold">{name}</h3>

              {openIncidentsCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <BadgeAlert className="h-3 w-3" />
                  {openIncidentsCount} Flagged
                </Badge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{name}</span>

              <TradieBadge trade={trade} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handlePriceChange}>
            <Tag className="mr-2 h-4 w-4" />
            Price Change
          </Button>

          <Button variant="outline" size="sm" onClick={handleReport}>
            <AlertTriangle className="mr-2 h-4 w-4" />
            Report
          </Button>

          <Button
            size="sm"
            className="bg-amber-500 hover:bg-amber-600"
            onClick={handleSetPriority}
          >
            <Star className="mr-2 h-4 w-4" />
            Set Ratings
          </Button>

          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
