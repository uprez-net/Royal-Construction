"use client";

import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_INSURANCE_COVER_MONTHS,
  defaultInsuranceClaimEndDate,
} from "@/lib/projects/insurance-claim-dates";
import { cn } from "@/lib/utils";
import type { InsuranceClaimDatesInput } from "@/utils/validators";

export type InsuranceClaimDatesFormState = Partial<InsuranceClaimDatesInput>;

export type InsuranceClaimDatesFieldErrors = Partial<
  Record<keyof InsuranceClaimDatesInput, string>
>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-background px-3 font-mono text-sm tabular-nums";

const labelClassName = "text-xs font-medium text-foreground";

function startOfToday() {
  return new Date(new Date().setHours(0, 0, 0, 0));
}

/**
 * The next form state after the start date changes. The end follows the start
 * at the default cover length until somebody picks an end of their own, so
 * correcting a mistyped start does not leave a stale end behind it, and a
 * deliberately chosen end is never overwritten.
 */
export function withInsuranceClaimStartDate(
  current: InsuranceClaimDatesFormState,
  start: string | undefined,
): InsuranceClaimDatesFormState {
  const followsStart =
    !current.insuranceClaimEndDate
    || (current.insuranceClaimStartDate !== undefined
      && current.insuranceClaimEndDate
        === defaultInsuranceClaimEndDate(current.insuranceClaimStartDate));

  return {
    insuranceClaimStartDate: start,
    insuranceClaimEndDate:
      followsStart && start
        ? (defaultInsuranceClaimEndDate(start) ?? undefined)
        : current.insuranceClaimEndDate,
  };
}

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

function DateField({
  id,
  label,
  value,
  error,
  disabled,
  onSelect,
}: {
  id: string;
  label: string;
  value: string | undefined;
  error: string | undefined;
  disabled: (date: Date) => boolean;
  onSelect: (value: string | undefined) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={labelClassName}>
        {label}
        <RequiredMark />
      </Label>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              inputClassName,
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
            )}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          >
            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            {value ? format(parseISO(value), "PPP") : <span>Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? parseISO(value) : undefined}
            defaultMonth={value ? parseISO(value) : undefined}
            onSelect={(date) =>
              onSelect(date ? format(date, "yyyy-MM-dd") : undefined)
            }
            disabled={disabled}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The insurance cover window as two date pickers, with the end defaulting to
 * {@link DEFAULT_INSURANCE_COVER_MONTHS} months after the start.
 *
 * Shared by the Slab-start prompt and the HBCF certificate upload, so the two
 * places the window is entered cannot drift on how the default is worked out.
 */
export function InsuranceClaimDatesFields({
  idPrefix,
  value,
  errors,
  allowPastStart = false,
  onChange,
}: {
  idPrefix: string;
  value: InsuranceClaimDatesFormState;
  errors: InsuranceClaimDatesFieldErrors;
  /**
   * A certificate is issued before it is uploaded, so its cover start is
   * normally in the past. The Slab-start prompt keeps the old rule.
   */
  allowPastStart?: boolean;
  onChange: (
    next: InsuranceClaimDatesFormState,
    changed: keyof InsuranceClaimDatesInput,
  ) => void;
}) {
  const start = value.insuranceClaimStartDate;

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          id={`${idPrefix}-insuranceClaimStartDate`}
          label="Insurance claim start date"
          value={start}
          error={errors.insuranceClaimStartDate}
          disabled={(date) => !allowPastStart && date < startOfToday()}
          onSelect={(next) =>
            onChange(
              withInsuranceClaimStartDate(value, next),
              "insuranceClaimStartDate",
            )
          }
        />
        <DateField
          id={`${idPrefix}-insuranceClaimEndDate`}
          label="Insurance claim end date"
          value={value.insuranceClaimEndDate}
          error={errors.insuranceClaimEndDate}
          disabled={(date) =>
            start ? date <= parseISO(start) : date < startOfToday()
          }
          onSelect={(next) =>
            onChange(
              { ...value, insuranceClaimEndDate: next },
              "insuranceClaimEndDate",
            )
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The end date defaults to {DEFAULT_INSURANCE_COVER_MONTHS} months after
        the start. Change it if the certificate says otherwise.
      </p>
    </div>
  );
}
