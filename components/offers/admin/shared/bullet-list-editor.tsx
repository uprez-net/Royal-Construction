"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, XIcon } from "lucide-react";

interface BulletListEditorProps {
  value: string[];
  onChange: (v: string[]) => void;
  onRestore: (bullet: string, index: number) => void;
  /** Distinct per list, so one list's Undo toast never replaces another's. */
  undoToastId: string;
  addLabel?: string;
  placeholder?: string;
}

export function BulletListEditor({
  value,
  onChange,
  onRestore,
  undoToastId,
  addLabel = "Add bullet",
  placeholder = "Bullet text",
}: BulletListEditorProps) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setDraft("");
  };

  const updateAt = (index: number, text: string) => {
    const next = value.slice();
    next[index] = text;
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
    toast("Bullet removed", {
      id: undoToastId,
      action: {
        label: "Undo",
        onClick: () => onRestore(removed, index),
      },
    });
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="divide-y divide-border/70 border-t border-border/70">
          {value.map((bullet, index) => (
            <div key={index} className="flex items-center gap-2 py-2">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-royal-gold"
              />
              <Input
                value={bullet}
                onChange={(e) => updateAt(index, e.target.value)}
                placeholder={placeholder}
                className="flex-1"
                aiRewrite
              />
              <button
                type="button"
                aria-label="Remove bullet"
                onClick={() => removeAt(index)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive-ink"
              >
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder={placeholder}
          className="flex-1"
          aiRewrite
        />
        <Button type="button" variant="outline" size="sm" onClick={commitDraft}>
          <PlusIcon className="size-4" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
