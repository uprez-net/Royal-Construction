"use client";

import { Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { ModalShell } from "@/components/common/modal-shell";
import { TaskForm } from "@/components/leads/task-form";
import { Button } from "@/components/ui/button";
import { formatLeadTaskDue, isTerminalStage } from "@/lib/leads/lead-helpers";
import { LEAD_TASK_TYPES } from "@/lib/leads/task-presets";
import { completeTask, type LeadTaskRow } from "@/lib/leads/task-service";
import type { Lead } from "@/lib/leads/types";
import { useAppDispatch } from "@/lib/store/hooks";
import { bumpLeadTasks } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";

function typeLabel(type: LeadTaskRow["type"]): string {
  return LEAD_TASK_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function LeadTaskCell({
  next,
  disabled,
  onOpen,
}: {
  next: LeadTaskRow | undefined;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={next ? "View tasks" : "Add a task"}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cn(
        "inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        next
          ? "rounded-md px-1 py-0.5 hover:bg-muted"
          : "rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground hover:border-royal-gold hover:bg-royal-gold-light hover:text-royal-gold-ink-text",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-haspopup="dialog"
    >
      {next ? (
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-foreground">
            {typeLabel(next.type)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatLeadTaskDue(next.dueDate, next.dueTime)}
          </span>
        </span>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">
          Add task
        </span>
      )}
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

export function LeadTasksModal({
  lead,
  tasks,
  onClose,
  onLeadUpdate,
}: {
  lead: Lead;
  tasks: LeadTaskRow[];
  onClose: () => void;
  onLeadUpdate: (lead: Lead) => void;
}) {
  const dispatch = useAppDispatch();
  const canAddTask = !isTerminalStage(lead.stage) && !lead.isArchived;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={`Tasks for ${lead.name}`}
      subtitle="Open work on this lead. Adding a task moves a New or Contacted lead into Discovery."
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open tasks on this lead.
          </p>
        ) : (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {typeLabel(task.type)}{" "}
                    <span className="font-normal text-muted-foreground">
                      {formatLeadTaskDue(task.dueDate, task.dueTime)}
                    </span>
                  </p>
                  {task.notes ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {task.notes}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 cursor-pointer gap-1 px-2.5 text-xs"
                  aria-label={`Mark ${typeLabel(task.type)} done`}
                  onClick={async () => {
                    try {
                      await completeTask(task.id);
                      dispatch(bumpLeadTasks());
                    } catch {
                      toast.error("Could not close the task.");
                    }
                  }}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  Done
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canAddTask ? (
          <TaskForm
            leadId={lead.id}
            leadName={lead.name}
            onCreated={(task) => {
              dispatch(bumpLeadTasks());
              if (task.lead.stage !== lead.stage) {
                onLeadUpdate({ ...lead, stage: task.lead.stage });
              }
              toast.success("Task added.");
            }}
          />
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {lead.isArchived
              ? "This lead is archived. Restore it before adding a task."
              : `This lead is closed as ${lead.stage}. Reopen it before adding a task.`}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
