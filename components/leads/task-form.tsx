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
import { cn } from "@/lib/utils";

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
    } catch {
      setError("Could not save the task. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-form">
      <p className="task-form-title">Next task for {leadName}</p>

      <div className="task-form-row">
        <span className="task-form-label">Type</span>
        <div className="task-chip-group" role="group" aria-label="Task type">
          {LEAD_TASK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={cn("task-chip", type === t.value && "task-chip-on")}
              aria-pressed={type === t.value}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="task-form-row">
        <span className="task-form-label">Due</span>
        <div className="task-chip-group" role="group" aria-label="Due date">
          {LEAD_TASK_DUE_PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={cn("task-chip", presetDays === p.days && "task-chip-on")}
              aria-pressed={presetDays === p.days}
              onClick={() => setPresetDays(p.days)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={cn("task-chip", presetDays === null && "task-chip-on")}
            aria-pressed={presetDays === null}
            onClick={() => setPresetDays(null)}
          >
            No date
          </button>
        </div>
      </div>

      <div className="task-form-row">
        <span className="task-form-label">Note</span>
        <input
          className="task-form-input"
          value={notes}
          placeholder="Optional"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="task-form-error">{error}</p>}

      <div className="task-form-actions">
        {onCancel && (
          <button type="button" className="task-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="button" className="task-btn task-btn-primary" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Add task
        </button>
      </div>
    </div>
  );
}
