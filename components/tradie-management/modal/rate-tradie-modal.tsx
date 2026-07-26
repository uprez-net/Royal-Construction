import { Star, Info } from "lucide-react";

import { TradieRow } from "@/types/tradie";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";

import { useState, useTransition } from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { toast } from "sonner";

import { rateTradieThunk } from "@/lib/store/slices/tradieManagementSlice";

import { StarRatingInput } from "../rating-input";
import { RatingStars } from "@/components/common/rating-stars";

interface RateTradieModalProps {
  open: boolean;
  tradie: TradieRow;
  onClose: () => void;
}

export default function RateTradieModal({
  open,
  tradie,
  onClose,
}: RateTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const [rating, setRating] = useState(
    tradie.rating ? parseFloat(tradie.rating) : 0,
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      setRating(0);
    }
  };

  const handleSubmit = () => {
    if (rating === 0) {
      toast.error("Please select a rating.");
      return;
    }

    startTransition(async () => {
      try {
        await dispatch(
          rateTradieThunk({
            tradieId: tradie.id,
            rating,
          }),
        ).unwrap();

        toast.success("Rating submitted successfully.");

        onClose();
      } catch (error) {
        toast.error("Error rating tradie. Please try again.");

        console.error("Error rating tradie:", error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-warning text-warning" aria-hidden="true" />
            Rate tradie
          </DialogTitle>

          <DialogDescription>
            {tradie.name} &middot; {tradie.trade}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current rating */}

          <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Current rating
            </div>

            <div className="flex items-center gap-3">
              <RatingStars
                rating={parseFloat(tradie.rating ?? "0")}
                size={20}
              />
            </div>
          </div>

          {/* New rating */}

          <div className="space-y-2">
            <div id="new-rating-label" className="text-sm font-medium">
              New rating
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </div>

            <div className="rounded-lg border border-border/70 p-4">
              <StarRatingInput
                value={rating}
                onChange={setRating}
                labelledById="new-rating-label"
              />
            </div>
          </div>

          {/* Info */}

          <div className="rounded-lg bg-info-light p-3">
            <div className="flex gap-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-info-ink"
                aria-hidden="true"
              />

              <p className="text-xs leading-relaxed text-foreground/80">
                Updating a tradie&apos;s rating affects their overall performance
                score and visibility throughout the platform.
              </p>
            </div>
          </div>

          {/* Footer */}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>

            <Button onClick={handleSubmit} disabled={isPending || rating === 0}>
              <Star className="mr-2 h-4 w-4" aria-hidden="true" />

              {isPending ? "Submitting…" : "Submit rating"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
