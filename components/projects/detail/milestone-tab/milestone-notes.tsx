"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ChevronDown, Loader2, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import type { UserPrincipal } from "@/lib/domain/principal";
import {
  MILESTONE_NOTE_MAX_LENGTH,
  canDeleteMilestoneNote,
} from "@/lib/domain/projects/milestone-note-rules";
import {
  deleteMilestoneNote,
  postMilestoneNote,
} from "@/lib/projects/milestone-notes-client";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  milestoneNoteAdded,
  milestoneNoteRemoved,
} from "@/lib/store/slices/projectsSlice";
import type { UIMilestone } from "@/types/project";
import { FetchError } from "@/utils/fetch";

/** The counter shows once a note gets this close to the cap. */
const COUNTER_FROM = MILESTONE_NOTE_MAX_LENGTH - 200;

// Sydney, not the browser's zone: the office reads every date in this app as
// Sydney time, and a laptop left on another zone should not move a note's day.
const noteTime = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Australia/Sydney",
});

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Staff notes on one activity: a collapsed "Notes" line that opens to an add
 * box and the notes, newest first, in a list that scrolls on its own so a
 * talkative activity does not push the rest of the stage off the screen.
 */
export function MilestoneNotes({
  projectId,
  milestone,
  viewer,
}: {
  projectId: string;
  milestone: UIMilestone;
  viewer: UserPrincipal;
}) {
  const dispatch = useAppDispatch();
  const notes = milestone.notes ?? [];
  const textareaId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > MILESTONE_NOTE_MAX_LENGTH;

  async function save() {
    // `saving` also stops a double-click from posting the same note twice.
    if (saving || trimmed.length === 0 || tooLong) return;
    setSaving(true);
    try {
      const note = await postMilestoneNote(projectId, milestone.id, trimmed);
      dispatch(milestoneNoteAdded({ projectId, note }));
      setDraft("");
    } catch (error) {
      toast.error(message(error, "Could not save the note. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(noteId: string) {
    if (deletingId) return;
    setDeletingId(noteId);
    try {
      await deleteMilestoneNote(projectId, milestone.id, noteId);
      dispatch(
        milestoneNoteRemoved({ projectId, milestoneId: milestone.id, noteId }),
      );
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        // Gone already (another tab, or a second click): the list catches up.
        dispatch(
          milestoneNoteRemoved({
            projectId,
            milestoneId: milestone.id,
            noteId,
          }),
        );
      } else {
        toast.error(message(error, "Could not delete the note. Try again."));
      }
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group -ml-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <StickyNote className="size-3.5" aria-hidden="true" />
          {notes.length === 0
            ? "Add a note"
            : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
          <span className="sr-only"> on {milestone.name}</span>
          <ChevronDown
            className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1.5 space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={textareaId} className="sr-only">
            New note on {milestone.name}
          </label>
          <Textarea
            id={textareaId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a note for the team…"
            rows={2}
            disabled={saving}
            aria-invalid={tooLong || undefined}
            className="min-h-16 resize-y bg-background text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={
                tooLong
                  ? "text-xs font-medium text-destructive-ink"
                  : "text-xs text-muted-foreground"
              }
              aria-live="polite"
            >
              {trimmed.length >= COUNTER_FROM
                ? `${trimmed.length} / ${MILESTONE_NOTE_MAX_LENGTH}`
                : "Only staff can see notes."}
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={saving || trimmed.length === 0 || tooLong}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Add note
            </Button>
          </div>
        </form>

        {notes.length > 0 ? (
          <ol
            className="max-h-64 list-none space-y-2 overflow-y-auto overscroll-contain pr-1"
            aria-label={`Notes on ${milestone.name}, newest first`}
            // Focusable so the list scrolls from the keyboard too.
            tabIndex={0}
          >
            {notes.map((note) => {
              const createdAt = new Date(note.createdAt);
              const deletable = canDeleteMilestoneNote(viewer, note);
              const confirming = confirmingId === note.id;
              const deleting = deletingId === note.id;
              return (
                <li
                  key={note.id}
                  className="rounded-md border border-border/70 bg-background px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {note.author?.name ?? "Former staff member"}
                      </span>{" "}
                      ·{" "}
                      <time dateTime={createdAt.toISOString()}>
                        {noteTime.format(createdAt)}
                      </time>
                    </p>
                    {deletable ? (
                      confirming ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            disabled={deleting}
                            onClick={() => void remove(note.id)}
                          >
                            {deleting ? (
                              <Loader2
                                className="size-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            Delete
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={deleting}
                            onClick={() => setConfirmingId(null)}
                          >
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive-ink"
                          aria-label={`Delete note from ${note.author?.name ?? "former staff member"}`}
                          onClick={() => setConfirmingId(note.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap break-words text-foreground/90">
                    {note.body}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">No notes yet.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
