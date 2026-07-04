import {
  AlertTriangle,
  Eye,
  MoreVertical,
  Star,
  Tag,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieRow } from "@/types/tradie";
import { MouseEvent, useTransition } from "react";
import { toast } from "sonner";
import { toggleTradieFavouriteThunk } from "@/lib/store/slices/tradieManagementSlice";

interface TradieActionsDropdownProps {
  tradieRow: TradieRow;
}

export function TradieActionsDropdown({
  tradieRow,
}: TradieActionsDropdownProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const dispatch = useAppDispatch();
  const onViewDetails = () => {
    router.push(`/tradie-management/${tradieRow.id}`);
  };
  const onPriceChange = (
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>,
  ) => {
    e.stopPropagation();
    dispatch(
      openModal({ type: "priceChangeTradie", payload: { tradie: tradieRow } }),
    );
  };

  const onReportIncident = (
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>,
  ) => {
    e.stopPropagation();
    dispatch(
      openModal({ type: "reportTradie", payload: { tradie: tradieRow } }),
    );
  };

  const onSetPriority = (
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>,
  ) => {
    e.stopPropagation();
    dispatch(openModal({ type: "rateTradie", payload: { tradie: tradieRow } }));
  };

  const onDelete = (e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>) => {
    e.stopPropagation();
    dispatch(
      openModal({ type: "deleteTradie", payload: { tradie: tradieRow } }),
    );
  };

  const onToggleFavourite = async (
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>,
  ) => {
    e.stopPropagation();
    try {
      const toastId = toast.loading(
        `${tradieRow.isFavourite ? "Removing from" : "Adding to"} favorites...`,
      );
      await dispatch(
        toggleTradieFavouriteThunk({
          tradieId: tradieRow.id,
          isFavourite: !tradieRow.isFavourite,
        }),
      ).unwrap();
      toast.success(
        `${
          tradieRow.isFavourite ? "Removed from" : "Added to"
        } favorites successfully.`,
        { id: toastId },
      );
    } catch (error) {
      toast.error("Failed to update favorite status. Please try again.");
      console.error("Error updating favorite status:", error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onViewDetails}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onPriceChange}>
          <Tag className="mr-2 h-4 w-4" />
          Price Change
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onReportIncident}>
          <AlertTriangle className="mr-2 h-4 w-4" />
          Report Incident
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onSetPriority}>
          <Star className="mr-2 h-4 w-4" />
          Rate Tradie
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={(e) => startTransition(() => onToggleFavourite(e))}
          disabled={isPending}
        >
          <Star
            className={`mr-2 h-4 w-4 ${
              tradieRow.isFavourite ? "fill-yellow-400 text-yellow-400" : ""
            }`}
          />

          {tradieRow.isFavourite ? "Remove from Favorites" : "Add to Favorites"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Tradie
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
