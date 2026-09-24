"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { InclusionScheduleRow } from "@/types/admin-offer-content";
import { INCLUSION_CATEGORY_SUGGESTIONS } from "./inclusion-schedule";
import { INCLUSION_SCHEDULE_UNDO_TOAST_ID } from "./undo-toast-ids";

interface InclusionScheduleEditorProps {
  value: InclusionScheduleRow[];
  onChange: (rows: InclusionScheduleRow[]) => void;
  onRestore: (row: InclusionScheduleRow, index: number) => void;
}

export function InclusionScheduleEditor({
  value,
  onChange,
  onRestore,
}: InclusionScheduleEditorProps) {
  const id = useId();
  const categoryListId = `${id}-categories`;
  const draftSpecId = `${id}-draft-spec`;
  const draftCategoryId = `${id}-draft-category`;
  const draftTenderTextId = `${id}-draft-tender-text`;
  const [draftSpec, setDraftSpec] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftTenderText, setDraftTenderText] = useState("");

  const commitDraft = () => {
    const spec = draftSpec.trim();
    const category = draftCategory.trim();
    if (!spec && !category) return;
    onChange([
      ...value,
      {
        spec,
        ...(category ? { category } : {}),
        tenderText: draftTenderText.trim(),
      },
    ]);
    setDraftSpec("");
    setDraftCategory("");
    setDraftTenderText("");
  };

  const updateAt = (index: number, row: InclusionScheduleRow) => {
    const next = value.slice();
    next[index] = row;
    onChange(next);
  };

  // The toast outlives this editor: switching admin tabs unmounts it while
  // Undo is still on screen. The restore therefore goes through the store,
  // which inserts into the list as it is when Undo is clicked, not as this
  // instance last saw it.
  const removeAt = (index: number) => {
    const removed = value[index];
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
    toast("Inclusion removed", {
      id: INCLUSION_SCHEDULE_UNDO_TOAST_ID,
      action: {
        label: "Undo",
        onClick: () => onRestore(removed, index),
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
            const tenderTextId = `${id}-tender-text-${index}`;
            return (
              <li
                key={index}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <Label htmlFor={specId} className="sr-only">
                  Inclusion {index + 1} specification
                </Label>
                <Input
                  id={specId}
                  value={row.spec}
                  onChange={(e) =>
                    updateAt(index, { ...row, spec: e.target.value })
                  }
                  placeholder="Offer inclusion text"
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
                  onChange={(e) =>
                    updateAt(index, {
                      ...row,
                      category: e.target.value || undefined,
                    })
                  }
                  placeholder="Category"
                  className="w-56"
                />
                <Label htmlFor={tenderTextId} className="sr-only">
                  Inclusion {index + 1} tender text
                </Label>
                <Textarea
                  id={tenderTextId}
                  value={row.tenderText ?? ""}
                  onChange={(e) =>
                    updateAt(index, {
                      ...row,
                      tenderText: e.target.value,
                    })
                  }
                  placeholder="Tender Text"
                  className="w-[28rem] max-w-full"
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
          <Label
            htmlFor={draftSpecId}
            className="text-xs text-muted-foreground"
          >
            New inclusion
          </Label>
          <Input
            id={draftSpecId}
            value={draftSpec}
            onChange={(e) => setDraftSpec(e.target.value)}
            onKeyDown={commitOnEnter}
            placeholder="Offer inclusion text"
            aiRewrite
          />
        </div>
        <div className="w-56 space-y-1">
          <Label
            htmlFor={draftCategoryId}
            className="text-xs text-muted-foreground"
          >
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
        <div className="w-[28rem] max-w-full space-y-1">
          <Label
            htmlFor={draftTenderTextId}
            className="text-xs text-muted-foreground"
          >
            Tender Text
          </Label>
          <Textarea
            id={draftTenderTextId}
            value={draftTenderText}
            onChange={(e) => setDraftTenderText(e.target.value)}
            placeholder="Tender Text"
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
