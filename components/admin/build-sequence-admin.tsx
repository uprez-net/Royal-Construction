"use client";

import { useState } from "react";
import { ProjectStage } from "@prisma/client";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TemplateCostLinePicker } from "./template-cost-line-picker";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  moveTemplateActivity,
  templateDescendants,
} from "@/lib/domain/projects/template-tree";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/utils/fetch";
import { formatStatus } from "@/utils/formatters";
import type {
  MilestoneTemplateSnapshot,
  TemplateActivity,
} from "@/types/milestone-template";
import type { TradeTypeAdminRow } from "@/types/trade-type";

export function BuildSequenceAdmin({
  initial,
  trades,
  costTasks,
}: {
  initial: MilestoneTemplateSnapshot;
  trades: TradeTypeAdminRow[];
  costTasks: string[];
}) {
  const [saved, setSaved] = useState(initial);
  const [activities, setActivities] = useState(initial.activities);
  const [selectedId, setSelectedId] = useState(initial.activities[0]?.id);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(activities) !== JSON.stringify(saved.activities);
  const selected = activities.find((row) => row.id === selectedId);
  const peers = selected
    ? activities.filter((row) => row.parentId === selected.parentId)
    : [];
  const peerIndex = peers.findIndex((row) => row.id === selectedId);
  const descendants = selected
    ? templateDescendants(activities, selected.id)
    : new Set<string>();
  const byId = new Map(activities.map((row) => [row.id, row]));
  const depthOf = (row: TemplateActivity) => {
    let depth = 0;
    let parent = row.parentId;
    while (parent && depth < activities.length) {
      depth++;
      parent = byId.get(parent)?.parentId ?? null;
    }
    return depth;
  };
  const update = (patch: Partial<TemplateActivity>) => {
    setActivities((rows) =>
      rows.map((row) => (row.id === selectedId ? { ...row, ...patch } : row)),
    );
    setError(null);
  };
  const move = (
    id: string,
    target: string | null,
    mode: "before" | "child" | "root",
  ) => {
    try {
      setActivities(moveTemplateActivity(activities, id, target, mode));
      setError(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not move the activity.",
      );
    }
    setDraggedId(null);
  };
  const add = () => {
    const row: TemplateActivity = {
      id: crypto.randomUUID(),
      name: "New activity",
      order: activities.length + 1,
      parentId: null,
      projectStage: selected?.projectStage ?? ProjectStage.Deposit,
      relatedCostLines: [],
      estimatedDays: 5,
      requiredTradeTypeId: null,
    };
    setActivities([...activities, row]);
    setSelectedId(row.id);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetchJson<MilestoneTemplateSnapshot>(
        "/api/admin/milestone-template",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: saved.revision, activities }),
        },
        "Could not save the build sequence.",
      );
      setSaved(response.data);
      setActivities(response.data.activities);
      toast.success("Build sequence saved. New projects will use it.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the build sequence.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-royal-gold-ink">
            Project planning
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Build sequence
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The starting plan for every new project. Drag an activity onto
            another to make it a sub-activity, or use the parent selector.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => window.location.reload()}
          >
            {dirty ? "Discard and reload" : "Reload"}
          </Button>
          <Button variant="outline" disabled={saving} onClick={add}>
            <Plus data-icon="inline-start" /> Add activity
          </Button>
          <Button disabled={!dirty || saving} onClick={save}>
            <Save data-icon="inline-start" />
            {saving ? "Saving…" : "Save sequence"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {activities.length} activities ·{" "}
        {new Set(activities.map((row) => row.projectStage)).size} stages ·{" "}
        {dirty ? "Unsaved changes" : "All changes saved"}. Existing projects
        keep their own plan.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive-ink">
          {error}
        </p>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Activity order</CardTitle>
            <CardDescription>
              Drop on a row to link beneath it. Drop between rows to reorder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol
              className="flex max-h-[65vh] flex-col overflow-y-auto"
              aria-label="Build sequence activities"
            >
              {activities.map((row, index) => (
                <li key={row.id}>
                  {draggedId ? (
                    <div
                      key="drop-before"
                      className="h-3 rounded border border-dashed border-primary/40"
                      aria-label={`Move before ${row.name}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        move(
                          event.dataTransfer.getData("text/plain") || draggedId,
                          row.id,
                          "before",
                        );
                      }}
                    />
                  ) : null}
                  <div
                    key="activity-row"
                    className={cn(
                      "flex items-center gap-2 rounded-md border-b border-border/60 py-2 pr-2",
                      selectedId === row.id && "bg-muted",
                      draggedId
                        && draggedId !== row.id
                        && "hover:bg-warning-light",
                    )}
                    style={{
                      paddingLeft: `${Math.min(depthOf(row), 8) * 16}px`,
                    }}
                    onDragOver={(event) => {
                      if (draggedId !== row.id) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const source =
                        event.dataTransfer.getData("text/plain") || draggedId;
                      if (source) move(source, row.id, "child");
                    }}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      draggable={!saving}
                      disabled={saving}
                      aria-label={`Drag ${row.name}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", row.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedId(row.id);
                      }}
                      onDragEnd={() => setDraggedId(null)}
                    >
                      <GripVertical />
                    </Button>
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      aria-pressed={selectedId === row.id}
                      onClick={() => setSelectedId(row.id)}
                      className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="text-sm font-medium">
                        {row.parentId ? (
                          <CornerDownRight
                            className="mr-1 inline size-3 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : null}
                        {row.name || "Unnamed activity"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatStatus(row.projectStage)} · {row.estimatedDays}{" "}
                        days
                        {row.requiredTradeTypeId
                          ? ` · ${trades.find((trade) => trade.id === row.requiredTradeTypeId)?.label ?? "Required trade"}`
                          : ""}
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div
              className="mt-3 rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const source =
                  event.dataTransfer.getData("text/plain") || draggedId;
                if (source) move(source, null, "root");
              }}
            >
              Drop here to move to the end as a main activity
            </div>
          </CardContent>
        </Card>
        {selected ? (
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle as="h2">Activity details</CardTitle>
              <CardDescription>
                Position {selected.order} ·{" "}
                {selected.parentId ? "Sub-activity" : "Main activity"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset disabled={saving}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="activity-name">
                      Activity name
                    </FieldLabel>
                    <Input
                      id="activity-name"
                      maxLength={200}
                      value={selected.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-stage">
                      Contract stage
                    </FieldLabel>
                    <Select
                      value={selected.projectStage}
                      onValueChange={(value) =>
                        update({ projectStage: value as ProjectStage })
                      }
                    >
                      <SelectTrigger id="activity-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {Object.values(ProjectStage).map((stage) => (
                            <SelectItem key={stage} value={stage}>
                              {formatStatus(stage)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-parent">
                      Parent activity
                    </FieldLabel>
                    <Select
                      value={selected.parentId ?? "none"}
                      onValueChange={(value) =>
                        move(
                          selected.id,
                          value === "none" ? null : value,
                          value === "none" ? "root" : "child",
                        )
                      }
                    >
                      <SelectTrigger id="activity-parent">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">
                            Main activity (no parent)
                          </SelectItem>
                          {activities
                            .filter((row) => !descendants.has(row.id))
                            .map((row) => (
                              <SelectItem key={row.id} value={row.id}>
                                {row.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-days">
                      Estimated days
                    </FieldLabel>
                    <Input
                      id="activity-days"
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      value={
                        Number.isNaN(selected.estimatedDays)
                          ? ""
                          : selected.estimatedDays
                      }
                      onChange={(event) =>
                        update({ estimatedDays: event.target.valueAsNumber })
                      }
                    />
                    <FieldDescription>
                      Calendar days until the next activity&apos;s target. The
                      first activity is due on the project start date.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-trade">
                      Tradie dependency
                    </FieldLabel>
                    <Select
                      value={selected.requiredTradeTypeId ?? "none"}
                      onValueChange={(value) =>
                        update({
                          requiredTradeTypeId: value === "none" ? null : value,
                        })
                      }
                    >
                      <SelectTrigger id="activity-trade">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">
                            No tradie dependency
                          </SelectItem>
                          {trades
                            .filter(
                              (trade) =>
                                !trade.archived
                                || trade.id === selected.requiredTradeTypeId,
                            )
                            .map((trade) => (
                              <SelectItem key={trade.id} value={trade.id}>
                                {trade.label}
                                {trade.archived ? " (archived)" : ""}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      An active milestone warns until a tradie in this category
                      has a confirmed booking for that activity.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-cost-lines">
                      Related offer cost lines
                    </FieldLabel>
                    <TemplateCostLinePicker
                      key={selected.id}
                      id="activity-cost-lines"
                      tasks={costTasks}
                      selected={selected.relatedCostLines}
                      disabled={saving}
                      onChange={(relatedCostLines) =>
                        update({ relatedCostLines })
                      }
                    />
                    <FieldDescription>
                      Select task names from Admin Offer Content → Cost
                      Schedule. These allocate the milestone budget.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </fieldset>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={saving || peerIndex <= 0}
                onClick={() => {
                  move(selected.id, peers[peerIndex - 1].id, "before");
                }}
              >
                <ArrowUp /> Move up
              </Button>
              <Button
                variant="outline"
                disabled={saving || peerIndex >= peers.length - 1}
                onClick={() => {
                  const next = peers[peerIndex + 2];
                  if (next) move(selected.id, next.id, "before");
                  else if (!selected.parentId) move(selected.id, null, "root");
                  else move(selected.id, selected.parentId, "child");
                }}
              >
                <ArrowDown /> Move down
              </Button>
              <Button
                variant="ghost"
                disabled={
                  saving || descendants.size > 1 || activities.length === 1
                }
                onClick={() => {
                  const remaining = activities
                    .filter((row) => row.id !== selected.id)
                    .map((row, index) => ({ ...row, order: index + 1 }));
                  setActivities(remaining);
                  setSelectedId(remaining[0]?.id);
                }}
              >
                <Trash2 /> Remove
              </Button>
              {descendants.size > 1 ? (
                <p className="w-full text-xs text-muted-foreground">
                  Move the sub-activities elsewhere before removing this
                  activity.
                </p>
              ) : null}
            </CardFooter>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
