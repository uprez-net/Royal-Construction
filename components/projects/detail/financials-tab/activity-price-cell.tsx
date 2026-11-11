"use client";

import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { FinancialActivity } from "@/lib/domain/projects/financial-report";
import { calculateOfferLinePricing } from "@/lib/offer/pricing";
import { GST_RATE } from "@/lib/domain/projects/variation-rules";

import { formatCents, MoneyWithGst } from "./money";

/** Dollars typed into the field, or null when it does not read as an amount. */
function parseDollars(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * An activity's Quoted price, with a pencil that turns it into a field.
 *
 * The field edits the activity's own price including GST, without its variations,
 * which are priced on their own and keep being added on top. Enter saves,
 * Escape puts the figure back. The row's figures come back from the server
 * whole, so the cell shows the saved number, never the one typed.
 */
export function ActivityPriceCell({
  activity,
  onSave,
}: {
  activity: FinancialActivity;
  /** Resolves true once saved; false leaves the field open to correct. */
  onSave: (activity: FinancialActivity, price: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // Set when the editor closes, so focus goes back to this row's pencil
  // rather than to the page once the field it was in is gone.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editButton.current?.focus();
  }, [editing]);

  const fieldId = `activity-price-${activity.id}`;
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
    const current = calculateOfferLinePricing({
      gstIncluded: false,
      gstRate: GST_RATE,
      quantity: 1,
      unitPrice: activity.priceCents / 100,
    });
    setValue(current.totalPrice.toFixed(2));
    setError(null);
    setEditing(true);
  }

  function close() {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (pricing === null) {
      setError("Enter an amount in dollars, to the cent.");
      return;
    }
    if (Math.round(pricing.netLine * 100) === activity.priceCents) {
      close();
      return;
    }
    setSaving(true);
    try {
      // The existing command stores ex GST; only the editor accepts a total.
      if (await onSave(activity, pricing.netLine)) close();
    } finally {
      setSaving(false);
    }
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
              Quoted price for {activity.name}, inc GST, excluding variations
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
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={saving}
                aria-label={`Save the quoted price for ${activity.name}`}
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
              <span>Inc GST, before variations</span>
              {pricing ? (
                <>
                  <span>
                    {formatCents(Math.round(pricing.netLine * 100))} ex GST
                  </span>
                  <span>
                    {formatCents(Math.round(pricing.gstAmount * 100))} GST
                  </span>
                </>
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
          cents={activity.figures.tenderCents}
          gstCents={activity.figures.tenderGstCents}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          ref={editButton}
          onClick={open}
          aria-label={`Edit the quoted price for ${activity.name}`}
          title="Edit quoted price"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </span>
      {activity.variationCents > 0 ? (
        <span className="text-xs text-muted-foreground">
          incl.{" "}
          <span className="font-mono tabular-nums">
            +{formatCents(activity.variationCents)}
          </span>{" "}
          variations
        </span>
      ) : null}
    </span>
  );
}
