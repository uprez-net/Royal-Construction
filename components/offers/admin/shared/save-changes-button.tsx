"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useUnsavedAdminGuard } from "./use-unsaved-admin-guard";

interface SaveChangesButtonProps {
  dirty: boolean;
  saving: boolean;
  /** Return the save's promise (`dispatch(saveX()).unwrap()`) to confirm a
   * successful save with a toast. */
  onSave: () => Promise<unknown> | void;
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
      .then(() => toast.success(successMessage))
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
