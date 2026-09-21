"use client";

import { Check, ChevronsUpDown, Loader2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { fetchJson } from "@/utils/fetch";

/**
 * One address a party can be written to.
 *
 * The tradie row and its `additionalEmails` are flattened into separate
 * options rather than offered as a row plus a dropdown of addresses. A firm's
 * job inbox is routinely not the address on their directory row, and the
 * question being answered here is "which desk should this land on" — one list
 * of answers is the honest shape of that.
 */
export type ContactOption = {
  tradieId: string;
  name: string;
  email: string;
  phone: string | null;
  /** Set when this is one of the tradie's additional addresses. */
  isAlternate: boolean;
};

type LookupRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  trade: string;
  additionalEmails: string[];
};

/**
 * Picks a firm from the tradie directory, narrowed to one trade.
 *
 * Replaces the three free-text fields the certifier modal used to collect. The
 * addresses these threads run on are the one thing that cannot be got wrong —
 * every later reply is correlated back through them, and a typo is not
 * discovered until a document that was supposed to arrive never does. The
 * directory already holds them, checked, so there is no reason to retype one.
 *
 * Fetched on open rather than held in the store: it is a short list read once
 * per engagement, and the directory is edited from a different screen entirely.
 */
export function ContactPicker({
  trade,
  label,
  value,
  onChange,
  disabled,
}: {
  /** The trade label to filter on — "Surveying", "Certifier". */
  trade: string;
  /** What the empty state calls this kind of firm. */
  label: string;
  value: ContactOption | null;
  onChange: (option: ContactOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Keyed by the trade it was fetched for, so a changed `trade` reads as
  // loading without the effect having to reset it first — clearing state
  // synchronously inside the effect is what cascades a render.
  const [result, setResult] = useState<{
    trade: string;
    rows: LookupRow[];
    error: string | null;
  } | null>(null);
  const rows = result?.trade === trade ? result.rows : null;
  const error = result?.trade === trade ? result.error : null;

  useEffect(() => {
    let cancelled = false;

    fetchJson<LookupRow[]>(
      `/api/tradies?trade=${encodeURIComponent(trade)}&limit=100`,
      { method: "GET" },
      `Could not load the ${label.toLowerCase()} list`,
    )
      .then((response) => {
        if (!cancelled) {
          setResult({ trade, rows: response.data, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          trade,
          rows: [],
          error:
            cause instanceof Error
              ? cause.message
              : `Could not load the ${label.toLowerCase()} list.`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [trade, label]);

  const options = useMemo<ContactOption[]>(
    () =>
      (rows ?? []).flatMap((row) => [
        {
          tradieId: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          isAlternate: false,
        },
        ...row.additionalEmails.map((email) => ({
          tradieId: row.id,
          name: row.name,
          email,
          phone: row.phone,
          isAlternate: true,
        })),
      ]),
    [rows],
  );

  const isLoading = rows === null;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || isLoading}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {isLoading ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <UserRound className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">
                {value
                  ? `${value.name}`
                  : isLoading
                    ? "Loading…"
                    : `Select ${label.toLowerCase()}`}
              </span>
            </span>
            <ChevronsUpDown
              className="ml-2 size-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} />
            <CommandList>
              <CommandEmpty>
                {/* Two different problems, and telling them apart is the whole
                    value of the message: an empty directory is fixed on the
                    Tradies screen, a filtered-out search by typing less. */}
                {options.length === 0
                  ? `No ${label.toLowerCase()} in the directory yet. Add one under Tradies first.`
                  : `No ${label.toLowerCase()} found.`}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={`${option.tradieId}:${option.email}`}
                    value={`${option.name} ${option.email}`}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.email}
                        {option.isAlternate ? " · alternate" : ""}
                      </span>
                    </span>
                    <Check
                      className={cn(
                        "ml-2 size-4 shrink-0",
                        value?.email === option.email &&
                          value?.tradieId === option.tradieId
                          ? "opacity-100"
                          : "opacity-0",
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

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
