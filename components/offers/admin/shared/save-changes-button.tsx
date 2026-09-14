"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { AdminSaveReceipt } from "@/lib/store/slices/admin-offer-content-save";
import { useUnsavedAdminGuard } from "./use-unsaved-admin-guard";

interface SaveChangesButtonProps {
  dirty: boolean;
  saving: boolean;
  /** Return the save's promise (`dispatch(saveX()).unwrap()`) to confirm a
   * successful save with a toast. */
  onSave: () => Promise<AdminSaveReceipt> | void;
  successMessage?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function SaveChangesButton({
  dirty,
  saving,
  onSave,
  successMessage = "Changes saved.",
  label = "Save Changes",
  className,
  disabled,
}: SaveChangesButtonProps) {
  useUnsavedAdminGuard();

  const handleSave = () => {
    const result = onSave();
    if (!result) return;
    result
      .then((receipt) =>
        // Edits made while the save was in flight keep the section dirty and
        // Save enabled; the toast says so rather than implying all is saved.
        toast.success(successMessage, {
          description: receipt.newerEdits
            ? "Edits made during the save still need saving."
            : undefined,
        }),
      )
      .catch(() => {
        // A failed save has already put its message in the section's inline
        // alert; this only keeps the rejection from surfacing as unhandled.
      });
  };

  return (
    <Button
      type="button"
      onClick={handleSave}
      disabled={disabled || !dirty || saving}
      className={cn("min-w-32", className)}
    >
      {saving && <Spinner className="size-4" />}
      {saving ? "Saving…" : label}
    </Button>
  );
}
