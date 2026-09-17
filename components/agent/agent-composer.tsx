"use client";

import type { RefObject } from "react";
import { Send } from "lucide-react";
import { AgentAnnotations } from "@/components/agent/agent-annotations";
import type { AgentAnnotation } from "@/components/agent/agent-annotations";
import { AgentAttachments } from "@/components/agent/agent-attachments";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export function AgentComposer({
  annotations,
  annotationQuery,
  annotationResults,
  attachments,
  canSend,
  composer,
  composerRef,
  disabled,
  editingMessageId,
  onCancelEdit,
  onChange,
  onSend,
  selectAnnotation,
  setAnnotations,
  setAttachments,
}: {
  annotations: AgentAnnotation[];
  annotationQuery: string;
  annotationResults: AgentAnnotation[];
  attachments: File[];
  canSend: boolean;
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  editingMessageId: string | null;
  onCancelEdit: () => void;
  onChange: (value: string) => void;
  onSend: () => void;
  selectAnnotation: (annotation: AgentAnnotation) => void;
  setAnnotations: React.Dispatch<React.SetStateAction<AgentAnnotation[]>>;
  setAttachments: React.Dispatch<React.SetStateAction<File[]>>;
}) {
  return (
    <footer className="relative z-10 order-3 shrink-0 border-t border-border/70 bg-white p-3 sm:p-4 md:col-start-2">
      <form
        className="relative mx-auto max-w-4xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        {editingMessageId ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-royal-gold/30 bg-royal-gold-light/35 px-3 py-2 text-xs text-muted-foreground">
            <span>
              Editing a previous message. Send it to start a new turn.
            </span>
            <Button
              onClick={onCancelEdit}
              size="xs"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : null}
        <AgentAnnotations
          annotations={annotations}
          setAnnotations={setAnnotations}
          annotationResults={annotationResults}
          annotationQuery={annotationQuery}
          selectAnnotation={selectAnnotation}
        />
        <InputGroup className="rounded-xl bg-muted/20 shadow-xs">
          <InputGroupTextarea
            aria-label="Message the operations agent"
            className={cn(
              "min-h-20 max-h-40 px-3",
              annotations.length > 0 ? "pt-12" : "pt-3",
            )}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder="Ask about a lead, offer, task or project…"
            ref={composerRef}
            value={composer}
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <AgentAttachments
                attachments={attachments}
                setAttachments={setAttachments}
              />
              <span className="hidden shrink-0 sm:inline">
                Enter to send · Shift+Enter for a new line · @ to reference
              </span>
            </span>
            <Button
              aria-label="Send message"
              disabled={!canSend}
              size="icon-sm"
              type="submit"
            >
              <Send data-icon="inline-start" />
            </Button>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Live business data is permission-scoped. Confirm important details
          before acting.
        </p>
      </form>
    </footer>
  );
}
