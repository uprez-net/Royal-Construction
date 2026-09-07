"use client";

import { FileStack } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";

/**
 * The development-application block, before it exists.
 *
 * Rendered only while a DA_APPROVAL_REQUIRED alert is open, which is the point
 * at which the job stops being a CDC and this becomes the path it is actually
 * on. What that path needs is not settled yet: most of the documents flow in
 * from the required pack and are read-only here — a plan cannot be replaced in
 * two places — but the extra ones the council asks for on top have not been
 * pinned down, so there is nothing honest to render.
 *
 * A stated placeholder rather than nothing at all. An admin who has just been
 * told the job needs a DA, and then sees no DA anywhere on the screen, has to
 * assume the system does not know — which is worse than it saying so.
 *
 * TODO: the DA document list. Two halves, and only the second is new work here:
 *   - Documents carried over from the required pack. Read-only in this list,
 *     and their rows in the pack need a gate so the same file does not offer a
 *     Replace button in two places that would then disagree.
 *   - The council's own extra requirements, once the list is confirmed.
 */
export function DaApprovalSection({ className }: { className?: string }) {
  return (
    <Card
      className={`gap-0 self-start overflow-hidden border-dashed bg-muted/20 py-0 shadow-none ${className ?? ""}`}
    >
      <div className="flex w-full items-start gap-3 px-4 py-3 text-left opacity-70">
        <FileStack
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-sm leading-snug font-medium text-foreground">
              Development application
            </span>
            <StatusPill tone="neutral">Coming soon</StatusPill>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            The documents the council needs for the DA.
          </span>
        </span>
      </div>

      <div className="relative border-t border-border/70">
        <div aria-hidden="true" className="space-y-4 px-4 py-4 select-none">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-start gap-3">
              <span className="mt-0.5 size-4 shrink-0 rounded bg-muted" />
              <span className="min-w-0 flex-1 space-y-2">
                <span
                  className="block h-3.5 rounded-full bg-muted"
                  style={{ width: `${72 - row * 9}%` }}
                />
                <span
                  className="block h-2.5 rounded-full bg-muted/70"
                  style={{ width: `${48 - row * 6}%` }}
                />
              </span>
              <span className="h-7 w-20 shrink-0 rounded-md bg-muted" />
            </div>
          ))}
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/30 px-6 text-center backdrop-blur-[3px]">
          <p className="font-medium text-foreground">Coming soon</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Most of this list carries over from the documents already collected
            above. The council&apos;s extra requirements are still being
            confirmed.
          </p>
        </div>
      </div>
    </Card>
  );
}
