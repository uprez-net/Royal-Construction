"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, XIcon } from "lucide-react";
import { insertAt } from "@/lib/store/slices/admin-offer-content-list";

interface BulletListEditorProps {
  value: string[];
  onChange: (v: string[]) => void;
  addLabel?: string;
  placeholder?: string;
}

export function BulletListEditor({
  value,
  onChange,
  addLabel = "Add bullet",
  placeholder = "Bullet text",
}: BulletListEditorProps) {
  const [draft, setDraft] = useState("");
  // Undo fires seconds after the delete. Restoring into the list as it is by
  // then, rather than a snapshot taken at delete time, keeps edits made since.
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);

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

  const removeAt = (index: number) => {
    const removed = value[index];
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
    toast("Bullet removed", {
      action: {
        label: "Undo",
        onClick: () => onChange(insertAt(latestValue.current, removed, index)),
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
