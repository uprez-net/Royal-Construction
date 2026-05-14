"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface LookupOption {
  id: string;
  name: string;
  email: string;
  phone: string;
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
  disabled,
}: {
  label: string;
  placeholder: string;
  searchValue: string;
  selectedItem: LookupOption | null;
  items: LookupOption[];
  loading?: boolean;
  hasMore?: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (item: LookupOption) => void;
  onLoadMore?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerLabel = selectedItem ? selectedItem.name : placeholder;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between gap-3" disabled={disabled}>
            <span className="truncate text-left">{triggerLabel}</span>
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}...`}
              value={searchValue}
              onValueChange={onQueryChange}
            />
            <CommandList>
              {loading && items.length === 0 ? <CommandEmpty>Loading...</CommandEmpty> : null}
              {!loading && items.length === 0 ? <CommandEmpty>No results found.</CommandEmpty> : null}
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.name}
                    onSelect={() => {
                      onSelect(item);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full flex-col gap-0.5 text-left">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.email} · {item.phone}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {hasMore ? (
              <div className="border-t border-border p-2">
                <Button type="button" variant="ghost" className="w-full justify-center text-sm" onClick={onLoadMore}>
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