"use client";

import { Fragment, useId, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";

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

import { AddressSuggestion } from "@/types/data";
import { Role } from "@prisma/client";

export interface LookupOption {
  id: string;
  name: string;
  location?: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: string;
  tradeType?: string;
  description?: string;
}

type SearchableItem = LookupOption | AddressSuggestion;

function isLookupOption(item: SearchableItem): item is LookupOption {
  return "name" in item;
}

function roleLabelConverter(role: Role | undefined): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "SITE_MANAGER":
      return "Site Manager";
    case "GUEST":
      return "Guest";
    case "CUSTOMER":
      return "Customer";
    default:
      return role ?? "";
  }
}

export function SearchableSelect({
  id,
  label,
  labelledById,
  "aria-label": ariaLabel,
  placeholder,
  searchValue,
  selectedItem,
  items,
  loading,
  hasMore,
  onQueryChange,
  onSelect,
  onLoadMore,
  onClear,
  disabled,
}: {
  /** Id applied to the trigger button, so a caller can reference it. */
  id?: string;
  /** Visible label rendered above the trigger. Pass "" to supply your own. */
  label: string;
  /** Id of a label element rendered by the caller, for `label=""` usage. */
  labelledById?: string;
  /** Last-resort accessible name when there is no visible label element. */
  "aria-label"?: string;
  placeholder: string;
  searchValue: string;
  selectedItem: SearchableItem | null;
  items: SearchableItem[];
  loading?: boolean;
  hasMore?: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (item: SearchableItem) => void;
  onLoadMore?: () => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const triggerId = id ?? `${reactId}-trigger`;
  const ownLabelId = `${reactId}-label`;
  const valueId = `${reactId}-value`;
  const fallbackLabelId = `${reactId}-fallback-label`;

  const hasOwnLabel = label.trim().length > 0;
  const hasAriaLabel = Boolean(ariaLabel?.trim());
  // A <button> is not a labelable element, so `<label for>` cannot name the
  // Popover trigger — the label has to be referenced with aria-labelledby.
  // The value span is referenced too (rather than the whole trigger) so the
  // selection stays part of the name — "Tradie location, 12 Smith St" — without
  // pulling in the clear control's own label.
  //
  // With no visible label, no `labelledById` and no `aria-label`, the trigger
  // would fall back to its own content: the selected value, or the placeholder,
  // which says what is chosen but never what it chooses. A hidden generic label
  // keeps the "<name> <value>" shape rather than leaving the control unnamed.
  const nameSource =
    labelledById
    ?? (hasOwnLabel ? ownLabelId : hasAriaLabel ? undefined : fallbackLabelId);
  const usesFallbackLabel = nameSource === fallbackLabelId;
  const triggerLabelledBy = nameSource ? `${nameSource} ${valueId}` : undefined;
  const canClear = Boolean(selectedItem && onClear);
  const clearHintId = `${reactId}-clear-hint`;

  const triggerLabel = selectedItem
    ? isLookupOption(selectedItem)
      ? selectedItem.name
      : selectedItem.label
    : placeholder;

  const searchNoun = (label.trim() || ariaLabel?.trim() || "").toLowerCase();

  return (
    <div className="space-y-2">
      {/* Named via aria-labelledby on the trigger, not `for` — see above.
          Rendered only when there is text: callers passing label="" supply
          their own visible label, and an empty <label> inside `space-y-2`
          added a phantom row of vertical spacing plus an empty node in the
          accessibility tree. `nameSource` already falls back to
          `labelledById` when this is absent. */}
      {hasOwnLabel ? (
        <label id={ownLabelId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}

      {/* Last-resort name for a caller that supplies neither a label nor an
          `aria-label`. sr-only, so it adds no visible row of its own. */}
      {usesFallbackLabel ? (
        <span id={fallbackLabelId} className="sr-only">
          Select an option
        </span>
      ) : null}

      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={triggerId}
            variant="outline"
            className="w-full justify-between gap-3"
            disabled={disabled}
            aria-label={triggerLabelledBy ? undefined : ariaLabel}
            aria-labelledby={triggerLabelledBy}
            aria-describedby={canClear ? clearHintId : undefined}
            // Keyboard path for clearing. The visible X is a plain click target
            // rather than a focusable control, because a focusable one would be
            // an interactive element nested inside this button (invalid ARIA).
            // Backspace/Delete gives keyboard users parity without the nesting.
            onKeyDown={(event) => {
              if (!canClear) return;
              if (event.key !== "Backspace" && event.key !== "Delete") return;
              event.preventDefault();
              onClear?.();
            }}
          >
            <span id={valueId} className="truncate text-left">
              {triggerLabel}
            </span>

            <div className="flex items-center gap-1">
              {canClear ? (
                <span
                  aria-hidden="true"
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear?.();
                  }}
                >
                  <X className="size-4" />
                </span>
              ) : null}

              {loading ? (
                <Loader2
                  className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
          aria-label={searchNoun ? `Select ${searchNoun}` : "Select an option"}
        >
          <Command
            shouldFilter={false}
            label={searchNoun ? `Search ${searchNoun}` : "Search"}
          >
            <CommandInput
              placeholder={searchNoun ? `Search ${searchNoun}...` : "Search..."}
              value={searchValue}
              onValueChange={onQueryChange}
            />

            {/* cmdk's empty state is role="presentation" and nothing else is
                live, so results that arrive asynchronously were silent. Always
                mounted so a change is announced, but empty until there is
                something true to say: an open picker with nothing typed and
                nothing listed has not searched, so "No results found" would
                report a search nobody made. Callers that fetch as the person
                types must pass `loading`, or "No results found" is spoken
                while the request is still in flight. */}
            <p role="status" className="sr-only">
              {loading
                ? "Loading"
                : items.length > 0
                  ? `${items.length} result${items.length === 1 ? "" : "s"}${hasMore ? ", more available" : ""}`
                  : searchValue.trim()
                    ? "No results found"
                    : ""}
            </p>

            <CommandList>
              <CommandGroup>
                {items.map((item) => {
                  const title = isLookupOption(item) ? item.name : item.label;

                  const subtitleParts = isLookupOption(item)
                    ? (item.description
                      ?? [
                        item.email ? `Email: ${item.email}\n` : null,
                        item.phone ? `Phone: ${item.phone}\n` : null,
                        item.role
                          ? `Role: ${roleLabelConverter(item.role as Role)}\n`
                          : null,
                        item.company ? `Company: ${item.company}\n` : null,
                        item.tradeType ? `Trade: ${item.tradeType}\n` : null,
                        item.location ? `Location: ${item.location}\n` : null,
                      ].filter((value): value is string =>
                        Boolean(value?.trim()),
                      ))
                    : [
                        item.address,
                        item.postcode,
                        item.council ? `Council: ${item.council}` : null,
                      ].filter((value): value is string =>
                        Boolean(value?.trim()),
                      );

                  return (
                    <CommandItem
                      key={item.id}
                      value={title}
                      checked={selectedItem?.id === item.id}
                      onSelect={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                    >
                      <div className="flex w-full flex-col gap-0.5 text-left">
                        <span className="font-medium text-foreground">
                          {title}
                        </span>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {Array.isArray(subtitleParts)
                          && subtitleParts.length > 0 ? (
                            subtitleParts.map((part, index) => (
                              <Fragment key={part}>
                                {index > 0 && (
                                  <span className="text-muted-foreground/40">
                                    •
                                  </span>
                                )}

                                <span className="wrap-break-word">{part}</span>
                              </Fragment>
                            ))
                          ) : (
                            <span>
                              {" "}
                              {typeof subtitleParts === "string"
                                ? subtitleParts
                                : "No additional details"}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            {loading && items.length === 0 ? (
              <CommandEmpty>Loading...</CommandEmpty>
            ) : null}

            {!loading && items.length === 0 ? (
              <CommandEmpty>No results found.</CommandEmpty>
            ) : null}

            {hasMore ? (
              <div className="border-t border-border p-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-center text-sm"
                  onClick={onLoadMore}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>

      {/* Makes the keyboard clear affordance discoverable. Without it, Backspace
          and Delete work but nothing announces that they do. */}
      {canClear ? (
        <span id={clearHintId} className="sr-only">
          Press Backspace or Delete to clear the current selection.
        </span>
      ) : null}
    </div>
  );
}
