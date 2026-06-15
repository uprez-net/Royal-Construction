"use client";

import { Loader2, XCircle } from "lucide-react";
import { ToolState, ToolType } from "@/types/chat";
import {
  hasToolOutput,
  hasToolState,
  isToolPart,
  toolNameFromType,
} from "@/utils/chat";
import { ToolOutput } from "./tools/tool-output";

interface ToolResultProps {
  part: ToolType;
}

/**
 * ToolResult component renders tool execution states and outputs for AI agents.
 * Handles different states: pending, partial-call, call, output-available, output-error.
 */
export function ToolResult({ part }: ToolResultProps) {
  // Only render tool-* parts
  if (!isToolPart(part)) return null;

  const toolName = toolNameFromType(part.type);

  // Must have a known/valid tool state
  if (!hasToolState(part)) return null;

  switch (part.state as ToolState) {
    case "pending":
    case "partial-call":
    case "call":
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--royal-gold)]" />
          <span>Running {toolName}...</span>
        </div>
      );

    case "output-available":
      if (!hasToolOutput(part)) return null;
      return <ToolOutput toolName={toolName} output={part.output} />;

    case "output-error":
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--destructive)]/30 bg-[color:var(--destructive-light)] px-3 py-2 text-sm text-[color:var(--destructive)] shadow-sm">
          <XCircle className="h-4 w-4" />
          <span>{toolName} failed</span>
        </div>
      );

    default:
      return null;
  }
}
