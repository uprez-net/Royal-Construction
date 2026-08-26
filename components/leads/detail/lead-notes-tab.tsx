"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadRichTextEditor } from "@/components/rich-text/lead-rich-text-editor";
import {
  coerceLeadNotesDocument,
  createLeadNotesDocument,
  extractMentionedUserIds,
} from "@/lib/rich-text/lead-notes";
import { updateLead } from "@/lib/leads/leads-service";
import type {
  HistoryItem,
  Lead,
  LeadRichTextDocument,
} from "@/lib/leads/types";

/**
 * Saved notes are stored as history entries — "activities" — so the list below
 * the editor is the lead's history, newest first. A bare `date`/`time` pair
 * sorts correctly as a string once concatenated, and falls back to input order
 * when either is missing rather than reordering on a NaN.
 */
function sortActivitiesNewestFirst(history: HistoryItem[]): HistoryItem[] {
  return [...history].sort((a, b) =>
    `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`),
  );
}

function buildSavedNoteHistoryEntry(noteText: string): HistoryItem {
  const now = new Date();

  return {
    action: "Lead note saved",
    detail: noteText || "Lead note updated",
    type: "system",
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
  };
}

export function LeadNotesTab({
  lead,
  availableUsers,
  onLeadUpdate,
}: {
  lead: Lead;
  availableUsers: { id: string; name: string }[];
  onLeadUpdate: (lead: Lead) => void;
}) {
  const notesLabelId = useId();
  const baselineDoc = useMemo(
    () => coerceLeadNotesDocument(lead.notesDoc, lead.notes || ""),
    [lead.notesDoc, lead.notes],
  );

  const [notesDoc, setNotesDoc] = useState<LeadRichTextDocument>(baselineDoc);
  const [isSaving, setIsSaving] = useState(false);

  const mentionedUserIds = useMemo(
    () => extractMentionedUserIds(notesDoc),
    [notesDoc],
  );
  const baselineMentionedUserIds = useMemo(
    () => extractMentionedUserIds(baselineDoc),
    [baselineDoc],
  );
  const hasNewMentions = mentionedUserIds.some(
    (userId) => !baselineMentionedUserIds.includes(userId),
  );
  const noteHasChanges =
    notesDoc.plainText !== baselineDoc.plainText ||
    JSON.stringify(notesDoc) !== JSON.stringify(baselineDoc);
  const canSaveNote = noteHasChanges || hasNewMentions;

  const activities = useMemo(
    () => sortActivitiesNewestFirst(lead.history),
    [lead.history],
  );

  const handleSaveNote = async () => {
    if (!canSaveNote || isSaving) return;

    setIsSaving(true);
    try {
      const noteText = notesDoc.plainText.trim();
      const newMentionedUserIds = mentionedUserIds.filter(
        (userId) => !baselineMentionedUserIds.includes(userId),
      );
      const annotationsToCreate =
        newMentionedUserIds.length === 0
          ? []
          : [
              {
                selectedText: noteText || "Lead note",
                comment: "Mentioned in lead note",
                mentionedUserIds: newMentionedUserIds,
              },
            ];

      // The composer is cleared on the server too: the note's permanent home is
      // the history entry, not the lead's live note field.
      const emptyNoteDocument = createLeadNotesDocument({ plainText: "" });
      const updated = await updateLead(lead.id, {
        notes: "",
        notesDoc: emptyNoteDocument,
        annotationsToCreate,
        history: [buildSavedNoteHistoryEntry(noteText)],
      });

      if (!updated) return;

      setNotesDoc(emptyNoteDocument);
      onLeadUpdate(updated);
      toast.success(
        hasNewMentions ? "Note saved and mentions emailed" : "Note saved",
      );
    } catch (error) {
      console.error("Failed to save note", error);
      toast.error("Failed to save the note. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle
            as="h2"
            id={notesLabelId}
            className="text-base font-semibold text-foreground"
          >
            Add a note
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Mention a teammate with @ to email them a copy. Saving files the note
            into the activity log below.
          </p>
        </CardHeader>
        <CardContent className="pt-5">
          <LeadRichTextEditor
            value={notesDoc}
            availableUsers={availableUsers}
            onChange={setNotesDoc}
            onSaveNote={handleSaveNote}
            canSaveNote={canSaveNote}
            isSavingNote={isSaving}
            ariaLabelledBy={notesLabelId}
          />
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle as="h2" className="text-base font-semibold text-foreground">
            Activity
          </CardTitle>
          <p className="text-sm text-muted-foreground tabular-nums">
            {activities.length}{" "}
            {activities.length === 1 ? "entry" : "entries"}, newest first
          </p>
        </CardHeader>
        <CardContent className="pt-5">
          {activities.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                <History
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No activity recorded yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Notes, stage changes and follow-ups against this lead appear
                  here.
                </p>
              </div>
            </div>
          ) : (
            <ol className="history-list">
              {activities.map((entry, index) => (
                <li
                  key={`${entry.date}-${entry.time}-${index}`}
                  className="history-entry"
                >
                  <div className="history-entry-meta">
                    <div className="history-entry-title">{entry.action}</div>
                    <div className="history-entry-detail">{entry.detail}</div>
                    <div className="history-entry-date">
                      <span className="font-mono tabular-nums">
                        {entry.date} {entry.time}
                      </span>
                      {entry.author?.name ? ` · ${entry.author.name}` : ""}
                    </div>
                  </div>
                  <div className="history-entry-actions">
                    <span className="history-entry-badge">{entry.type}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
