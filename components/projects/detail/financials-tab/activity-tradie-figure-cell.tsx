"use client";

import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { FinancialActivity } from "@/lib/domain/projects/financial-report";
import type { TradieFigure } from "@/lib/domain/projects/milestone-tradie-figures";
import { calculateOfferLinePricing } from "@/lib/offer/pricing";
import { GST_RATE } from "@/lib/domain/projects/variation-rules";

import { parseDollars } from "./activity-price-cell";
import { formatCents, MoneyWithGst } from "./money";

const LABEL: Record<TradieFigure, string> = {
  invoiced: "total invoiced",
  quoted: "tradie quoted",
};

const SOURCE: Record<TradieFigure, string> = {
  invoiced: "invoices",
  quoted: "bookings",
};

/** The figure as the row shows it: ex GST, with its GST, sub-activities in. */
function shown(activity: FinancialActivity, figure: TradieFigure) {
  const { figures, own } = activity;
  return figure === "quoted"
    ? {
        cents: figures.quotedCents,
        gstCents: figures.quotedGstCents,
        childrenCents: figures.quotedCents - own.quotedCents,
        override: activity.quotedOverrideCents,
      }
    : {
        cents: figures.invoicedCents,
        gstCents: figures.invoicedGstCents,
        childrenCents: figures.invoicedCents - own.invoicedCents,
        override: activity.invoicedOverrideCents,
      };
}

/**
 * An activity's Tradie quoted or Total invoiced figure, with a pencil that
 * turns it into a field, like the Quoted price beside it.
 *
 * The field takes the row's figure including GST. A parent's row includes its
 * sub-activities, so what is saved is the activity's own share: the total
 * typed less what the sub-activities add. "Use bookings" clears the typed
 * figure and the row goes back to what its bookings or invoices add up to.
 */
export function ActivityTradieFigureCell({
  activity,
  figure,
  onSave,
}: {
  activity: FinancialActivity;
  figure: TradieFigure;
  /** Resolves true once saved; false leaves the field open to correct. */
  onSave: (
    activity: FinancialActivity,
    figure: TradieFigure,
    ownCents: number | null,
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editButton.current?.focus();
  }, [editing]);

  const current = shown(activity, figure);
  const label = LABEL[figure];
  const fieldId = `activity-${figure}-${activity.id}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const total = parseDollars(value);
  const pricing =
    total === null
      ? null
      : calculateOfferLinePricing({
          gstIncluded: true,
          gstRate: GST_RATE,
          quantity: 1,
          unitPrice: total,
        });

  function open() {
    const start = calculateOfferLinePricing({
      gstIncluded: false,
      gstRate: GST_RATE,
      quantity: 1,
      unitPrice: current.cents / 100,
    });
    setValue(start.totalPrice.toFixed(2));
    setError(null);
    setEditing(true);
  }

  function close() {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  }

  async function save(ownCents: number | null) {
    setSaving(true);
    try {
      if (await onSave(activity, figure, ownCents)) close();
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (pricing === null) {
      setError("Enter an amount in dollars, to the cent.");
      return;
    }
    const exGstCents = Math.round(pricing.netLine * 100);
    if (exGstCents === current.cents) {
      close();
      return;
    }
    const ownCents = exGstCents - current.childrenCents;
    if (ownCents < 0) {
      setError(
        `Its sub-activities already add up to ${formatCents(current.childrenCents)} ex GST.`,
      );
      return;
    }
    await save(ownCents);
  }

  if (editing) {
    return (
      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col items-end gap-1"
      >
        <FieldGroup>
          <Field data-invalid={error ? true : undefined} data-disabled={saving}>
            <FieldLabel htmlFor={fieldId} className="sr-only">
              {label} for {activity.name}, inc GST
            </FieldLabel>
            <Input
              id={fieldId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              className="h-8 text-right font-mono tabular-nums"
            />
            <span className="flex items-center justify-end gap-1">
              {current.override !== null ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => void save(null)}
                  disabled={saving}
                  aria-label={`Use the ${SOURCE[figure]}' figure for ${activity.name}`}
                  title={`Use the ${SOURCE[figure]}' figure`}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={saving}
                aria-label={`Save the ${label} figure for ${activity.name}`}
              >
                {saving ? (
                  <Spinner className="size-4" />
                ) : (
                  <Check aria-hidden="true" />
                )}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={close}
                disabled={saving}
                aria-label="Cancel"
              >
                <X aria-hidden="true" />
              </Button>
            </span>
            <span
              id={hintId}
              className="flex flex-col items-end text-xs text-muted-foreground"
              aria-live="polite"
            >
              <span>Inc GST</span>
              {pricing ? (
                <span>
                  {formatCents(Math.round(pricing.netLine * 100))} ex GST
                </span>
              ) : null}
              {current.childrenCents > 0 ? (
                <span>
                  incl. {formatCents(current.childrenCents)} sub-activities
                </span>
              ) : null}
            </span>
            {error ? (
              <span id={errorId} className="text-xs text-destructive-ink">
                {error}
              </span>
            ) : null}
          </Field>
        </FieldGroup>
      </form>
    );
  }

  return (
    <span className="flex flex-col items-end">
      <span className="flex items-center gap-1">
        <MoneyWithGst
          cents={current.cents}
          gstCents={current.gstCents}
          muted={current.cents === 0}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          ref={editButton}
          onClick={open}
          aria-label={`Edit the ${label} figure for ${activity.name}`}
          title={`Edit ${label}`}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </span>
      {current.override !== null ? (
        <span className="text-xs text-muted-foreground">Entered by hand</span>
      ) : null}
    </span>
  );
}
