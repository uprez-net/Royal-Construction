"use client";

import { ChevronDown, Flag } from "lucide-react";

import { Card } from "@/components/ui/card";
import { isBlockingIssue } from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistIssueView,
  ChecklistItemView,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";
import type { ChecklistItemState } from "@prisma/client";

import { ChecklistItemRow } from "./checklist-item-row";
import type { TrackSave } from "./checklist-save-state";

// One room of the inspection: collapsible, with how many of its rows are
// reviewed and how many are flagged by an open issue.

export function ChecklistSectionCard({
  section,
  issuesById,
  isOpen,
  onToggle,
  readOnly,
  projectId,
  checklistId,
  onState,
  onNotApplicable,
  onRaiseIssue,
  track,
}: {
  section: ChecklistDetail["sections"][number];
  issuesById: ReadonlyMap<string, ChecklistIssueView>;
  isOpen: boolean;
  onToggle: () => void;
  readOnly: boolean;
  projectId: string;
  checklistId: string;
  onState: (item: ChecklistItemView, state: ChecklistItemState) => void;
  onNotApplicable: (item: ChecklistItemView) => void;
  onRaiseIssue: (item: ChecklistItemView) => void;
  track: TrackSave;
}) {
  const reviewed = section.items.filter(
    (item) => item.state !== "UNCHECKED",
  ).length;
  const flagged = section.items.filter((item) =>
    item.issueIds.some((id) => {
      const issue = issuesById.get(id);
      return issue ? isBlockingIssue(issue.status) : false;
    }),
  ).length;
  const bodyId = `checklist-section-${section.items[0]?.id}`;
  return (
    <Card className="overflow-hidden rounded-xl border-border/70 p-0 shadow-sm">
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="flex-1 font-semibold text-foreground">
          {section.section}
        </span>
        {flagged > 0 ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-destructive-ink">
            <Flag className="size-3.5" aria-hidden="true" />
            {flagged} flagged
          </span>
        ) : null}
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            reviewed === section.items.length
              ? "text-success-ink"
              : "text-muted-foreground",
          )}
        >
          {reviewed}/{section.items.length}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <ul
          id={bodyId}
          className="list-none divide-y divide-border/70 border-t border-border/70"
        >
          {section.items.map((item) => (
            <ChecklistItemRow
              key={item.id}
              item={item}
              issues={item.issueIds
                .map((id) => issuesById.get(id))
                .filter((issue): issue is ChecklistIssueView => !!issue)}
              readOnly={readOnly}
              projectId={projectId}
              checklistId={checklistId}
              onState={(state) => onState(item, state)}
              onNotApplicable={() => onNotApplicable(item)}
              onRaiseIssue={() => onRaiseIssue(item)}
              track={track}
            />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
