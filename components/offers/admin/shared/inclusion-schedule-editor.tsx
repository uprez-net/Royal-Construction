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
import { useMediaQuery } from "@/hooks/use-media-query";

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
  const isMobile = useMediaQuery("(max-width: 767px)", null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
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
              <li key={index} className="py-2">
                <details
                  open={isMobile === false || expandedRows.has(index)}
                  onToggle={(event) => {
                    if (isMobile !== true) return;
                    const open = event.currentTarget.open;
                    setExpandedRows((previous) => {
                      if (previous.has(index) === open) return previous;
                      const next = new Set(previous);
                      if (open) next.add(index);
                      else next.delete(index);
                      return next;
                    });
                  }}
                  onFocusCapture={(event) => {
                    // Keep the editor visible if a focused field crosses into mobile.
                    if (
                      !(
                        event.target instanceof HTMLInputElement
                        || event.target instanceof HTMLTextAreaElement
                      )
                    )
                      return;
                    setExpandedRows((previous) =>
                      previous.has(index)
                        ? previous
                        : new Set([...previous, index]),
                    );
                  }}
                >
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm font-medium md:hidden">
                    <span className="min-w-0 break-words">
                      {index + 1}.{" "}
                      {row.spec || row.category || "Untitled inclusion"}
                    </span>
                    <span className="shrink-0 text-primary">Edit</span>
                  </summary>
                  <div className="flex min-w-0 flex-col gap-2 py-3 md:flex-row md:flex-wrap md:items-center md:py-0">
                    <Label
                      htmlFor={specId}
                      className="text-xs text-muted-foreground md:sr-only"
                    >
                      Inclusion {index + 1} specification
                    </Label>
                    <Input
                      id={specId}
                      value={row.spec}
                      onChange={(e) =>
                        updateAt(index, { ...row, spec: e.target.value })
                      }
                      placeholder="Offer inclusion text"
                      className="min-w-0 flex-1 md:min-w-60"
                      aiRewrite
                    />
                    <Label
                      htmlFor={categoryId}
                      className="text-xs text-muted-foreground md:sr-only"
                    >
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
                      className="w-full md:w-56"
                    />
                    <Label
                      htmlFor={tenderTextId}
                      className="text-xs text-muted-foreground md:sr-only"
                    >
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
                      className="w-full md:w-[28rem] md:max-w-full"
                    />
                    <button
                      type="button"
                      aria-label={`Remove inclusion ${index + 1}`}
                      onClick={() => removeAt(index)}
                      className="flex min-h-11 w-full shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive-ink md:size-7"
                    >
                      <XIcon className="size-4" aria-hidden="true" />
                      <span className="ml-2 md:sr-only">Remove inclusion</span>
                    </button>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-0 space-y-1 md:min-w-60 md:flex-1">
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
        <div className="w-full space-y-1 md:w-56">
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
        <div className="w-full space-y-1 md:w-[28rem] md:max-w-full">
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
