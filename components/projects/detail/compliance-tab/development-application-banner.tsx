"use client";

import { ComplianceExternalApplicationKind } from "@prisma/client";
import { FileStack, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  setDevelopmentApplicationRequired,
} from "@/lib/store/slices/projectsSlice";

type DevelopmentApplicationBannerProps = {
  projectId: string;
};

/** The unanswered DA question shown above the compliance blocks. */
export function DevelopmentApplicationBanner({
  projectId,
}: DevelopmentApplicationBannerProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(
      complianceScope.application(
        ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
      ),
    ),
  );
  const [dismissed, setDismissed] = useState(false);
  const isSaving = mutation.status === "pending";

  if (dismissed) return null;

  const save = async (required: boolean) => {
    try {
      await dispatch(
        setDevelopmentApplicationRequired({ projectId, required }),
      ).unwrap();
      toast.success(
        required
          ? "Recorded — the Development Application process is now active."
          : "Recorded — this compliance file does not need a Development Application.",
      );
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not record that answer.",
      );
    }
  };

  return (
    <div className="relative rounded-xl border border-primary/40 bg-primary/5 px-4 py-3.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-7 text-muted-foreground"
        aria-label="Dismiss Development Application question"
        disabled={isSaving}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>

      <div className="flex items-start gap-3 pr-8">
        <FileStack
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Does this compliance flow need a Development Application (DA)?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Your answer changes the approval path for this project. Choosing Yes
            activates the DA checklist and raises the DA alert so the application
            can be collected and tracked here.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSaving}
              onClick={() => void save(true)}
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Yes — start the DA process
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSaving}
              onClick={() => void save(false)}
            >
              No — continue without a DA
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
