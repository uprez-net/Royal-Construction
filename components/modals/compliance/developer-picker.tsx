"use client";

import { Check, ChevronsUpDown, Landmark } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { developersForArea } from "@/constants/complianceDevelopers";
import { cn } from "@/lib/utils";

/**
 * The estate developer this approval is being sought from.
 *
 * `key` is what the outreach stores; the rest is the snapshot it copies. The
 * address is part of the selection rather than a property of it, because the
 * list holds one for some estates and not others — see
 * `AreaDeveloper.contactEmail`, which explains why a blank is deliberate and a
 * guess would be worse.
 */
export type DeveloperOption = {
  key: string;
  name: string;
  estate: string;
  email: string;
  phone: string | null;
};

/**
 * Picks the estate from the list in the codebase, then confirms the address.
 *
 * Two controls rather than one, and that is the shape of the problem rather
 * than a compromise. Which estate a lot sits in is a fact somebody in the
 * office knows and the software does not; where that estate's approvals go is a
 * fact on the covenant paperwork, which we hold for some estates and not for
 * others. A single picker would have to either refuse the estates with no
 * address on file — which is most of them, and would block the job — or send to
 * a blank, which is worse than blocking it.
 *
 * So the estate is chosen from the list, the address it knows about is
 * prefilled, and the address is always editable and always required. Filling
 * one in permanently is a change to constants/complianceDevelopers.ts, which is
 * how the next person on that estate is saved the typing.
 *
 * Read straight out of the constant rather than fetched. There is no request to
 * make: the list is a module, and a spinner over a dozen rows that were already
 * in the bundle is a worse experience than no spinner at all.
 */
export function DeveloperPicker({
  council,
  location,
  value,
  onChange,
  disabled = false,
}: {
  council?: string | null;
  location?: string | null;
  value: DeveloperOption | null;
  onChange: (next: DeveloperOption | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Ordered, never filtered. Every way of recognising an estate off a project
  // row is wrong often enough to hide the only right answer — see
  // `developersForArea` — so the likely ones are simply first and labelled.
  const options = useMemo(
    () => developersForArea({ council, location }),
    [council, location],
  );

  const hasSuggestions = options.some((option) => option.suggested);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="min-w-0 truncate">
                {value.estate}
                <span className="text-muted-foreground"> · {value.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Pick the estate this lot is in
              </span>
            )}
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search estates and developers…" />
            <CommandList>
              <CommandEmpty>No estate by that name.</CommandEmpty>
              <CommandGroup>
                {options.map(({ developer, suggested }) => (
                  <CommandItem
                    key={developer.key}
                    // Both, so typing either the estate or the developer finds
                    // the row. Somebody who knows this job says "Willowdale";
                    // somebody who administers approvals says "Stockland".
                    value={`${developer.estate} ${developer.name}`}
                    onSelect={() => {
                      onChange({
                        key: developer.key,
                        name: developer.name,
                        estate: developer.estate,
                        email: developer.contactEmail ?? "",
                        phone: developer.contactPhone ?? null,
                      });
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        value?.key === developer.key
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{developer.estate}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {developer.name}
                        {developer.contactEmail
                          ? ` · ${developer.contactEmail}`
                          : " · no address on file"}
                      </span>
                    </span>
                    {/* Labelled rather than sorted silently. A reader who
                        cannot see why one estate is at the top has no way to
                        tell a good guess from an alphabetical accident. */}
                    {suggested ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <Landmark className="size-3" aria-hidden="true" />
                        this area
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {!hasSuggestions && !value ? (
        <p className="text-xs text-muted-foreground">
          Nothing in the list matches this council or address — pick the estate
          from the contract of sale.
        </p>
      ) : null}

      {value ? (
        <div className="space-y-1.5">
          <Label htmlFor="developer-approval-email">
            Where the approval request goes
          </Label>
          <Input
            id="developer-approval-email"
            type="email"
            required
            value={value.email}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, email: event.target.value })
            }
            placeholder="approvals@example.com"
          />
          <p className="text-xs text-muted-foreground">
            {value.email
              ? "From the estate list. Correct it here if this release uses a different desk."
              : "No address on file for this estate — it is on the covenant paperwork."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
