"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  LEAD_TASK_DUE_PRESETS,
  LEAD_TASK_TYPES,
  dueDateFromPreset,
} from "@/lib/leads/task-presets";
import { createTask } from "@/lib/leads/task-service";
import type { LeadTaskRow } from "@/lib/leads/task-service";
import type { LeadTaskType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface TaskFormProps {
  leadId: number;
  leadName: string;
  onCreated: (task: LeadTaskRow) => void;
  onCancel?: () => void;
}

/**
 * Two pickers and a note.
 *
 * Both pickers exist because people were already typing their values into the
 * free-text notes box: "Organise a Meeting" four times on production, and nine
 * separate notes expressing a due date in prose, including the same interval
 * written as "1 Day" and "1 day".
 */
export function TaskForm({ leadId, leadName, onCreated, onCancel }: TaskFormProps) {
  const [type, setType] = useState<LeadTaskType>("CALL");
  const [presetDays, setPresetDays] = useState<number | null>(7);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const task = await createTask({
        leadId,
        type,
        // Null is a real choice, not a missing value. A task with no date is
        // work someone has not scheduled yet, and it needs to be visible.
        dueDate:
          presetDays === null ? null : dueDateFromPreset(presetDays, new Date()).toISOString(),
        notes: notes.trim() || null,
      });
      onCreated(task);
      setNotes("");
    } catch (err) {
      // fetchJson throws a FetchError carrying the server's message. Showing it
      // beats a generic sentence when the server had something specific to say.
      const message = err instanceof Error ? err.message : "";
      setError(message || "Could not save the task. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // "" is the ToggleGroup value for "No date": the primitive uses the empty
  // string for deselected, and null cannot round-trip through it.
  const dueValue = presetDays === null ? "" : String(presetDays);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-4 text-sm font-semibold text-foreground">
        Next task for {leadName}
      </p>

      <div className="grid gap-4 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={type}
          // A toggle group can deselect; a task must always have a type, so an
          // empty value is ignored rather than written.
          onValueChange={(value) => value && setType(value as LeadTaskType)}
          aria-label="Task type"
          className="flex-wrap"
        >
          {LEAD_TASK_TYPES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Label className="text-xs text-muted-foreground">Due</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={dueValue}
          onValueChange={(value) =>
            setPresetDays(value === "" ? null : Number(value))
          }
          aria-label="Due date"
          className="flex-wrap"
        >
          {LEAD_TASK_DUE_PRESETS.map((p) => (
            <ToggleGroupItem key={p.days} value={String(p.days)}>
              {p.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="">No date</ToggleGroupItem>
        </ToggleGroup>

        <Label
          className="text-xs text-muted-foreground"
          htmlFor={`task-note-${leadId}`}
        >
          Note
        </Label>
        <Input
          id={`task-note-${leadId}`}
          value={notes}
          placeholder="Optional"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={submit} disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          Add task
        </Button>
      </div>
    </div>
  );
}
