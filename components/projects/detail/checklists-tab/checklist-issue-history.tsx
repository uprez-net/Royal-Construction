"use client";

import { AlertTriangle, ChevronDown, History } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ISSUE_STATUS_LABELS } from "@/lib/domain/projects/checklist-rules";
import type { ChecklistIssueView } from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";

import { formatDateTime } from "./checklist-client";

// An issue's history, and the line saying whether its tradie was told.

export function IssueHistory({
  events,
}: {
  events: ChecklistIssueView["events"];
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="ghost"
        className="px-1 text-muted-foreground"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((open) => !open)}
      >
        <History className="size-4" aria-hidden="true" />
        History ({events.length})
        <ChevronDown
          className={cn(
            "size-4 transition-transform",
            historyOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </Button>
      {historyOpen ? (
        <ol className="mt-1 list-none space-y-1.5 border-l-2 border-border pl-3 text-xs">
          {events.map((event) => (
            <li key={event.id}>
              <span className="font-mono text-muted-foreground">
                {formatDateTime(event.createdAt)}
              </span>{" "}
              <span className="font-medium text-foreground">
                {event.actorName ?? "System"}
              </span>{" "}
              <span className="text-muted-foreground">
                {describeEvent(event)}
              </span>
              {event.note ? (
                <span className="block whitespace-pre-wrap text-foreground">
                  {event.note}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function NotificationState({ issue }: { issue: ChecklistIssueView }) {
  if (issue.notificationStatus === "SENT") {
    return (
      <p className="text-sm text-success-ink">
        Emailed {issue.notifiedTo}
        {issue.notifiedAt ? `, ${formatDateTime(issue.notifiedAt)}` : ""}
      </p>
    );
  }
  if (issue.notificationStatus === "FAILED") {
    return (
      <p className="flex items-start gap-1 text-sm text-destructive-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{issue.notificationError ?? "The last email was not sent."}</span>
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {issue.assignedTradie ? "Not emailed yet" : "Unassigned – nobody emailed"}
    </p>
  );
}

function describeEvent(event: ChecklistIssueView["events"][number]): string {
  switch (event.kind) {
    case "CREATED":
      return "raised the issue";
    case "STATUS_CHANGED":
      return event.fromStatus && event.toStatus
        ? `moved it from ${ISSUE_STATUS_LABELS[event.fromStatus].toLowerCase()} to ${ISSUE_STATUS_LABELS[event.toStatus].toLowerCase()}`
        : "changed its status";
    case "ASSIGNED":
      return "changed the assigned tradie";
    case "COMMENT":
      return "commented";
    case "EMAIL_SENT":
      return "sent the email";
    case "EMAIL_FAILED":
      return "tried to send the email; it failed";
    case "EVIDENCE_ADDED":
      return "added photos";
  }
}
