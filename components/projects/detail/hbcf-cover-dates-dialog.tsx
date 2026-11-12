"use client";

import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { format, parse } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InsuranceClaimDatesFields,
  withInsuranceClaimStartDate,
  type InsuranceClaimDatesFieldErrors,
  type InsuranceClaimDatesFormState,
} from "@/components/projects/detail/insurance-claim-dates-fields";
import {
  insuranceClaimDatesSchema,
  type InsuranceClaimDatesInput,
} from "@/utils/validators";

/**
 * Asks the office to confirm the cover window right after an HBCF certificate
 * is uploaded, prefilled with the start date read off it and the default end.
 *
 * A confirm rather than a silent write: the dates decide when the project
 * starts counting against the HBCF capacity, and a misread day-month swap on a
 * scanned certificate would move that by months without anybody noticing.
 * Skipping leaves both dates blank, editable later on the Overview tab.
 */
export function HbcfCoverDatesDialog({
  open,
  suggestedStartDate,
  conflictingDates = [],
  onConfirm,
  onSkip,
}: {
  open: boolean;
  /** `yyyy-MM-dd` read off the certificate, or null when none was found. */
  suggestedStartDate: string | null;
  /**
   * Different cover start dates printed on the documents just uploaded. When
   * there is more than one, no date is suggested: the office picks the claim
   * date, because choosing one of them here would be a guess.
   */
  conflictingDates?: readonly string[];
  /** Resolves once saved; rejects to keep the dialog open. */
  onConfirm: (dates: InsuranceClaimDatesInput) => Promise<void>;
  onSkip: () => void;
}) {
  const [formState, setFormState] = useState<InsuranceClaimDatesFormState>(() =>
    withInsuranceClaimStartDate({}, suggestedStartDate ?? undefined),
  );
  const [fieldErrors, setFieldErrors] =
    useState<InsuranceClaimDatesFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async () => {
    setSubmitError(null);
    const validated = insuranceClaimDatesSchema.safeParse(formState);
    if (!validated.success) {
      const errors: InsuranceClaimDatesFieldErrors = {};
      for (const issue of validated.error.issues) {
        const field = issue.path[0] as keyof InsuranceClaimDatesInput;
        if (field && !errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      await onConfirm(validated.data);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Unable to save the insurance cover dates",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onSkip();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-card p-0 shadow-lg sm:max-w-156">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            HBCF cover dates
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {conflictingDates.length > 1
              ? "The documents show different cover start dates. Enter the project's HBCF claim date."
              : suggestedStartDate
                ? "The start date was read from the certificate. Check it against the document before saving."
                : "No cover start date could be read from the certificate. Enter it from the document."}{" "}
            The project start date follows the claim start date.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5 px-6 pb-6 pt-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (isPending) return;
            startTransition(async () => await handleSubmit());
          }}
        >
          {conflictingDates.length > 1 ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-warning/40 bg-warning-light px-3.5 py-3 text-sm text-warning-ink"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>
                Dates on the documents:{" "}
                {conflictingDates
                  .map((date) =>
                    format(parse(date, "yyyy-MM-dd", new Date()), "d MMM yyyy"),
                  )
                  .join(", ")}
                .
              </p>
            </div>
          ) : null}

          {submitError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-destructive/40 bg-destructive-light px-3.5 py-3 text-sm text-destructive-ink"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{submitError}</p>
            </div>
          ) : null}

          <InsuranceClaimDatesFields
            idPrefix="hbcf-upload"
            value={formState}
            errors={fieldErrors}
            allowPastStart
            onChange={(next, changed) => {
              setFormState(next);
              setFieldErrors((prev) => {
                if (!prev[changed]) return prev;
                const rest = { ...prev };
                delete rest[changed];
                return rest;
              });
            }}
          />

          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onSkip}
              className="h-10 rounded-[10px] px-4 text-sm font-medium"
            >
              Not now
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              className="h-10 rounded-[10px] px-4 text-sm font-medium"
            >
              {isPending ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              {isPending ? "Saving…" : "Save dates"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
