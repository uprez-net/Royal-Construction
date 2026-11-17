import type { TradieRequestKind } from "@prisma/client";
import { Loader2, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const MAX_LINES = 12;

/** The email is a fixed 700px table inside 20px of padding each side. */
const EMAIL_WIDTH = 760;

/**
 * Scale the preview to its column, the way a mail client's reading pane
 * would, rather than clipping the right-hand side of a fixed-width email.
 * Preview only: the HTML that is sent is not touched.
 */
function useFitZoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setZoom(Math.min(1, width / EMAIL_WIDTH));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, zoom };
}

/** How the preview shows which text can be edited. Preview only, never sent. */
const EDITABLE_STYLE = `[data-copy]{outline:none;border-radius:2px;cursor:text}
[data-copy]:hover{box-shadow:0 0 0 1px oklch(0.53 0.12 77.3 / 0.6)}
[data-copy]:focus{box-shadow:0 0 0 2px oklch(0.53 0.12 77.3);background:oklch(0.53 0.12 77.3 / 0.08)}`;

/**
 * An edited region's text, back in the form the email template writes it:
 * plain text with `**bold**`, line breaks, and `{tradie}` / `{reference}` for
 * what differs per recipient (`utils/generate-email.ts`).
 *
 * Node types, not `instanceof`: these nodes belong to the iframe's window.
 */
function regionText(region: Node): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    const token = element.getAttribute("data-token");
    if (token) return `{${token}}`;
    const tag = element.tagName.toLowerCase();
    if (tag === "br") return "\n";
    const inner = Array.from(element.childNodes).map(walk).join("");
    if (tag === "strong" || tag === "b") {
      return inner.trim() ? `**${inner}**` : inner;
    }
    if (tag === "div" || tag === "p") return `\n${inner}`;
    return inner;
  };
  return Array.from(region.childNodes)
    .map(walk)
    .join("")
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

export type RequestEmailActivity = {
  readonly milestoneId: string;
  readonly name: string;
  readonly stage: string;
  readonly dateLabel: string;
};

export interface RequestEmailStepProps {
  kind: TradieRequestKind;
  activities: readonly RequestEmailActivity[];
  workLines: Readonly<Record<string, readonly string[]>>;
  onWorkLinesChange: (milestoneId: string, lines: string[]) => void;
  subject: string;
  onSubjectChange: (subject: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** Activities whose lines are being drafted right now. */
  drafting: ReadonlySet<string>;
  draftError: string | null;
  onDraft: (milestoneIds: readonly string[]) => void;
  recipients: readonly { id: string; name: string }[];
  previewTradieId: string;
  onPreviewTradieChange: (tradieId: string) => void;
  previewHtml: string;
  /** How many regions of the email the office has reworded. */
  editedCopy: number;
  /** A region of the email reworded in the preview. */
  onCopyEdit: (key: string, text: string) => void;
  onCopyReset: () => void;
  subjectError?: string;
  /** The files every copy of the email carries, under the note. */
  attachments?: ReactNode;
}

export function RequestEmailStep({
  kind,
  activities,
  workLines,
  onWorkLinesChange,
  subject,
  onSubjectChange,
  note,
  onNoteChange,
  drafting,
  draftError,
  onDraft,
  recipients,
  previewTradieId,
  onPreviewTradieChange,
  previewHtml,
  editedCopy,
  onCopyEdit,
  onCopyReset,
  subjectError,
  attachments,
}: RequestEmailStepProps) {
  const empty = activities
    .filter((activity) => (workLines[activity.milestoneId] ?? []).length === 0)
    .map((activity) => activity.milestoneId);
  const anyDrafting = drafting.size > 0;
  const { ref: previewRef, zoom } = useFitZoom();
  const scaledHtml = previewHtml.replace(
    "<head>",
    `<head><style>html{zoom:${zoom.toFixed(3)}}${EDITABLE_STYLE}</style>`,
  );

  // The preview is edited in place, so the frame is not re-rendered for a
  // change that came from typing in it: that would throw away the caret.
  // Every other change (the note, a work line in the list, the recipient)
  // renders the email again, with the edits already in it.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const editedInFrame = useRef(false);
  useEffect(() => {
    if (editedInFrame.current) return;
    if (frameRef.current) frameRef.current.srcdoc = scaledHtml;
  }, [scaledHtml]);
  useEffect(() => {
    editedInFrame.current = false;
  });

  const edit = useRef({ onCopyEdit, onWorkLinesChange, workLines });
  useEffect(() => {
    edit.current = { onCopyEdit, onWorkLinesChange, workLines };
  });

  const attachEditor = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const regionOf = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.("[data-copy]") ?? null;

    doc.addEventListener("input", (event) => {
      const region = regionOf(event.target);
      const key = region?.getAttribute("data-copy");
      if (!region || !key) return;
      editedInFrame.current = true;
      const { onCopyEdit, onWorkLinesChange, workLines } = edit.current;
      // A work line is the same line as in the list on the left.
      const work = /^work:(.+):(\d+)$/.exec(key);
      if (work) {
        const [, milestoneId, index] = work;
        const text = regionText(region).replace(/\n/g, " ").slice(0, 300);
        onWorkLinesChange(
          milestoneId,
          (workLines[milestoneId] ?? []).map((line, i) =>
            i === Number(index) ? text : line,
          ),
        );
        return;
      }
      onCopyEdit(key, regionText(region));
    });
    // A line break, not the paragraph the browser would invent; none in a
    // work line, which is one line of the list.
    doc.addEventListener("keydown", (event) => {
      const region = regionOf(event.target);
      if (!region || event.key !== "Enter") return;
      event.preventDefault();
      if (!region.getAttribute("data-copy")?.startsWith("work:")) {
        doc.execCommand("insertLineBreak");
      }
    });
    // Pasted text arrives as text, not as another page's markup.
    doc.addEventListener("paste", (event) => {
      if (!regionOf(event.target)) return;
      event.preventDefault();
      doc.execCommand(
        "insertText",
        false,
        event.clipboardData?.getData("text/plain") ?? "",
      );
    });
  };

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Editor */}
      <section aria-label="Request details" className="min-w-0 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="request-subject">Email subject</Label>
          <Input
            id="request-subject"
            value={subject}
            maxLength={200}
            aria-invalid={Boolean(subjectError)}
            aria-describedby={
              subjectError ? "request-subject-error" : undefined
            }
            onChange={(event) => onSubjectChange(event.target.value)}
          />
          {subjectError ? (
            <p
              id="request-subject-error"
              className="text-xs font-medium text-destructive-ink"
            >
              {subjectError}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Each email gets its own reference, added to the end of the subject
            when it is sent. Replies are matched to this{" "}
            {kind === "BOOKING" ? "booking" : "request"} by it.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Work details
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={anyDrafting || empty.length === 0}
              onClick={() => onDraft(empty)}
              title={
                empty.length === 0
                  ? "Every activity has work details. Use Redraft on one to replace it."
                  : undefined
              }
            >
              {anyDrafting ? (
                <Loader2
                  className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              {anyDrafting ? "Drafting…" : "Draft empty with AI"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === "BOOKING"
              ? "What the tradie is booked to do under each activity. AI drafts are a starting point: check every line before sending, because the tradie confirms against it."
              : "What the tradie is asked to price under each activity. AI drafts are a starting point: check every line before sending, because the tradie quotes against it."}
          </p>
          {draftError ? (
            <p
              role="alert"
              className="text-xs font-medium text-destructive-ink"
            >
              {draftError}
            </p>
          ) : null}

          <ol className="space-y-3">
            {activities.map((activity, index) => {
              const lines = workLines[activity.milestoneId] ?? [];
              const busy = drafting.has(activity.milestoneId);
              const set = (next: string[]) =>
                onWorkLinesChange(activity.milestoneId, next);
              return (
                <li
                  key={activity.milestoneId}
                  className="rounded-lg border border-border/70 bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {index + 1}.
                        </span>
                        {activity.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activity.stage} · {activity.dateLabel}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={anyDrafting}
                      onClick={() => onDraft([activity.milestoneId])}
                      aria-label={`Redraft work details for ${activity.name} with AI`}
                    >
                      <Sparkles className="mr-1 size-3" aria-hidden="true" />
                      {lines.length > 0 ? "Redraft" : "Draft"}
                    </Button>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {busy ? (
                      <>
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-4/5" />
                        <Skeleton className="h-8 w-3/5" />
                      </>
                    ) : (
                      lines.map((line, lineIndex) => (
                        <div
                          key={lineIndex}
                          className="flex items-center gap-1.5"
                        >
                          <Input
                            aria-label={`${activity.name}, work line ${lineIndex + 1}`}
                            value={line}
                            maxLength={300}
                            className="h-8 text-sm"
                            onChange={(event) =>
                              set(
                                lines.map((existing, i) =>
                                  i === lineIndex
                                    ? event.target.value
                                    : existing,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 text-muted-foreground"
                            aria-label={`Remove work line ${lineIndex + 1} from ${activity.name}`}
                            onClick={() =>
                              set(lines.filter((_, i) => i !== lineIndex))
                            }
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      ))
                    )}
                    {!busy && lines.length < MAX_LINES ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => set([...lines, ""])}
                      >
                        <Plus className="mr-1 size-3" aria-hidden="true" />
                        Add line
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="request-note">Note to tradies (optional)</Label>
          <Textarea
            id="request-note"
            value={note}
            maxLength={2000}
            rows={3}
            placeholder={
              kind === "BOOKING"
                ? "Site access, who to report to on the day, plans to follow…"
                : "Site access, plans to follow, a date you need the quote by…"
            }
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </div>

        {attachments}
      </section>

      {/* Canvas */}
      <section
        aria-label="Email preview"
        className="flex min-w-0 flex-col gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Email preview
          </h3>
          {recipients.length > 1 ? (
            <Select
              value={previewTradieId}
              onValueChange={onPreviewTradieChange}
            >
              <SelectTrigger
                aria-label="Preview the email as sent to"
                className="h-8 w-auto min-w-48 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {recipients.map((recipient) => (
                  <SelectItem key={recipient.id} value={recipient.id}>
                    To {recipient.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">
              To {recipients[0]?.name}
            </span>
          )}
        </div>
        {recipients.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {recipients.length} separate emails. Only the greeting changes
            between them.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Click any text in the email to change it. The note is edited in the
            Note field.
          </p>
          {editedCopy > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCopyReset}
            >
              <RotateCcw className="mr-1 size-3" aria-hidden="true" />
              Undo {editedCopy} {editedCopy === 1 ? "edit" : "edits"}
            </Button>
          ) : null}
        </div>
        {/* The email is a whole HTML document with its own styles; an iframe
            keeps them out of the app and the app's out of it. No scripts run
            in it: same-origin only so the app can listen to its edits. */}
        <div ref={previewRef} className="flex min-h-0 flex-1">
          <iframe
            ref={frameRef}
            title="Request email preview"
            sandbox="allow-same-origin"
            onLoad={attachEditor}
            className="h-[28rem] w-full flex-1 rounded-lg border border-border/70 bg-card lg:h-auto lg:min-h-[32rem]"
          />
        </div>
      </section>
    </div>
  );
}
