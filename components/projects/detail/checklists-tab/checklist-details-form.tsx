"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateChecklistDetailsAction } from "@/lib/data/checklist-actions";
import type { ChecklistDetail } from "@/lib/domain/projects/checklists";

import type { TrackSave } from "./checklist-save-state";

/** Checked and completed by, and Additional Comments: saved as typed. */
export function ChecklistDetailsForm({
  checklist,
  projectId,
  readOnly,
  track,
  onSaved,
}: {
  checklist: ChecklistDetail;
  projectId: string;
  readOnly: boolean;
  track: TrackSave;
  /** Refetch, so the revision a later close is checked against is current. */
  onSaved: () => void;
}) {
  const [comments, setComments] = useState(checklist.comments ?? "");
  const [checkedBy, setCheckedBy] = useState(checklist.checkedBy ?? "");
  const saved = useRef({
    checkedBy: checklist.checkedBy ?? "",
    comments: checklist.comments ?? "",
  });

  useEffect(() => {
    if (readOnly) return;
    if (
      comments === saved.current.comments
      && checkedBy === saved.current.checkedBy
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void track(async () => {
        const result = await updateChecklistDetailsAction({
          checkedBy,
          checklistId: checklist.id,
          comments,
          projectId,
        });
        if (!result.ok) throw new Error(result.error);
        saved.current = { checkedBy, comments };
        onSaved();
      }).catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "The comments did not save.",
        ),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [checkedBy, checklist.id, comments, onSaved, projectId, readOnly, track]);

  return (
    <Card className="grid gap-4 rounded-xl border-border/70 p-4 shadow-sm">
      <div className="space-y-1.5">
        <Label htmlFor="checklist-checked-by">Checked and completed by</Label>
        <Input
          id="checklist-checked-by"
          value={checkedBy}
          maxLength={120}
          disabled={readOnly}
          onChange={(event) => setCheckedBy(event.target.value)}
          className="max-w-md"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="checklist-comments">Additional comments</Label>
        <Textarea
          id="checklist-comments"
          value={comments}
          rows={4}
          maxLength={5000}
          disabled={readOnly}
          onChange={(event) => setComments(event.target.value)}
        />
      </div>
    </Card>
  );
}
