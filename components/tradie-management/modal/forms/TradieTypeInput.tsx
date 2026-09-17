"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, HardHat } from "lucide-react";
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
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";

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

  const selectedEntry = Object.entries(TRADIE_TYPES).find(
    ([, label]) => label === value,
  );
  const SelectedIcon = selectedEntry
    ? TRADIE_TYPE_ICONS[selectedEntry[0] as keyof typeof TRADIE_TYPES]
    : HardHat;

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
            <SelectedIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
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
            <CommandEmpty>No trade type found.</CommandEmpty>
            <CommandGroup>
              {Object.entries(TRADIE_TYPES).map(([key, label]) => {
                const Icon =
                  TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES];
                return (
                  <CommandItem
                    key={key}
                    value={label}
                    onSelect={() => {
                      onChange(label);
                      setOpen(false);
                      onBlur?.();
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                    {label}
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        value === label ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  </CommandItem>
                );
              })}
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
