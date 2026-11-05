"use client";

import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { FinancialActivity } from "@/lib/domain/projects/financial-report";

import { formatCents, Money } from "./money";

/** Dollars typed into the field, or null when it does not read as an amount. */
function parseDollars(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * An activity's Quoted price, with a pencil that turns it into a field.
 *
 * The field edits the activity's own price — ex GST, without its variations,
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

  function open() {
    setValue((activity.priceCents / 100).toFixed(2));
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
    const price = parseDollars(value);
    if (price === null) {
      setError("Enter an amount in dollars, to the cent.");
      return;
    }
    if (Math.round(price * 100) === activity.priceCents) {
      close();
      return;
    }
    setSaving(true);
    try {
      if (await onSave(activity, price)) close();
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
        <label htmlFor={fieldId} className="sr-only">
          Quoted price for {activity.name}, ex GST, excluding variations
        </label>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground" aria-hidden="true">
            $
          </span>
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
            aria-describedby={error ? errorId : undefined}
            className="h-8 w-32 text-right font-mono tabular-nums"
          />
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
              <Check className="size-4" aria-hidden="true" />
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
            <X className="size-4" aria-hidden="true" />
          </Button>
        </span>
        {error ? (
          <span id={errorId} className="text-xs text-destructive-ink">
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Ex GST, before variations
          </span>
        )}
      </form>
    );
  }

  return (
    <span className="flex flex-col items-end">
      <span className="flex items-center gap-1">
        <Money cents={activity.figures.tenderCents} />
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
