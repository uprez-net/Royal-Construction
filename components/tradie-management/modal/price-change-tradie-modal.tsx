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

  const [formData, setFormData] = useState({
    newHourlyRate: 0,
    reason: "",
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      setFormData({
        newHourlyRate: Number(tradie.hourlyRate ?? 0),
        reason: "",
      });
    }
  };

  const handleSubmit = async () => {
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

      toast.success("Price change submitted successfully!");
      onClose();
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
            <BadgeDollarSign className="h-5 w-5 text-blue-600" />
            Request Price Change
          </DialogTitle>

          <DialogDescription>
            {tradie.name} • {tradie.trade}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Rate */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Current Hourly Rate
            </div>

            <div className="mt-1 text-3xl font-extrabold text-primary">
              ${tradie.hourlyRate ?? 0}
              <span className="ml-1 text-sm font-medium text-muted-foreground">
                /hr
              </span>
            </div>
          </div>

          {/* New Rate */}
          <div className="space-y-2">
            <Label htmlFor="new-rate">Proposed New Rate ($/hr)</Label>

            <Input
              id="new-rate"
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 90"
              value={formData.newHourlyRate}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  newHourlyRate: Number(e.target.value),
                }))
              }
            />
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason for Change
              <span className="ml-1 text-destructive">*</span>
            </Label>

            <Textarea
              id="reason"
              rows={4}
              placeholder="Explain why this price change is needed..."
              value={formData.reason}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  reason: e.target.value,
                }))
              }
            />
          </div>

          {/* Info Box */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />

              <p className="text-xs leading-relaxed text-muted-foreground">
                This request will be submitted for approval. The hourly rate
                will only be updated once the request has been reviewed and
                approved.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <Button onClick={() => startTransition(handleSubmit)} disabled={isPending}>
              <Send className="mr-2 h-4 w-4" />
              Submit for Approval
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
