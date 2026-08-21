"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, XIcon } from "lucide-react";
import { InclusionScheduleRow } from "@/types/admin-offer-content";

interface BulletListEditorProps {
  value: string[] | InclusionScheduleRow[];
  onChange: (v: string[] | InclusionScheduleRow[]) => void;
  addLabel?: string;
  placeholder?: string;
}

export function BulletListEditor({
  value,
  onChange,
  addLabel = "Add bullet",
  placeholder = "Bullet text",
}: BulletListEditorProps) {
  const [draft, setDraft] = useState<string | InclusionScheduleRow>("");

  const commitDraft = () => {
    const trimmed = typeof draft === "string" ? draft.trim() : draft.spec.trim();
    if (!trimmed) return;
    if (typeof draft === "string") {
      onChange([...(value as string[]), trimmed]);
    } else {
      onChange([
        ...(value as InclusionScheduleRow[]),
        { spec: trimmed, category: draft.category },
      ]);
    }
    setDraft("");
  };

  const updateAt = (index: number, text: string) => {
    const next = value.slice();
    next[index] = typeof next[index] === "string" ? text : { ...next[index], spec: text };
    onChange(next);
  };

  const removeAt = (index: number) => {
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
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
                value={typeof bullet === "string" ? bullet : bullet.spec}
                onChange={(e) => updateAt(index, e.target.value)}
                placeholder={placeholder}
                className="flex-1"
                aiRewrite
              />
              <button
                type="button"
                aria-label="Remove bullet"
                onClick={() => removeAt(index)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={typeof draft === "string" ? draft : draft.spec}
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
