import { BadgeDollarSign, Info, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch } from "@/lib/store/hooks";
import { updateTradiePriceThunk } from "@/lib/store/slices/tradieManagementSlice";
import { TradieRow } from "@/types/tradie";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { rateCurrency } from "@/utils/formatters";
import { formatQuotedPrice } from "@/utils/calculations";

interface PriceChangeTradieModalProps {
  open: boolean;
  tradie: TradieRow;
  onClose: () => void;
}

export default function PriceChangeTradieModal({
  open,
  tradie,
  onClose,
}: PriceChangeTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const currentRate = Number(tradie.lastQuotedPrice ?? 0);
  const hasCurrentRate =
    tradie.lastQuotedPrice != null && !Number.isNaN(currentRate);

  const [formData, setFormData] = useState({
    newHourlyRate: currentRate,
    reason: "",
  });

  const isRateValid =
    Number.isFinite(formData.newHourlyRate) && formData.newHourlyRate > 0;
  const isRateChanged = formData.newHourlyRate !== currentRate;
  const canSubmit =
    !isPending &&
    isRateValid &&
    isRateChanged &&
    Boolean(formData.reason.trim());

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      setFormData({
        newHourlyRate: currentRate,
        reason: "",
      });
    }
  };

  const handleSubmit = async () => {
    if (!isRateValid) {
      toast.error("Enter a proposed rate greater than zero.");
      return;
    }

    if (!isRateChanged) {
      toast.error("The proposed rate matches the current rate.");
      return;
    }

    if (!formData.reason.trim()) {
      toast.error("Please provide a reason for the price change.");
      return;
    }

    try {
      await dispatch(
        updateTradiePriceThunk({
          tradieId: tradie.id,
          newHourlyRate: formData.newHourlyRate,
          reason: formData.reason,
        }),
      ).unwrap();

      toast.success("Price change submitted for approval.");
      handleOpenChange(false);
    } catch (error) {
      toast.error("Error submitting price change. Please try again.");
      console.error(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeDollarSign
              className="h-5 w-5 text-info-ink"
              aria-hidden="true"
            />
            Request price change
          </DialogTitle>

          <DialogDescription>
            {tradie.name} &middot; {tradie.trade} &middot;{" "}
            {/* The basis is not editable here — it rides in the approval
                payload, which only carries an amount. Showing it stops an
                approver reading a fixed job price as an hourly rate. */}
            {tradie.lastQuotedPriceUnit === "FIXED"
              ? "priced fixed for the job"
              : "priced per hour"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current rate */}
          <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Last Quoted Price
            </div>

            {/* Mono is reserved for actual figures; the placeholder renders as
                prose so a missing rate does not read like recorded data. */}
            <div
              className={
                hasCurrentRate
                  ? "mt-1 font-mono text-3xl font-semibold tabular-nums text-foreground"
                  : "mt-1 text-3xl font-semibold text-muted-foreground"
              }
            >
              {hasCurrentRate
                ? formatQuotedPrice(currentRate, tradie.lastQuotedPriceUnit, rateCurrency.format)
                : "Not set"}
              {hasCurrentRate && (
                <span className="ml-1 font-sans text-sm font-medium text-muted-foreground">
                </span>
              )}
            </div>
          </div>

          {/* New rate */}
          <div className="space-y-2">
            <Label htmlFor="new-rate">
              New Quoted Price
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>

            <Input
              id="new-rate"
              type="number"
              min={0}
              step={1}
              required
              className="font-mono tabular-nums"
              placeholder="e.g. 90"
              value={formData.newHourlyRate}
              aria-invalid={!isRateValid}
              aria-describedby="new-rate-hint"
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  newHourlyRate: Number(e.target.value),
                }))
              }
            />

            <p id="new-rate-hint" className="text-xs text-muted-foreground">
              {!isRateValid
                ? "Enter a rate greater than zero."
                : !isRateChanged
                  ? "The proposed rate matches the current rate."
                  : "Ready to submit for approval."}
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason for change
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>

            <Textarea
              id="reason"
              rows={4}
              maxLength={500}
              required
              placeholder="Explain why this price change is needed…"
              value={formData.reason}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  reason: e.target.value,
                }))
              }
            />
          </div>

          {/* Info box */}
          <div className="rounded-lg bg-info-light p-3">
            <div className="flex gap-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-info-ink"
                aria-hidden="true"
              />

              <p className="text-xs leading-relaxed text-foreground/80">
                This request is submitted for approval. The new proposed price is only
                updated once the request has been reviewed and approved.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>

            <Button
              onClick={() => startTransition(handleSubmit)}
              disabled={!canSubmit}
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              {isPending ? "Submitting…" : "Submit for approval"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
