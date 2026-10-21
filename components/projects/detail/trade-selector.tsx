"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown, Layers } from "lucide-react";

import { TradeIcon } from "@/components/tradie-management/trade-icon";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

const ALL_TRADES = "All trades";

/**
 * The trade the Tradies tab is looking at: a searchable list of the project's
 * trades, with "All trades" first. `null` is "All trades".
 */
export function TradeSelector({
  trades,
  value,
  onChange,
}: {
  trades: readonly string[];
  value: string | null;
  onChange: (trade: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `${useId()}-trades`;

  const choose = (next: string | null) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Trade category"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className="h-9 w-full justify-between gap-2 sm:w-72"
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? (
              <TradeIcon trade={value} className="size-4 shrink-0" />
            ) : (
              <Layers className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{value ?? ALL_TRADES}</span>
          </span>
          <ChevronsUpDown
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <Command>
          <CommandInput
            placeholder="Search trades…"
            aria-label="Search trades"
          />
          <CommandList id={listId} aria-label="Trades">
            <CommandEmpty>No trades found.</CommandEmpty>
            <CommandGroup>
              {[null, ...trades].map((option) => (
                <CommandItem
                  key={option ?? "all"}
                  value={option ?? ALL_TRADES}
                  onSelect={() => choose(option)}
                >
                  {option ? (
                    <TradeIcon trade={option} className="size-4" />
                  ) : (
                    <Layers className="size-4" aria-hidden="true" />
                  )}
                  <span className="truncate">{option ?? ALL_TRADES}</span>
                  <Check
                    className={cn(
                      "ml-auto size-4",
                      option === value ? "opacity-100" : "opacity-0",
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
