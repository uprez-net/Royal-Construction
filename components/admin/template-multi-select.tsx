"use client";

import { useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { TemplateSelectOption } from "./template-single-select";

export function TemplateMultiSelect({
  id,
  value,
  options,
  placeholder,
  noun,
  searchLabel,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: readonly string[];
  options: TemplateSelectOption[];
  placeholder: string;
  /** Singular and plural, for "2 tradie categories selected". */
  noun: [string, string];
  searchLabel: string;
  emptyLabel: string;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (optionId: string) =>
    onChange(
      value.includes(optionId)
        ? value.filter((selected) => selected !== optionId)
        : [...value, optionId],
    );
  const selected = options.filter((option) => value.includes(option.id));
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <div className="flex flex-col gap-2">
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
            className="w-full justify-between"
          >
            {value.length
              ? `${value.length} ${value.length === 1 ? noun[0] : noun[1]} selected`
              : placeholder}
            <ChevronsUpDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={searchLabel}
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput
              placeholder={`${searchLabel}…`}
              aria-label={searchLabel}
            />
            <CommandList
              id={`${id}-options`}
              aria-multiselectable="true"
              aria-label={searchLabel}
            >
              <CommandEmpty>{emptyLabel}</CommandEmpty>
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
                        data-checked={value.includes(option.id)}
                        aria-selected={value.includes(option.id)}
                        onSelect={() => toggle(option.id)}
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
                        <span className="sr-only">
                          {value.includes(option.id)
                            ? "Selected"
                            : "Not selected"}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Selected ${noun[1]}`}>
          {selected.map((option) => (
            <li key={option.id}>
              <Badge variant="secondary">
                {option.icon}
                {option.label}
                <button
                  type="button"
                  disabled={disabled}
                  className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Remove ${option.label}`}
                  onClick={() => toggle(option.id)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
