"use client";

import type { DragEvent } from "react";
import { ProjectStage } from "@prisma/client";
import {
  ChevronRight,
  CornerDownRight,
  GripVertical,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TradeIconGlyph } from "@/components/tradie-management/trade-icon";
import {
  buildMilestoneTree,
  groupRootsByStage,
  type WithChildren,
} from "@/lib/projects/milestone-tree";
import { templateDescendants } from "@/lib/domain/projects/template-tree";
import { cn } from "@/lib/utils";
import { formatStatus } from "@/utils/formatters";
import type { TemplateActivity } from "@/types/milestone-template";
import type { TradeTypeAdminRow } from "@/types/trade-type";

export function TemplateActivityTree({
  activities,
  trades,
  selectedId,
  draggedId,
  disabled,
  onSelect,
  onDrag,
  onMove,
  closedStages,
  closedParents,
  onStageOpenChange,
  onParentOpenChange,
}: {
  activities: TemplateActivity[];
  trades: TradeTypeAdminRow[];
  selectedId?: string;
  draggedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onDrag: (id: string | null) => void;
  onMove: (
    id: string,
    target: string | null,
    mode: "before" | "child" | "root",
  ) => void;
  closedStages: ReadonlySet<ProjectStage>;
  closedParents: ReadonlySet<string>;
  onStageOpenChange: (stage: ProjectStage, open: boolean) => void;
  onParentOpenChange: (id: string, open: boolean) => void;
}) {
  const grouped = groupRootsByStage(buildMilestoneTree(activities));
  const draggedBranch = draggedId
    ? templateDescendants(activities, draggedId)
    : new Set<string>();

  const openParentOnDrag = (event: DragEvent, id: string) => {
    if (disabled || !draggedId || draggedBranch.has(id)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (closedParents.has(id)) onParentOpenChange(id, true);
  };
  const drop = (
    event: DragEvent,
    target: string | null,
    mode: "before" | "child" | "root",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    const source = event.dataTransfer.getData("text/plain") || draggedId;
    if (source) onMove(source, target, mode);
  };
  const renderActivity = (row: WithChildren<TemplateActivity>, depth = 0) => {
    const hasChildren = row.childrenMilestones.length > 0;
    const open = !closedParents.has(row.id);
    const required = trades.filter((trade) =>
      row.requiredTradeTypeIds.includes(trade.id),
    );
    return (
      <li key={row.id}>
        <Collapsible
          open={open}
          onOpenChange={(nextOpen) => onParentOpenChange(row.id, nextOpen)}
        >
          {draggedId && !draggedBranch.has(row.id) ? (
            <div
              key="drop-before"
              className="h-3 rounded border border-dashed border-primary/40"
              aria-label={`Move before ${row.name}`}
              onDragOver={(event) => {
                if (!disabled) event.preventDefault();
              }}
              onDrop={(event) => drop(event, row.id, "before")}
            />
          ) : null}
          <div
            key="activity-row"
            data-activity-id={row.id}
            className={cn(
              "flex items-center gap-1 rounded-md border-b border-border/60 py-2 pr-2",
              selectedId === row.id && "bg-muted",
              draggedId
                && !draggedBranch.has(row.id)
                && "hover:bg-warning-light",
            )}
            style={{ paddingLeft: `${Math.min(depth, 6) * 12}px` }}
            onDragOver={(event) => openParentOnDrag(event, row.id)}
            onDrop={(event) => drop(event, row.id, "child")}
          >
            <Button
              size="icon"
              variant="ghost"
              draggable={!disabled}
              disabled={disabled}
              aria-label={`Drag ${row.name}`}
              className="hidden md:inline-flex"
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", row.id);
                event.dataTransfer.effectAllowed = "move";
                onDrag(row.id);
              }}
              onDragEnd={() => onDrag(null)}
            >
              <GripVertical />
            </Button>
            {hasChildren ? (
              <CollapsibleTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${open ? "Collapse" : "Expand"} ${row.name} sub-activities`}
                >
                  <ChevronRight
                    className={cn(
                      "transition-transform motion-reduce:transition-none",
                      open && "rotate-90",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            ) : (
              <span className="w-8 shrink-0" aria-hidden="true" />
            )}
            <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
              {row.order}
            </span>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={selectedId === row.id}
              onClick={() => onSelect(row.id)}
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
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {formatStatus(row.projectStage)} · {row.estimatedDays} days
                </span>
                {required.map((trade) => (
                  <span
                    key={trade.id}
                    className="inline-flex items-center gap-1"
                  >
                    <TradeIconGlyph icon={trade.icon} className="size-3" />
                    {trade.label}
                  </span>
                ))}
                {hasChildren ? (
                  <span>{row.childrenMilestones.length} sub-activities</span>
                ) : null}
              </span>
            </button>
          </div>
          {hasChildren ? (
            <CollapsibleContent>
              <ol aria-label={`${row.name} sub-activities`}>
                {row.childrenMilestones.map((child) =>
                  renderActivity(child, depth + 1),
                )}
              </ol>
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      </li>
    );
  };
  return (
    <div
      className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
      role="region"
      aria-label="Build sequence activities"
    >
      {Object.values(ProjectStage).map((stage, index) => {
        const roots = grouped[stage] ?? [];
        const count = (rows: WithChildren<TemplateActivity>[]): number =>
          rows.reduce(
            (total, row) => total + 1 + count(row.childrenMilestones),
            0,
          );
        const open = !closedStages.has(stage);
        return (
          <Collapsible
            key={stage}
            open={open}
            onOpenChange={(nextOpen) => onStageOpenChange(stage, nextOpen)}
            className="rounded-lg border border-border/70"
            data-stage={stage}
          >
            <h3
              onDragOver={(event) => {
                if (!draggedId || disabled) return;
                event.preventDefault();
                if (!open) onStageOpenChange(stage, true);
              }}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Layers
                  className="size-4 shrink-0 text-royal-gold-ink"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {formatStatus(stage)}
                </span>
                <Badge variant="secondary">{count(roots)}</Badge>
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                    open && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent>
              {roots.length ? (
                <ol
                  aria-label={`${formatStatus(stage)} activities`}
                  className="px-1 pb-1"
                >
                  {roots.map((row) => renderActivity(row))}
                </ol>
              ) : (
                <p className="p-4 text-xs text-muted-foreground">
                  No main activities in this stage.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      <div
        className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground"
        onDragOver={(event) => {
          if (draggedId && !disabled) event.preventDefault();
        }}
        onDrop={(event) => drop(event, null, "root")}
      >
        Drop here to move to the end as a main activity
      </div>
    </div>
  );
}
