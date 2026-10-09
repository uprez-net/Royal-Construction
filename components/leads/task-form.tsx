"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  LEAD_TASK_DUE_PRESETS,
  LEAD_TASK_TYPES,
  dueDateFromPreset,
} from "@/lib/leads/task-presets";
import { createTask } from "@/lib/leads/task-service";
import { sydneyStartOfDay, sydneyToday } from "@/lib/dates/sydney";
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
export function TaskForm({
  leadId,
  leadName,
  onCreated,
  onCancel,
}: TaskFormProps) {
  const [type, setType] = useState<LeadTaskType>("CALL");
  /**
   * Two ways to answer "when": a preset interval, or a picked date.
   *
   * The presets cover the intervals people already wrote in prose, but they
   * cannot say "next Tuesday" or "the 14th", which is how a site meeting is
   * actually booked. A task without a date cannot be reminded on, so there is
   * no "no date" choice here.
   */
  const [dueMode, setDueMode] = useState<"preset" | "custom">("preset");
  const [presetDays, setPresetDays] = useState(7);
  const [customDate, setCustomDate] = useState("");
  /** Optional on any dated task. "Call them tomorrow at 9" needs the 9. */
  const [dueTime, setDueTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resolveDueDate(): string | null {
    if (dueMode === "custom") {
      if (!customDate) return null;
      // Sydney midnight, the same anchor the presets use, so a task booked for
      // the 14th sorts against them correctly instead of landing a day out.
      return sydneyStartOfDay(customDate).toISOString();
    }
    return dueDateFromPreset(presetDays, new Date()).toISOString();
  }

  async function submit() {
    if (dueMode === "custom") {
      if (!customDate) {
        setError("Pick a date.");
        return;
      }
      // The input's `min` is a browser hint only — it does not stop a typed or
      // pasted value, and nothing downstream rejects one. Work due before
      // today would sort above everything and read as permanently overdue.
      if (customDate < sydneyToday()) {
        setError("That date has already passed. Pick today or later.");
        return;
      }
    }
    const dueDate = resolveDueDate();
    if (!dueDate) {
      setError("Pick a date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const task = await createTask({
        leadId,
        type,
        dueDate,
        dueTime: dueTime || null,
        notes: notes.trim() || null,
      });
      onCreated(task);
      setNotes("");
      setCustomDate("");
      setDueTime("");
    } catch (err) {
      // fetchJson throws a FetchError carrying the server's message. Showing it
      // beats a generic sentence when the server had something specific to say.
      const message = err instanceof Error ? err.message : "";
      setError(message || "Could not save the task. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const dueValue = dueMode === "custom" ? "custom" : String(presetDays);

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
          spacing={2}
          value={type}
          // A toggle group can deselect; a task must always have a type, so an
          // empty value is ignored rather than written.
          onValueChange={(value) => value && setType(value as LeadTaskType)}
          aria-label="Task type"
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap"
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
          spacing={2}
          value={dueValue}
          onValueChange={(value) => {
            if (!value) return;
            if (value === "custom") setDueMode("custom");
            else {
              setDueMode("preset");
              setPresetDays(Number(value));
            }
          }}
          aria-label="Due date"
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {LEAD_TASK_DUE_PRESETS.map((p) => (
            <ToggleGroupItem key={p.days} value={String(p.days)}>
              {p.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom">Pick a date</ToggleGroupItem>
        </ToggleGroup>

        <Label className="text-xs text-muted-foreground">
          {dueMode === "custom" ? "Date & time" : "Time"}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {dueMode === "custom" && (
            <Input
              type="date"
              aria-label="Due date"
              className="w-full min-w-0 sm:w-auto"
              required
              // Sydney's today, not the browser's: a laptop set to another
              // timezone would otherwise reject a date that is valid here.
              min={sydneyToday()}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          )}
          <Input
            type="time"
            aria-label="Due time (optional)"
            className="w-full min-w-0 sm:w-auto"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {dueTime ? "Sydney time" : "Optional — all day if left blank"}
          </span>
        </div>

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

      <div className="mt-4 flex flex-wrap justify-end gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
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
