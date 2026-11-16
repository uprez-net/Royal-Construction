import {
  AlertTriangle,
  BadgeAlert,
  MoreVertical,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { TradieBadge } from "../trade-badge";
import { tradieTrades } from "@/lib/domain/tradies/request-rules";
import { TradieRow } from "@/types/tradie";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TRADE_AVATAR_CLASS } from "@/constants/tradeChip";
import { cn } from "@/lib/utils";

export function TradieCard() {
  const dispatch = useAppDispatch();
  const tradieDetails = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );

  if (!tradieDetails) {
    return null;
  }

  const { name, incidents } = tradieDetails;
  const trades = tradieTrades(tradieDetails);
  const openIncidentsCount = incidents.filter(
    (incident) => incident.status === "OPEN",
  ).length;
  const tradieRow = {
    incidentCount: {
      open: openIncidentsCount,
      resolved: tradieDetails.incidents.length - openIncidentsCount,
    },
    id: tradieDetails.id,
    name: tradieDetails.name,
    trade: tradieDetails.trade,
    trades,
    isFavourite: tradieDetails.isFavourite,
    lastQuotedPrice: tradieDetails.lastQuotedPrice ?? null,
    lastQuotedPriceUnit: tradieDetails.lastQuotedPriceUnit,
    rating: tradieDetails.rating ?? null,
    jobsCompleted: tradieDetails.jobsCompleted,
  } satisfies TradieRow;
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("");

  const handlePriceChange = () => {
    dispatch(
      openModal({ type: "priceChangeTradie", payload: { tradie: tradieRow } }),
    );
  };

  const handleReport = () => {
    dispatch(
      openModal({ type: "reportTradie", payload: { tradie: tradieRow } }),
    );
  };

  const handleDelete = () => {
    dispatch(
      openModal({ type: "deleteTradie", payload: { tradie: tradieRow } }),
    );
  };

  const handleEditTradie = () => {
    dispatch(
      openModal({ type: "editTradie", payload: { tradie: tradieDetails } }),
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(TRADE_AVATAR_CLASS, "h-14 w-14 text-lg")}
            aria-hidden="true"
          >
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-xl font-semibold text-foreground">
                {name}
              </h1>

              {openIncidentsCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <BadgeAlert className="h-3 w-3" aria-hidden="true" />
                  {openIncidentsCount} open{" "}
                  {openIncidentsCount === 1 ? "incident" : "incidents"}
                </Badge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {trades.map((trade) => (
                <TradieBadge key={trade} trade={trade} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={handleEditTradie}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            Edit details
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handlePriceChange}>
                <Tag className="mr-2 h-4 w-4" aria-hidden="true" />
                Price change
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleReport}>
                <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
                Report incident
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={handleDelete} variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Delete tradie
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
