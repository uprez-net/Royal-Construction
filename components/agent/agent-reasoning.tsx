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
 * Closed unless the reader opens it, even while the model is thinking: the
 * pulsing "Thinking…" header is enough to show the work is live. Streaming it
 * open put the model's working — record ids included ("User confirms moving
 * lead 100…") — in front of the office on every step (#429). The conclusion
 * belongs in the answer.
 */
export function AgentReasoning({
  state,
  text,
}: {
  state: "done" | "streaming" | undefined;
  text: string;
}) {
  const streaming = state === "streaming";
  // Whatever the reader last chose; closed until they choose.
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streaming || !open) return;
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [open, streaming, text]);

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
