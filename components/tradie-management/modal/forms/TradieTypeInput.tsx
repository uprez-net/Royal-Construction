"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, HardHat, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { findTradeType, useTradeTypes } from "@/hooks/use-trade-types";
import { TradeIconGlyph } from "../../trade-icon";

interface TradeTypeComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired when the popover closes, mirroring the form's markTouched pattern. */
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}

export function TradeTypeCombobox({
  id = "tradie-trade",
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: TradeTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  // The list is Admin → Trade types. A load failure says so here rather than
  // showing an empty list that reads as "there are no trades".
  const { tradeTypes, status, error: loadError, reload } = useTradeTypes();
  const selected = findTradeType(tradeTypes, value);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) onBlur?.();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            error && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <TradeIconGlyph
              icon={selected?.icon}
              className="h-4 w-4 shrink-0"
            />
            {value || "Select trade type"}
          </span>
          <ChevronsUpDown
            className="ml-2 h-4 w-4 shrink-0 opacity-50"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput placeholder="Search trade type..." />
          <CommandList>
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
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading trades…
              </div>
            ) : (
              <CommandEmpty>
                No trade type found. An admin can add one under Admin → Trade
                types.
              </CommandEmpty>
            )}
            <CommandGroup>
              {tradeTypes.map((tradeType) => (
                <CommandItem
                  key={tradeType.id}
                  value={tradeType.label}
                  onSelect={() => {
                    onChange(tradeType.label);
                    setOpen(false);
                    onBlur?.();
                  }}
                >
                  <TradeIconGlyph
                    icon={tradeType.icon}
                    className="mr-2 h-4 w-4"
                  />
                  {tradeType.label}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === tradeType.label ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Drop-in replacement for the old Select-based field block, including the
 * Label/RequiredMark/error wrapper — paste this in place of the original
 * <div className="space-y-2"> ... trade type ... </div> in AddTradieModal.
 */
interface TradeTypeFieldProps extends TradeTypeComboboxProps {
  requiredMark: React.ReactNode;
}

export function TradeTypeField({
  requiredMark,
  ...comboboxProps
}: TradeTypeFieldProps) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor={comboboxProps.id ?? "tradie-trade"}
        className="flex items-center gap-2"
      >
        <HardHat className="h-4 w-4" aria-hidden="true" />
        Trade type
        {requiredMark}
      </Label>
      <TradeTypeCombobox {...comboboxProps} />
      {comboboxProps.error && (
        <p
          id={`${comboboxProps.id ?? "tradie-trade"}-error`}
          className="text-xs text-destructive"
        >
          {comboboxProps.error}
        </p>
      )}
    </div>
  );
}
