"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, HardHat, Loader2, Star, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { findTradeType, useTradeTypes } from "@/hooks/use-trade-types";
import { sameTrade } from "@/lib/domain/tradies/request-rules";
import { TradeIconGlyph } from "../../trade-icon";

// A tradie's categories. One tradie can work in several trades — a plumber
// who is also a licensed gasfitter is offered for both — so this picks a list.
// The first is the primary: the trade the tradie is shown under where only
// one fits, and the one Eve names them by.

interface TradeTypeMultiComboboxProps {
  id?: string;
  /** Labels, the primary first. */
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Fired when the popover closes, mirroring the form's markTouched pattern. */
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
}

export function TradeTypeMultiCombobox({
  id = "tradie-trades",
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: TradeTypeMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  // The list is Admin → Trade types. A load failure says so here rather than
  // showing an empty list that reads as "there are no trades".
  const { tradeTypes, status, error: loadError, reload } = useTradeTypes();

  const isSelected = (label: string) =>
    value.some((selected) => sameTrade(selected, label));
  const toggle = (label: string) =>
    onChange(
      isSelected(label)
        ? value.filter((selected) => !sameTrade(selected, label))
        : [...value, label],
    );
  const makePrimary = (label: string) =>
    onChange([
      label,
      ...value.filter((selected) => !sameTrade(selected, label)),
    ]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) onBlur?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={handleOpenChange} modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? `${id}-options` : undefined}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              value.length === 0 && "text-muted-foreground",
              error && "border-destructive focus-visible:ring-destructive",
            )}
          >
            <span className="truncate">
              {value.length === 0
                ? "Select trade types"
                : value.length === 1
                  ? value[0]
                  : `${value[0]} + ${value.length - 1} more`}
            </span>
            <ChevronsUpDown
              className="ml-2 h-4 w-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Search trade types"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput
              placeholder="Search trade type..."
              aria-label="Search trade types"
            />
            <CommandList
              id={`${id}-options`}
              aria-multiselectable="true"
              aria-label="Trade types"
            >
              {status === "error" ? (
                <div className="space-y-2 px-3 py-4 text-sm" role="alert">
                  <p className="text-destructive">{loadError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void reload()}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
              {tradeTypes.length === 0
              && (status === "idle" || status === "loading") ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Loading trades…
                </div>
              ) : (
                <CommandEmpty>
                  No trade type found. An admin can add one under Admin → Trade
                  types.
                </CommandEmpty>
              )}
              <CommandGroup>
                {tradeTypes.map((tradeType) => {
                  const checked = isSelected(tradeType.label);
                  return (
                    <CommandItem
                      key={tradeType.id}
                      value={tradeType.label}
                      data-checked={checked}
                      aria-selected={checked}
                      // Stays open: picking several is the point.
                      onSelect={() => toggle(tradeType.label)}
                    >
                      <TradeIconGlyph
                        icon={tradeType.icon}
                        className="mr-2 h-4 w-4"
                      />
                      {tradeType.label}
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {checked ? "Selected" : "Not selected"}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected trade types">
          {value.map((label, index) => {
            const primary = index === 0;
            const icon = findTradeType(tradeTypes, label)?.icon;
            return (
              <li key={label}>
                <Badge
                  variant={primary ? "default" : "secondary"}
                  className="gap-1.5"
                >
                  <TradeIconGlyph icon={icon} className="h-3 w-3" />
                  {label}
                  {primary ? (
                    <span className="text-[10px] font-normal opacity-80">
                      Primary
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`Make ${label} the primary trade`}
                      title="Make primary"
                      onClick={() => makePrimary(label)}
                    >
                      <Star className="size-3" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Remove ${label}`}
                    onClick={() => toggle(label)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** The labelled field, with the form's required mark and error line. */
interface TradeTypesFieldProps extends TradeTypeMultiComboboxProps {
  requiredMark?: React.ReactNode;
}

export function TradeTypesField({
  requiredMark,
  ...comboboxProps
}: TradeTypesFieldProps) {
  const id = comboboxProps.id ?? "tradie-trades";
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        <HardHat className="h-4 w-4" aria-hidden="true" />
        Trade types
        {requiredMark}
      </Label>
      <TradeTypeMultiCombobox {...comboboxProps} id={id} />
      {comboboxProps.error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {comboboxProps.error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick every trade they work in. The first is their primary trade.
        </p>
      )}
    </div>
  );
}
