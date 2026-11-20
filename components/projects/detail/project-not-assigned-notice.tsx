import { Info } from "lucide-react";

/**
 * Said to a caller who may read this project but not record on it: a site
 * manager on a project whose Site manager field names someone else, or nobody
 * (#568). The rule is `canRecordOnProject`; this replaces actions that would
 * only be refused with the one thing that changes the answer.
 */
export function ProjectNotAssignedNotice({
  what = "record on this project",
}: {
  /** What they cannot do here, finishing "You can view it but cannot …". */
  what?: string;
}) {
  return (
    <aside
      role="note"
      aria-label="Not assigned to this project"
      className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        You are not this project&apos;s site manager, so you can view it but
        cannot {what}. Ask the office to set you as Site manager on the project
        to record here.
      </p>
    </aside>
  );
}
