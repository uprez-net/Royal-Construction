"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { insertAt } from "@/lib/store/slices/admin-offer-content-list";
import type { InclusionScheduleRow } from "@/types/admin-offer-content";
import { INCLUSION_CATEGORY_SUGGESTIONS } from "./inclusion-schedule";

interface InclusionScheduleEditorProps {
  value: InclusionScheduleRow[];
  onChange: (rows: InclusionScheduleRow[]) => void;
}

// An emptied category drops the key rather than storing "", so a cleared row
// reads the same as one that never had a category.
function withCategory(row: InclusionScheduleRow, category: string): InclusionScheduleRow {
  return category === "" ? { spec: row.spec } : { spec: row.spec, category };
}

export function InclusionScheduleEditor({
  value,
  onChange,
}: InclusionScheduleEditorProps) {
  const id = useId();
  const categoryListId = `${id}-categories`;
  const draftSpecId = `${id}-draft-spec`;
  const draftCategoryId = `${id}-draft-category`;
  const [draftSpec, setDraftSpec] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  // Undo fires seconds after the delete. Restoring into the list as it is by
  // then, rather than a snapshot taken at delete time, keeps edits made since.
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  const commitDraft = () => {
    const spec = draftSpec.trim();
    if (!spec) return;
    const category = draftCategory.trim();
    onChange([...value, category ? { spec, category } : { spec }]);
    setDraftSpec("");
    setDraftCategory("");
  };

  const updateAt = (index: number, row: InclusionScheduleRow) => {
    const next = value.slice();
    next[index] = row;
    onChange(next);
  };

  const removeAt = (index: number) => {
    const removed = value[index];
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
    toast("Inclusion removed", {
      action: {
        label: "Undo",
        onClick: () => onChange(insertAt(latestValue.current, removed, index)),
      },
    });
  };

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className="space-y-2">
      <datalist id={categoryListId}>
        {INCLUSION_CATEGORY_SUGGESTIONS.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      {value.length > 0 && (
        <ol className="divide-y divide-border/70 border-t border-border/70">
          {value.map((row, index) => {
            const specId = `${id}-spec-${index}`;
            const categoryId = `${id}-category-${index}`;
            return (
              <li key={index} className="flex flex-wrap items-center gap-2 py-2">
                <Label htmlFor={specId} className="sr-only">
                  Inclusion {index + 1} specification
                </Label>
                <Input
                  id={specId}
                  value={row.spec}
                  onChange={(e) =>
                    updateAt(index, { ...row, spec: e.target.value })
                  }
                  placeholder="Inclusion text"
                  className="min-w-60 flex-1"
                  aiRewrite
                />
                <Label htmlFor={categoryId} className="sr-only">
                  Inclusion {index + 1} category
                </Label>
                <Input
                  id={categoryId}
                  list={categoryListId}
                  value={row.category ?? ""}
                  onChange={(e) => updateAt(index, withCategory(row, e.target.value))}
                  placeholder="Category"
                  className="w-56"
                />
                <button
                  type="button"
                  aria-label={`Remove inclusion ${index + 1}`}
                  onClick={() => removeAt(index)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive-ink"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1 space-y-1">
          <Label htmlFor={draftSpecId} className="text-xs text-muted-foreground">
            New inclusion
          </Label>
          <Input
            id={draftSpecId}
            value={draftSpec}
            onChange={(e) => setDraftSpec(e.target.value)}
            onKeyDown={commitOnEnter}
            placeholder="Inclusion text"
            aiRewrite
          />
        </div>
        <div className="w-56 space-y-1">
          <Label htmlFor={draftCategoryId} className="text-xs text-muted-foreground">
            Category
          </Label>
          <Input
            id={draftCategoryId}
            list={categoryListId}
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value)}
            onKeyDown={commitOnEnter}
            placeholder="e.g. Concrete Slab"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={commitDraft}>
          <PlusIcon className="size-4" />
          Add inclusion
        </Button>
      </div>
    </div>
  );
}
