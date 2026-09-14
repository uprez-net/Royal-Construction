"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useUnsavedAdminGuard } from "./use-unsaved-admin-guard";

interface SaveChangesButtonProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function SaveChangesButton({
  dirty,
  saving,
  onSave,
  label = "Save Changes",
  className,
  disabled,
}: SaveChangesButtonProps) {
  useUnsavedAdminGuard();

  return (
    <Button
      type="button"
      onClick={onSave}
      disabled={disabled || !dirty || saving}
      className={cn("min-w-32", className)}
    >
      {saving && <Spinner className="size-4" />}
      {saving ? "Saving…" : label}
    </Button>
  );
}
