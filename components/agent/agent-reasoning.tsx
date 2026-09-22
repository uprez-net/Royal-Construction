"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The agent's own reasoning for one step.
 *
 * It opens on its own while the model is thinking so the operator can see the
 * work is live, then collapses once the step is done — the conclusion belongs
 * in the answer, and a wall of retained reasoning buries it.
 */
export function AgentReasoning({
  state,
  text,
}: {
  state: "done" | "streaming" | undefined;
  text: string;
}) {
  const streaming = state === "streaming";
  const [open, setOpen] = useState(streaming);
  const openedByStream = useRef(streaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming) {
      openedByStream.current = true;
      setOpen(true);
      return;
    }
    if (!openedByStream.current) return;
    openedByStream.current = false;
    setOpen(false);
  }, [streaming]);

  useEffect(() => {
    if (!streaming) return;
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [streaming, text]);

  if (!text.trim()) return null;

  return (
    <Collapsible
      className="rounded-lg border border-border/60 bg-muted/25"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <Brain
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", streaming && "animate-pulse")}
        />
        <span>{streaming ? "Thinking…" : "Thought process"}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="max-h-56 overflow-y-auto overscroll-contain border-t border-border/60 px-3 py-2"
          ref={scrollRef}
        >
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {text}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
