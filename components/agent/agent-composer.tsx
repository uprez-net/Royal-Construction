"use client";

import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { AtSign, LoaderCircle, Paperclip, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AgentMentionMenu } from "@/components/agent/agent-mention-menu";
import {
  applyMention,
  composerKeyAction,
  findMentionTrigger,
  useMentionSearch,
  MAX_ANNOTATIONS,
  type AgentAnnotation,
} from "@/components/agent/agent-mentions";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const ACCEPTED_FILES = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv";
const MAX_ATTACHMENTS = 5;

/**
 * The message input.
 *
 * Everything the turn will carry — its text, its references and its files — is
 * laid out in normal flow above the field. The previous build floated the
 * reference chips over the textarea on an absolutely positioned layer and
 * padded the field to compensate, so a second row of chips sat on top of the
 * message being typed.
 */
export function AgentComposer({
  annotations,
  attachments,
  canSend,
  composer,
  composerRef,
  disabled,
  editingMessageId,
  onCancelEdit,
  onChange,
  onSend,
  setAnnotations,
  setAttachments,
  uploading,
}: {
  annotations: AgentAnnotation[];
  attachments: File[];
  canSend: boolean;
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  editingMessageId: string | null;
  onCancelEdit: () => void;
  onChange: (value: string) => void;
  onSend: () => void;
  setAnnotations: React.Dispatch<React.SetStateAction<AgentAnnotation[]>>;
  setAttachments: React.Dispatch<React.SetStateAction<File[]>>;
  uploading: boolean;
}) {
  const listboxId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);

  const trigger = useMemo(
    () => findMentionTrigger(composer, caret),
    [caret, composer],
  );
  // Escape dismisses the token the caret is in, not "the current query": typing
  // another character used to revive the menu because the dismissal was keyed
  // on the query string.
  const menuOpen = trigger !== null && dismissedAt !== trigger.start;
  const search = useMentionSearch(menuOpen ? trigger.query : null);
  const results = search.results;
  const atLimit = annotations.length >= MAX_ANNOTATIONS;

  function syncCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length);
    setActiveIndex(0);
  }

  function addFiles(files: FileList | readonly File[] | null) {
    const incoming = files ? Array.from(files) : [];
    if (incoming.length === 0) return;
    setAttachments((items) => {
      const room = MAX_ATTACHMENTS - items.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        return items;
      }
      if (incoming.length > room)
        toast.error(`Only ${room} more file${room === 1 ? "" : "s"} can fit.`);
      return [...items, ...incoming.slice(0, room)];
    });
  }

  function selectMention(annotation: AgentAnnotation) {
    if (!trigger) return;
    const already = annotations.some(
      (item) => item.id === annotation.id && item.type === annotation.type,
    );
    if (!already && atLimit) {
      toast.error(`A message can reference up to ${MAX_ANNOTATIONS} records.`);
      return;
    }
    // The label stays in the message as text. Deleting the token and showing
    // only a detached chip left no trace of what the sentence was pointing at.
    const next = applyMention(composer, trigger, annotation.label);
    onChange(next.value);
    if (!already) setAnnotations((items) => [...items, annotation]);
    setDismissedAt(null);
    window.requestAnimationFrame(() => {
      const element = composerRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  function openMentionPicker() {
    const element = composerRef.current;
    if (!element) return;
    const at = element.selectionStart ?? composer.length;
    const needsSpace = at > 0 && !/\s/.test(composer[at - 1] ?? "");
    const insert = `${needsSpace ? " " : ""}@`;
    const value = composer.slice(0, at) + insert + composer.slice(at);
    onChange(value);
    setDismissedAt(null);
    window.requestAnimationFrame(() => {
      const next = at + insert.length;
      element.focus();
      element.setSelectionRange(next, next);
      setCaret(next);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerKeyAction(
      {
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        shiftKey: event.shiftKey,
      },
      { menuOpen, resultCount: results.length },
    );
    if (action.kind === "ignore") return;
    event.preventDefault();
    switch (action.kind) {
      case "move":
        setActiveIndex(
          (index) => (index + action.delta + results.length) % results.length,
        );
        return;
      case "pick": {
        const chosen = results[activeIndex];
        if (chosen) selectMention(chosen);
        return;
      }
      case "dismiss":
        if (trigger) setDismissedAt(trigger.start);
        return;
      case "hold":
        // The picker is open with nothing to choose yet. Swallow the key rather
        // than sending a message that still has a half-typed `@token` in it.
        return;
      case "send":
        if (canSend) onSend();
    }
  }

  return (
    <footer
      className="relative z-10 shrink-0 border-t border-border/70 bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDraggingOver(false);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDraggingOver(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      <form
        className="relative mx-auto max-w-4xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        {draggingOver ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-royal-gold bg-royal-gold-light/90 text-sm font-medium text-royal-gold-ink">
            <Upload aria-hidden="true" className="size-4" />
            Drop to attach
          </div>
        ) : null}

        {menuOpen ? (
          <AgentMentionMenu
            activeIndex={activeIndex}
            id={listboxId}
            onHover={setActiveIndex}
            onSelect={selectMention}
            query={trigger.query}
            results={results}
            search={search}
          />
        ) : null}

        {editingMessageId ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
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

        <div className="overflow-hidden rounded-lg border border-border bg-muted/20 focus-within:border-royal-gold/60">
          {annotations.length > 0 ? (
            <ChipRow label="References">
              {annotations.map((annotation) => (
                <Chip
                  key={`${annotation.type}:${annotation.id}`}
                  onRemove={() =>
                    setAnnotations((items) =>
                      items.filter(
                        (item) =>
                          item.id !== annotation.id
                          || item.type !== annotation.type,
                      ),
                    )
                  }
                  removeLabel={`Remove the reference to ${annotation.label}`}
                >
                  <AtSign aria-hidden="true" className="size-3 shrink-0" />
                  {annotation.label}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {attachments.length > 0 ? (
            <ChipRow label="Files">
              {attachments.map((file) => (
                <Chip
                  key={`${file.name}:${file.lastModified}`}
                  onRemove={() =>
                    setAttachments((items) =>
                      items.filter((item) => item !== file),
                    )
                  }
                  removeLabel={`Remove ${file.name}`}
                >
                  <Paperclip aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          <InputGroup className="rounded-none border-0 bg-transparent shadow-none">
            <InputGroupTextarea
              aria-activedescendant={
                menuOpen && results.length > 0
                  ? `${listboxId}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={menuOpen ? listboxId : undefined}
              aria-expanded={menuOpen}
              aria-label="Message the operations agent"
              className="max-h-32 min-h-14 px-3 py-3 sm:max-h-40 sm:min-h-20"
              disabled={disabled}
              onChange={(event) => {
                onChange(event.target.value);
                syncCaret(event.currentTarget);
              }}
              onClick={(event) => syncCaret(event.currentTarget)}
              onKeyDown={handleKeyDown}
              onKeyUp={(event) => syncCaret(event.currentTarget)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length === 0) return;
                event.preventDefault();
                addFiles(files);
              }}
              placeholder="Ask about a lead, offer, task or project…"
              ref={composerRef}
              value={composer}
            />
            <InputGroupAddon
              align="block-end"
              className="justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1">
                <Button
                  aria-label="Attach a file"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Paperclip />
                </Button>
                <Button
                  aria-label="Reference a lead, offer, project or file"
                  disabled={atLimit}
                  onClick={openMentionPicker}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <AtSign />
                </Button>
                <input
                  accept={ACCEPTED_FILES}
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {uploading
                    ? "Uploading attachments…"
                    : "Enter to send · Shift+Enter for a new line"}
                </span>
              </span>
              <Button
                aria-label={
                  uploading ? "Uploading attachments" : "Send message"
                }
                disabled={!canSend}
                size="icon-sm"
                type="submit"
              >
                {uploading ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Send data-icon="inline-start" />
                )}
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <p className="mt-2 hidden text-center text-[11px] text-muted-foreground sm:block">
          Live business data is permission-scoped. Confirm important details
          before acting.
        </p>
      </form>
    </footer>
  );
}

function ChipRow({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 bg-background/60 px-3 py-2">
      <span className="mt-0.5 w-16 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function Chip({
  children,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-card py-0.5 pr-0.5 pl-1.5 text-xs">
      {children}
      <button
        aria-label={removeLabel}
        className="grid place-items-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-8"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

function formatBytes(size: number) {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${Math.round(size / 1_024)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}
