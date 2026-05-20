"use client";

import { useState } from "react";
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

export interface LookupOption {
  id: string;
  name: string;
  location?: string;
  email?: string;
  phone?: string;
  company?: string;
  tradeType?: string;
  description?: string;
}

type SearchableItem = LookupOption | AddressSuggestion;

function isLookupOption(item: SearchableItem): item is LookupOption {
  return "name" in item;
}

export function SearchableSelect({
  label,
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
  label: string;
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

  const triggerLabel = selectedItem
    ? isLookupOption(selectedItem)
      ? selectedItem.name
      : selectedItem.label
    : placeholder;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between gap-3"
            disabled={disabled}
          >
            <span className="truncate text-left">{triggerLabel}</span>

            <div className="flex items-center gap-1">
              {selectedItem && onClear ? (
                <div
                  // variant="ghost"
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear();
                  }}
                >
                  <X className="size-4" />
                </div>
              ) : null}

              {loading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}...`}
              value={searchValue}
              onValueChange={onQueryChange}
            />

            <CommandList>
              {loading && items.length === 0 ? (
                <CommandEmpty>Loading...</CommandEmpty>
              ) : null}

              {!loading && items.length === 0 ? (
                <CommandEmpty>No results found.</CommandEmpty>
              ) : null}

              <CommandGroup>
                {items.map((item) => {
                  const title = isLookupOption(item) ? item.name : item.label;

                  const subtitle = isLookupOption(item)
                    ? (item.description ??
                        [
                          item.email,
                          item.phone,
                          item.company,
                          item.tradeType,
                          item.location,
                        ]
                          .filter(Boolean)
                          .join(" · ")) ||
                      "No additional details"
                    : `${item.address}, ${item.postcode ?? ""}, Council: ${item.council}`;

                  return (
                    <CommandItem
                      key={item.id}
                      value={title}
                      onSelect={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                    >
                      <div className="flex w-full flex-col gap-0.5 text-left">
                        <span className="font-medium text-foreground">
                          {title}
                        </span>

                        <span className="text-xs text-muted-foreground">
                          {subtitle}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>

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
    </div>
  );
}
