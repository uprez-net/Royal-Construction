"use client";

import { useEffect, useState, type RefObject } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentPendingApproval } from "@/components/agent/agent-reducer";

/**
 * A standing reminder that the agent is blocked on a person.
 *
 * An approval can scroll out of view while the operator reads further up the
 * transcript, and the session simply waits. With two or three people and no
 * one watching the runtime, a silently parked turn looks identical to a slow
 * one, so the pending count stays pinned until it is answered.
 */
export function AgentApprovalBar({
  approvals,
  viewportRef,
}: {
  approvals: readonly AgentPendingApproval[];
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  // Set only from the observer callback, which reports the current state as
  // soon as it starts observing.
  const [offscreen, setOffscreen] = useState(false);
  const target = approvals[0];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!target || !viewport) return;
    const element = viewport.querySelector(
      `[data-approval-id="${CSS.escape(target.requestId)}"]`,
    );
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry?.isIntersecting),
      { root: viewport, threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, viewportRef]);

  if (!target || !offscreen) return null;

  const label =
    approvals.length === 1
      ? target.kind === "tool-approval"
        ? "An operation is waiting for your approval"
        : target.kind === "session-limit"
          ? "The session has reached a limit"
          : "The agent asked you a question"
      : `${approvals.length} requests are waiting for you`;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-3 rounded-full border border-royal-gold/50 bg-white/95 py-1.5 pr-1.5 pl-3 shadow-lg backdrop-blur">
        <ShieldAlert
          aria-hidden="true"
          className="size-4 shrink-0 text-royal-gold-ink"
        />
        <span className="truncate text-xs font-medium text-foreground">
          {label}
        </span>
        <Button
          className="rounded-full"
          onClick={() => {
            viewportRef.current
              ?.querySelector(
                `[data-approval-id="${CSS.escape(target.requestId)}"]`,
              )
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          size="xs"
          type="button"
        >
          Review
        </Button>
      </div>
    </div>
  );
}
