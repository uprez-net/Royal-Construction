"use client";

import { useId } from "react";

/** Native phone picker keeps every filter reachable without a strip of chips. */
export function MobileFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 md:hidden">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 pr-8 text-base font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.count === undefined ? "" : ` (${option.count})`}
          </option>
        ))}
      </select>
    </div>
  );
}
