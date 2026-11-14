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

export function TemplateCostLinePicker({
  id,
  tasks,
  selected,
  disabled,
  onChange,
}: {
  id: string;
  tasks: readonly string[];
  selected: readonly string[];
  disabled?: boolean;
  onChange: (tasks: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (task: string) =>
    onChange(
      selected.includes(task)
        ? selected.filter((line) => line !== task)
        : [...selected, task],
    );
  const missing = selected.filter((task) => !tasks.includes(task));
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
            {selected.length
              ? `${selected.length} cost line${selected.length === 1 ? "" : "s"} selected`
              : "Select cost lines"}
            <ChevronsUpDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          aria-label="Select cost lines"
        >
          <Command label="Search cost schedule tasks">
            <CommandInput
              placeholder="Search cost schedule tasks…"
              aria-label="Search cost schedule tasks"
            />
            <CommandList
              id={`${id}-options`}
              aria-multiselectable="true"
              aria-label="Cost schedule tasks"
            >
              <CommandEmpty>No matching cost schedule tasks.</CommandEmpty>
              <CommandGroup heading="Cost schedule tasks">
                {tasks.map((task) => (
                  <CommandItem
                    key={task}
                    value={task}
                    checked={selected.includes(task)}
                    onSelect={() => toggle(task)}
                  >
                    <span>{task}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected cost lines">
          {selected.map((task) => (
            <li key={task}>
              <Badge variant="secondary">
                {task}
                <button
                  type="button"
                  disabled={disabled}
                  className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Remove ${task}`}
                  onClick={() => toggle(task)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {tasks.length === 0 ? (
        <p className="text-xs text-warning-ink">
          Add task names under Admin → Offer Pre-Fill Content → Cost Schedule to
          select cost lines.
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p role="status" className="text-xs text-warning-ink">
          These existing mappings are no longer in the cost schedule:{" "}
          {missing.join(", ")}. Remove them and select the replacement tasks.
        </p>
      ) : null}
    </div>
  );
}
