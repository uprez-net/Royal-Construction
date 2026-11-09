"use client";

import { useId } from "react";
import type { LucideIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";

export type FilterOption = {
  value: string;
  label: string;
  /** How many rows carry it, shown beside the label. */
  count?: number;
  /** Shown before the label, in the list and in the closed dropdown. */
  icon?: LucideIcon;
  /** The icon's colour. */
  iconClassName?: string;
};

function OptionIcon({
  icon: Icon,
  className,
}: {
  icon?: LucideIcon;
  className?: string;
}) {
  return Icon ? (
    <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
  ) : null;
}

/**
 * A labelled filter dropdown with an "All" choice. An empty string is "All",
 * which is what a missing search parameter reads as.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
  disabled,
  hideLabel,
  icon,
}: {
  label: string;
  /** The filter's own icon, on the "All" choice and on options without one. */
  icon?: LucideIcon;
  /** Keep the label for screen readers only, for a compact toolbar. */
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
  allLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  // A value from an old link that no longer matches any row still shows, so
  // the dropdown never claims "All" while it is filtering.
  const known = !value || options.some((option) => option.value === value);

  return (
    <div className={cn("min-w-0", !hideLabel && "space-y-1.5", className)}>
      <label
        htmlFor={id}
        className={cn(
          "block text-xs font-medium text-muted-foreground",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>
      <Select
        value={value || ALL}
        onValueChange={(next) => onChange(next === ALL ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={cn("h-9 w-full", value ? "border-primary/50" : null)}
        >
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL}>
            <OptionIcon icon={icon} className="text-muted-foreground" />
            {allLabel}
          </SelectItem>
          {known ? null : (
            <SelectItem value={value}>
              <OptionIcon icon={icon} className="text-muted-foreground" />
              {value}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <OptionIcon
                icon={option.icon ?? icon}
                className={option.iconClassName ?? "text-muted-foreground"}
              />
              <span className="truncate">{option.label}</span>
              {option.count !== undefined ? (
                <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground tabular-nums">
                  {option.count}
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
