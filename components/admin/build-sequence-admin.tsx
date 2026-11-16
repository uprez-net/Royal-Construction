"use client";

import { useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ProjectStage } from "@prisma/client";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  Layers,
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
import { DEFAULT_ACTIVITY_DURATION_DAYS } from "@/lib/domain/projects/milestone-schedule";
import { TemplateActivityTree } from "./template-activity-tree";
import { TemplateMultiSelect } from "./template-multi-select";
import { TemplateSingleSelect } from "./template-single-select";
import { TradeIconGlyph } from "@/components/tradie-management/trade-icon";
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
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [closedStages, setClosedStages] = useState<Set<ProjectStage>>(
    new Set(),
  );
  const [closedParents, setClosedParents] = useState<Set<string>>(new Set());
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
  const revealActivity = (rows: TemplateActivity[], id: string) => {
    const lookup = new Map(rows.map((row) => [row.id, row]));
    let row = lookup.get(id);
    const parents = new Set<string>();
    while (row?.parentId) {
      parents.add(row.parentId);
      row = lookup.get(row.parentId);
    }
    const stage = row?.projectStage;
    if (stage)
      setClosedStages(
        (previous) => new Set([...previous].filter((value) => value !== stage)),
      );
    setClosedParents(
      (previous) =>
        new Set([...previous].filter((value) => !parents.has(value))),
    );
  };
  const update = (patch: Partial<TemplateActivity>) => {
    const updated = activities.map((row) =>
      row.id === selectedId ? { ...row, ...patch } : row,
    );
    setActivities(updated);
    if (patch.projectStage && selectedId) revealActivity(updated, selectedId);
    setError(null);
  };
  const move = (
    id: string,
    target: string | null,
    mode: "before" | "child" | "root",
  ) => {
    try {
      const moved = moveTemplateActivity(activities, id, target, mode);
      setActivities(moved);
      revealActivity(moved, id);
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
      estimatedDays: DEFAULT_ACTIVITY_DURATION_DAYS,
      requiredTradeTypeIds: [],
    };
    setActivities([...activities, row]);
    setSelectedId(row.id);
    revealActivity([...activities, row], row.id);
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
  const activityTree = (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Activity order</CardTitle>
        <CardDescription>
          Drop on a row to link beneath it. Drop between rows to reorder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TemplateActivityTree
          activities={activities}
          trades={trades}
          selectedId={selectedId}
          draggedId={draggedId}
          disabled={saving}
          onSelect={(id) => {
            setSelectedId(id);
            revealActivity(activities, id);
            setActivityPickerOpen(false);
          }}
          onDrag={setDraggedId}
          onMove={move}
          closedStages={closedStages}
          closedParents={closedParents}
          onStageOpenChange={(stage, open) =>
            setClosedStages((previous) => {
              const next = new Set(previous);
              if (open) next.delete(stage);
              else next.add(stage);
              return next;
            })
          }
          onParentOpenChange={(id, open) =>
            setClosedParents((previous) => {
              const next = new Set(previous);
              if (open) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      </CardContent>
    </Card>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
        <div className="hidden lg:block">{activityTree}</div>
        <div className="lg:hidden">
          <Sheet
            open={activityPickerOpen && !isDesktop}
            onOpenChange={setActivityPickerOpen}
          >
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Selected activity · {selected?.order} of {activities.length}
              </p>
              <p className="break-words font-semibold">
                {selected?.name || "Choose an activity"}
              </p>
              <SheetTrigger asChild>
                <Button variant="outline">Choose activity to edit</Button>
              </SheetTrigger>
            </div>
            <SheetContent
              side="bottom"
              className="flex max-h-[90dvh] flex-col gap-4 overflow-hidden rounded-t-xl p-4"
            >
              <SheetHeader>
                <SheetTitle>Build sequence activities</SheetTitle>
                <SheetDescription>
                  Select an activity to edit its details.
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 overflow-y-auto overscroll-contain">
                {activityTree}
              </div>
            </SheetContent>
          </Sheet>
        </div>
        {selected ? (
          <Card className="min-w-0 lg:sticky lg:top-6">
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
                    <TemplateSingleSelect
                      key={`parent-${selected.id}`}
                      id="activity-parent"
                      value={selected.parentId ?? "none"}
                      disabled={saving}
                      searchLabel="Search parent activities"
                      emptyLabel="No matching parent activities."
                      options={[
                        {
                          id: "none",
                          label: "Main activity (no parent)",
                          icon: <Layers />,
                          group: "Placement",
                        },
                        ...activities
                          .filter((row) => !descendants.has(row.id))
                          .map((row) => ({
                            id: row.id,
                            label: row.name || "Unnamed activity",
                            description: `Activity ${row.order}${row.parentId ? ` · Under ${byId.get(row.parentId)?.name ?? "parent activity"}` : " · Main activity"}`,
                            group: formatStatus(row.projectStage),
                            icon: row.parentId ? (
                              <CornerDownRight />
                            ) : (
                              <Layers />
                            ),
                          })),
                      ]}
                      onChange={(value) =>
                        move(
                          selected.id,
                          value === "none" ? null : value,
                          value === "none" ? "root" : "child",
                        )
                      }
                    />
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
                      Calendar days this activity takes. It is due this many
                      days after the activity before it closes; the first one
                      counts from the project start date. Changing it updates
                      every project activity not yet completed.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-trade">
                      Tradie dependencies
                    </FieldLabel>
                    <TemplateMultiSelect
                      key={`trade-${selected.id}`}
                      id="activity-trade"
                      value={selected.requiredTradeTypeIds}
                      disabled={saving}
                      placeholder="No tradie dependency"
                      noun={["tradie category", "tradie categories"]}
                      searchLabel="Search tradie categories"
                      emptyLabel="No matching tradie categories."
                      options={trades
                        .filter(
                          (trade) =>
                            !trade.archived
                            || selected.requiredTradeTypeIds.includes(trade.id),
                        )
                        .map((trade) => ({
                          id: trade.id,
                          label: trade.label,
                          description: trade.archived
                            ? "Archived category · current dependency"
                            : undefined,
                          icon: <TradeIconGlyph icon={trade.icon} />,
                          group: "Tradie categories",
                        }))}
                      onChange={(requiredTradeTypeIds) =>
                        update({ requiredTradeTypeIds })
                      }
                    />
                    <FieldDescription>
                      An active milestone warns until each selected category has
                      a confirmed booking for that activity.
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
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm lg:hidden">
        <span className="text-sm text-muted-foreground">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save sequence"}
        </Button>
      </div>
    </div>
  );
}
