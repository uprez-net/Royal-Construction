"use client";

import { ShieldCheck, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { closureBlockers } from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistIssueView,
  ChecklistItemView,
} from "@/lib/domain/projects/checklists";

import { formatDateTime } from "./checklist-client";

// The foot of the inspection screen: what still stands between the checklist
// and closing it, or, once closed, who signed it off and when.

export function SignOffPanel({
  checklist,
  blockers,
  isAdmin,
  onClose,
  onReopen,
}: {
  checklist: ChecklistDetail;
  blockers: ReturnType<
    typeof closureBlockers<ChecklistItemView, ChecklistIssueView>
  >;
  isAdmin: boolean;
  onClose: () => void;
  onReopen: () => void;
}) {
  if (checklist.status === "CLOSED") {
    return (
      <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ShieldCheck className="size-4 text-success-ink" aria-hidden="true" />
          Reviewer sign-off
        </h3>
        {checklist.closure ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Name of the reviewer
              </p>
              <p className="font-medium text-foreground">
                {checklist.closure.reviewerName}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Signature</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL */}
              <img
                src={checklist.closure.signatureDataUrl}
                alt={`Signature of ${checklist.closure.reviewerName}`}
                className="mt-1 h-16 rounded border border-border/70 bg-card object-contain"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium text-foreground">
                {formatDateTime(checklist.closure.signedAt)}
              </p>
            </div>
          </div>
        ) : null}
        {isAdmin ? (
          <div>
            <Button variant="outline" size="sm" onClick={onReopen}>
              <Unlock className="size-4" aria-hidden="true" />
              Reopen checklist
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  const unreviewedBySection = new Map<string, number>();
  for (const item of blockers.unreviewed) {
    unreviewedBySection.set(
      item.section,
      (unreviewedBySection.get(item.section) ?? 0) + 1,
    );
  }

  return (
    <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        Reviewer sign-off
      </h3>
      {blockers.canClose ? (
        <p className="text-sm text-muted-foreground">
          Every item is reviewed and every issue is verified. Sign to close the
          checklist.
        </p>
      ) : (
        <div className="grid gap-2 text-sm">
          <p className="font-medium text-foreground">
            The checklist can be closed once:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {blockers.unreviewed.length > 0 ? (
              <li>
                {blockers.unreviewed.length} inspection item
                {blockers.unreviewed.length === 1 ? " is" : "s are"} reviewed (
                {[...unreviewedBySection.entries()]
                  .map(([section, count]) => `${section} ${count}`)
                  .join(", ")}
                )
              </li>
            ) : null}
            {blockers.unresolved.length > 0 ? (
              <li>
                Open or in-progress issues are resolved:{" "}
                {blockers.unresolved.map((issue, index) => (
                  <span key={issue.id}>
                    {index > 0 ? ", " : ""}
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`#checklist-issue-${issue.id}`}
                    >
                      #{issue.number}
                    </a>
                  </span>
                ))}
              </li>
            ) : null}
            {blockers.awaitingVerification.length > 0 ? (
              <li>
                Resolved issues are verified by the reviewer:{" "}
                {blockers.awaitingVerification.map((issue, index) => (
                  <span key={issue.id}>
                    {index > 0 ? ", " : ""}
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`#checklist-issue-${issue.id}`}
                    >
                      #{issue.number}
                    </a>
                  </span>
                ))}
              </li>
            ) : null}
          </ul>
        </div>
      )}
      <div>
        <Button disabled={!blockers.canClose} onClick={onClose}>
          <ShieldCheck className="size-4" aria-hidden="true" />
          Close checklist
        </Button>
      </div>
    </Card>
  );
}
