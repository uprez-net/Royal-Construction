"use client";

import { toast } from "sonner";
import { CalendarClock, Check, Trash2 } from "lucide-react";

import { TaskForm } from "@/components/leads/task-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppDispatch } from "@/lib/store/hooks";
import { bumpLeadTasks } from "@/lib/store/slices/uiSlice";
import { LEAD_TASK_TYPES } from "@/lib/leads/task-presets";
import {
  completeTask,
  deleteTask,
  type LeadTaskRow,
} from "@/lib/leads/task-service";
import { isTerminalStage } from "@/lib/leads/lead-helpers";
import type { Lead } from "@/lib/leads/types";
import { useMediaQuery } from "@/hooks/use-media-query";

export function LeadScheduledWorkTab({
  lead,
  openTasks,
  onTasksChange,
  onLeadUpdate,
}: {
  lead: Lead;
  openTasks: LeadTaskRow[];
  onTasksChange: (tasks: LeadTaskRow[]) => void;
  onLeadUpdate: (lead: Lead) => void;
}) {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const canAddTask = !isTerminalStage(lead.stage) && !lead.isArchived;

  return (
    <section className="space-y-4">
      <details
        open={!isMobile}
        className="rounded-xl border border-border/70 bg-card shadow-sm"
      >
        <summary className="min-h-11 cursor-pointer px-4 py-3 font-medium md:hidden">
          Add a task
        </summary>
        <Card className="rounded-xl border-0 bg-card shadow-none">
          <CardHeader className="border-b border-border/70 px-4 pb-4 sm:px-6">
            <CardTitle
              as="h2"
              className="text-base font-semibold text-foreground"
            >
              Add a task
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Calls, emails and meetings on this lead. Adding a task moves a New
              or Contacted lead into Discovery; completing one never moves a
              lead.
            </p>
          </CardHeader>
          <CardContent className="px-4 pt-4 sm:px-6 sm:pt-5">
            {canAddTask ? (
              <TaskForm
                leadId={lead.id}
                leadName={lead.name}
                onCreated={(task) => {
                  onTasksChange([...openTasks, task]);
                  // Optimistic above, authoritative here: the bump refetches this
                  // list and moves the Tasks tab and the "Open tasks" card too.
                  dispatch(bumpLeadTasks());
                  // Adding a task can advance a New or Contacted lead into
                  // Discovery. The task carries the lead's stage as it is AFTER
                  // that move, so push it up rather than leaving the header and
                  // the stage picker showing the old value until a refresh.
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
          </CardContent>
        </Card>
      </details>

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 px-4 pb-4 sm:px-6">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Open tasks
          </CardTitle>
          <p className="text-sm text-muted-foreground tabular-nums">
            {openTasks.length === 0
              ? "Nothing open yet"
              : `${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}`}
          </p>
        </CardHeader>
        <CardContent className="px-4 pt-4 sm:px-6 sm:pt-5">
          {openTasks.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                <CalendarClock
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No open tasks on this lead
                </p>
                <p className="text-xs text-muted-foreground">
                  Add a call, email or meeting above and it will show here.
                </p>
              </div>
            </div>
          ) : (
            <ul className="task-open-list pr-1 md:max-h-[min(28rem,55vh)] md:overflow-y-auto md:overscroll-contain">
              {openTasks.map((task) => (
                <li key={task.id} className="task-open-row">
                  <span className="fu-type-pill">
                    {LEAD_TASK_TYPES.find((t) => t.value === task.type)?.label
                      ?? task.type}
                  </span>
                  <span className="task-open-due">
                    {task.dueDate
                      ? new Date(task.dueDate).toLocaleDateString("en-AU", {
                          timeZone: "Australia/Sydney",
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })
                      : "No date"}
                    {/* The composer can book a time now, so show it. Without
                        this a 9am site meeting reads the same as an all-day
                        one and the person turns up whenever. */}
                    {task.dueTime ? ` · ${task.dueTime}` : ""}
                  </span>
                  <span
                    className="task-open-note"
                    title={task.notes ?? undefined}
                  >
                    {task.notes}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs"
                    onClick={async () => {
                      try {
                        await completeTask(task.id);
                        onTasksChange(
                          openTasks.filter((t) => t.id !== task.id),
                        );
                        // Keep the Tasks tab and the "Open tasks" card in
                        // step: closing here used to leave both stale.
                        dispatch(bumpLeadTasks());
                      } catch {
                        toast.error("Could not close the task.");
                      }
                    }}
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                    Done
                  </Button>
                  {/* Removing is not the same as closing. "Done" says the
                      call happened; this is for work that should never have
                      been booked, which previously had no exit at all. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs text-[var(--destructive-ink)] hover:bg-[var(--destructive-light)] hover:text-[var(--destructive-ink)]"
                    aria-label={`Remove task for ${lead.name}`}
                    onClick={async () => {
                      try {
                        await deleteTask(task.id);
                        onTasksChange(
                          openTasks.filter((t) => t.id !== task.id),
                        );
                        dispatch(bumpLeadTasks());
                        toast.success("Task removed.");
                      } catch {
                        toast.error("Could not remove the task.");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
