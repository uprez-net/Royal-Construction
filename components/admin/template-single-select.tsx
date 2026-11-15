"use client";

import { useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
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

export type TemplateSelectOption = {
  id: string;
  label: string;
  description?: string;
  group?: string;
  icon: ReactNode;
};

export function TemplateSingleSelect({
  id,
  value,
  options,
  searchLabel,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: TemplateSelectOption[];
  searchLabel: string;
  emptyLabel: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? `${id}-options` : undefined}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-left">
            {selected?.icon}
            <span className="truncate">
              {selected?.label ?? "Select an option"}
            </span>
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={searchLabel}
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command label={searchLabel}>
          <CommandInput
            placeholder={`${searchLabel}…`}
            aria-label={searchLabel}
          />
          <CommandList id={`${id}-options`} aria-label={searchLabel}>
            {groups.map((group) => (
              <CommandGroup key={group ?? "default"} heading={group}>
                {options
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      keywords={[
                        option.label,
                        option.description ?? "",
                        group ?? "",
                      ]}
                      checked={value === option.id}
                      onSelect={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                    >
                      {option.icon}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="break-words">{option.label}</span>
                        {option.description ? (
                          <span className="text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandEmpty>{emptyLabel}</CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
