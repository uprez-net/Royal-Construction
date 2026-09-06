"use client";

// Field primitives shared by the Job setup and Cost schedule panels. CountField
// was defined twice, once in each, differing only in whether it exposed `step`.

import { Input } from "@/components/ui/input";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { numberInputValue } from "./offer-workspace-format";

// A room/item count. Shares AreaField's parse rule so a negative is rejected
// rather than stored — parseFloat("-1") is truthy, and -1 used to reach contract
// text — and shows the placeholder at 0 instead of a literal "0" that the caret
// then collides with (typing 4 into a resident 0 gave 40).
//
// `step` is "1" for whole counts and "0.5" for bathrooms: a powder room is half
// a bathroom, printed as entered.
export function CountField({
  onChange,
  step = "1",
  value,
}: {
  readonly onChange: (value: number) => void;
  readonly step?: "1" | "0.5";
  readonly value: number;
}) {
  return (
    <Input
      min="0"
      step={step}
      type="number"
      placeholder="Auto-filled from lead requirements"
      value={numberInputValue(value)}
      onChange={(event) => {
        const parsedValue = parseNonNegativeNumberInput(event.target.value);
        if (parsedValue !== null) {
          onChange(parsedValue);
        }
      }}
    />
  );
}
