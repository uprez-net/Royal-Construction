import React, { useState, useMemo } from "react";
import { Lead, LeadSource, LeadStage, HistoryItem } from "@/lib/leads/types";
import { updateLead } from "@/lib/leads/leads-service";
import {
  LeadDetailFormData,
  leadToFormData,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  BUDGET_OPTIONS,
  shouldSetFollowupStage,
  buildFollowupHistoryEntry,
  isLostStage,
} from "@/lib/leads/lead-helpers";
import { ModalShell } from "@/components/common/modal-shell";
import { LeadRichTextEditor } from "@/components/rich-text/lead-rich-text-editor";
import {
  createLeadNotesDocument,
  extractMentionedUserIds,
} from "@/lib/rich-text/lead-notes";
import { LeadEmailSection } from "./email-section";
import type { LeadEmails } from "@prisma/client";

interface DetailModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead, options?: { keepOpen?: boolean }) => void;
  onDeleteClick: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
  availableUsers: { id: string; name: string }[];
}

export function DetailModal({
  lead,
  onClose,
  onLeadUpdate,
  onDeleteClick,
  showToast,
  appendEmailToLead,
  availableUsers,
}: DetailModalProps) {
  const [form, setForm] = useState<LeadDetailFormData>(() =>
    leadToFormData(lead),
  );
  const baseline = useMemo(() => leadToFormData(lead), [lead]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const formId = React.useId();
  const fieldId = (name: string) => `${formId}-${name}`;
  const lostReasonErrorId = fieldId("lost-reason-error");
  const notesLabelId = fieldId("notes-label");

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );
  const noteHasChanges =
    form.notes !== baseline.notes ||
    JSON.stringify(form.notesDoc) !== JSON.stringify(baseline.notesDoc);
  const mentionedUserIds = useMemo(
    () => extractMentionedUserIds(form.notesDoc),
    [form.notesDoc],
  );
  const baselineMentionedUserIds = useMemo(
    () => extractMentionedUserIds(baseline.notesDoc),
    [baseline.notesDoc],
  );
  const hasNewMentions = mentionedUserIds.some(
    (userId) => !baselineMentionedUserIds.includes(userId),
  );
  const canSaveNote = noteHasChanges || hasNewMentions;

  const patch = (updates: Partial<LeadDetailFormData>) =>
    setForm((prev) => (prev ? { ...prev, ...updates } : prev));

  const buildNoteMentionAnnotations = () => {
    const newMentionedUserIds = mentionedUserIds.filter(
      (userId) => !baselineMentionedUserIds.includes(userId),
    );
    if (newMentionedUserIds.length === 0) return [];
    const noteText = form.notes.trim();

    return [
      {
        selectedText: noteText || "Lead note",
        comment: "Mentioned in lead note",
        mentionedUserIds: newMentionedUserIds,
      },
    ];
  };

  const buildSavedNoteHistoryEntry = (): HistoryItem => {
    const now = new Date();
    const noteText = form.notes.trim();

    return {
      action: "Lead note saved",
      detail: noteText || "Lead note updated",
      type: "system",
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
    };
  };

  const handleUpdate = async () => {
    if (isLostStage(form.stage) && !form.lostReason.trim()) {
      showToast("Add a lost reason before updating this lead.", "info");
      return;
    }

    setIsUpdating(true);
    try {
      let stage = form.stage;
      const historyToSend: HistoryItem[] = [];

      if (shouldSetFollowupStage(lead, form)) {
        // const success = await createCalendarEventIfValid(form, showToast);
        // if (!success) return;
        stage = "In Follow-up";
        historyToSend.push(
          buildFollowupHistoryEntry(form.followupDate, form.followupTime),
        );
      }

      const typeValue = (
        form.type.length > 0 ? form.type : ["Not Specified"]
      ).join(", ");

      const updated = await updateLead(lead.id, {
        name: form.name,
        phone: form.phone,
        email: form.email,
        location: form.location,
        source: form.sourceDetail,
        sourceDetail: form.sourceDetail,
        stage,
        assignedId: form.assignedId || null,
        assignedUser: form.assignedUser || null,
        budget: form.budget,
        type: typeValue,
        notes: form.notes,
        notesDoc: form.notesDoc,
        annotationsToCreate: [
          ...form.annotationsToCreate,
          ...buildNoteMentionAnnotations(),
        ],
        followupDate: form.followupDate,
        followupTime: form.followupTime,
        urgent: form.urgent,
        lostReason: isLostStage(stage) ? form.lostReason : "",
        history: historyToSend.length > 0 ? historyToSend : undefined,
      });

      if (!updated) return;
      onLeadUpdate(updated);
      showToast("Lead updated");
      onClose();
    } catch (error) {
      console.error("Failed to update lead", error);
      showToast("Failed to update lead", "info");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveNote = async () => {
    if (!canSaveNote || isSavingNote) return;

    setIsSavingNote(true);
    try {
      const emptyNoteDocument = createLeadNotesDocument({ plainText: "" });
      const annotationsToCreate = buildNoteMentionAnnotations();
      const updated = await updateLead(lead.id, {
        notes: "",
        notesDoc: emptyNoteDocument,
        annotationsToCreate,
        history: [buildSavedNoteHistoryEntry()],
      });

      if (!updated) return;
      patch({
        notes: "",
        notesDoc: emptyNoteDocument,
        annotationsToCreate: [],
      });
      onLeadUpdate(updated, { keepOpen: true });
      showToast(
        hasNewMentions ? "Note saved and mentions emailed" : "Note saved",
      );
    } catch (error) {
      console.error("Failed to save note", error);
      showToast("Failed to save note", "info");
    } finally {
      setIsSavingNote(false);
    }
  };

  /* ── Common input class ── */
  const inputCls =
    "mt-1 w-full rounded-[4px] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-[color:var(--royal-gold)] focus:outline-none focus:ring-2 focus:ring-[color:var(--royal-gold-light)]";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <ModalShell
      open
      onClose={onClose}
      title={lead.name}
      subtitle={`${lead.location} | ${lead.phone}`}
      maxWidthClass="max-w-[860px]"
    >
      <div className="space-y-5">
        {/* Status banners */}
        {form.stage === "Won" && (
          <div className="status-banner status-banner-success">
            <span className="status-banner-title">Status: Won</span>
            <span className="status-banner-text">
              This lead is marked as won.
            </span>
          </div>
        )}
        {isLostStage(form.stage) && (
          <div className="status-banner status-banner-danger">
            <span className="status-banner-title">Status: {form.stage}</span>
            <span className="status-banner-text">
              {form.lostReason
                ? `Reason: ${form.lostReason}`
                : "Add a lost reason before updating."}
            </span>
          </div>
        )}

        {/* Contact fields */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("name")} className={labelCls}>
              Name
            </label>
            <input
              id={fieldId("name")}
              className={inputCls}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("phone")} className={labelCls}>
              Phone
            </label>
            <input
              id={fieldId("phone")}
              className={inputCls}
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("email")} className={labelCls}>
              Email
            </label>
            <input
              id={fieldId("email")}
              className={inputCls}
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("location")} className={labelCls}>
              Location
            </label>
            <input
              id={fieldId("location")}
              className={inputCls}
              value={form.location}
              onChange={(e) => patch({ location: e.target.value })}
            />
          </div>
        </div>

        {/* Source + Stage */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("source-detail")} className={labelCls}>
              Source Detail
            </label>
            <select
              id={fieldId("source-detail")}
              className={inputCls}
              value={form.sourceDetail}
              onChange={(e) =>
                patch({ sourceDetail: e.target.value as LeadSource })
              }
            >
              {LEAD_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("stage")} className={labelCls}>
              Stage
            </label>
            <select
              id={fieldId("stage")}
              className={inputCls}
              value={form.stage}
              onChange={(e) => {
                const next = e.target.value as LeadStage;
                patch({
                  stage: next,
                  lostReason: isLostStage(next) ? form.lostReason : "",
                });
              }}
            >
              {LEAD_STAGE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Assigned + Budget */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("assigned-to")} className={labelCls}>
              Assigned To
            </label>
            <select
              id={fieldId("assigned-to")}
              className={inputCls}
              value={form.assignedId || ""}
              onChange={(e) => patch({ assignedId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("budget")} className={labelCls}>
              Budget
            </label>
            <select
              id={fieldId("budget")}
              className={inputCls}
              value={form.budget}
              onChange={(e) => patch({ budget: e.target.value })}
            >
              {BUDGET_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Follow-up Date + Time */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("followup-date")} className={labelCls}>
              Follow-up Date
            </label>
            <input
              id={fieldId("followup-date")}
              type="date"
              className={inputCls}
              min={new Date().toLocaleDateString("en-CA", {
                timeZone: "Australia/Sydney",
              })}
              value={form.followupDate}
              onChange={(e) => patch({ followupDate: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("followup-time")} className={labelCls}>
              Follow-up Time
            </label>
            <input
              id={fieldId("followup-time")}
              type="time"
              className={inputCls}
              value={form.followupTime}
              onChange={(e) => patch({ followupTime: e.target.value })}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <span id={notesLabelId} className={labelCls}>
            Notes
          </span>
          <LeadRichTextEditor
            value={form.notesDoc}
            availableUsers={availableUsers}
            onChange={(notesDoc) =>
              patch({ notesDoc, notes: notesDoc.plainText })
            }
            onSaveNote={handleSaveNote}
            canSaveNote={canSaveNote}
            isSavingNote={isSavingNote}
            ariaLabelledBy={notesLabelId}
          />
        </div>

        {/* Urgent */}
        <div className="flex items-center gap-2">
          <input
            id={fieldId("urgent")}
            type="checkbox"
            checked={form.urgent}
            onChange={(e) => patch({ urgent: e.target.checked })}
          />
          <label htmlFor={fieldId("urgent")} className={labelCls}>
            Urgent
          </label>
        </div>

        {/* Activity */}
        <div>
          <h5 className={labelCls}>Activity</h5>
          {lead.history.length === 0 ? (
            <div className="mt-2 text-xs text-muted-foreground/70">
              No activity recorded yet.
            </div>
          ) : (
            <div className="history-list mt-2">
              {lead.history.map((entry, i) => (
                <div
                  key={`${entry.date}-${entry.time}-${i}`}
                  className="history-entry"
                >
                  <div className="history-entry-meta">
                    <div className="history-entry-title">{entry.action}</div>
                    <div className="history-entry-detail">{entry.detail}</div>
                    <div className="history-entry-date">
                      {entry.date} {entry.time}
                    </div>
                  </div>
                  <div className="history-entry-actions">
                    <span className="history-entry-badge">{entry.type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Emails */}
        <LeadEmailSection
          key={`${lead.emails.length}-${lead.id}`} // Force re-render when emails change
          emails={lead.emails}
          leadId={lead.id}
          leadEmail={lead.email}
          appendEmailToLead={appendEmailToLead}
        />

        {/* Lost reason */}
        {isLostStage(form.stage) && (
          <div className="col-span-1 rounded-[8px] border border-(--destructive)/30 bg-destructive-light p-4 md:col-span-2">
            <label
              htmlFor={fieldId("lost-reason")}
              className="text-sm font-medium text-destructive"
            >
              Lost reason <span className="text-destructive">*</span>
            </label>
            <input
              id={fieldId("lost-reason")}
              className={`mt-1 w-full rounded-lg border ${!form.lostReason.trim() ? "border-destructive ring-1 ring-(--destructive)/20" : "border-border"} bg-card px-3 py-2 text-sm text-foreground focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive-light`}
              placeholder="e.g. Went with another builder, budget too low"
              value={form.lostReason}
              onChange={(e) => patch({ lostReason: e.target.value })}
              required
              aria-invalid={!form.lostReason.trim()}
              aria-describedby={
                !form.lostReason.trim() ? lostReasonErrorId : undefined
              }
            />
            {!form.lostReason.trim() && (
              <p
                id={lostReasonErrorId}
                className="mt-1.5 text-xs font-medium text-destructive"
              >
                Enter why this lead is {form.stage.toLowerCase()} before
                updating.
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-royal-gold px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-royal-gold-dark disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleUpdate}
            disabled={!hasChanges || isUpdating}
          >
            {isUpdating ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Updating...
              </>
            ) : (
              "Update Lead"
            )}
          </button>

          {(form.stage === "Won" ||
            (isLostStage(form.stage) && lead.lostReason)) && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-(--destructive)/30 bg-destructive-light px-4 py-2 text-xs font-medium text-destructive transition hover:border-(--destructive)/50"
              onClick={() => onDeleteClick(lead)}
            >
              Delete Lead
            </button>
          )}

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-royal-gold hover:bg-muted"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
