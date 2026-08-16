import React, { useState, useMemo, useRef } from "react";
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
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { QueuedUploadFile, useUploadQueue } from "@/hooks/use-upload-queue";
import {
  completeProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { useAppDispatch } from "@/lib/store/hooks";
import { currency } from "@/utils/formatters";
import { stageToPrismaMap } from "@/types/lead";
import { stageDef } from "@/lib/leads/pipeline-stages";
import { formatFyQuarter, fyQuarterOf } from "@/lib/leads/fy-quarter";
import { upload } from "@vercel/blob/client";
import { ClientPayload } from "@/utils/validators/files";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, Loader2, Upload } from "lucide-react";
import { buildBlobPath, formatFileSize } from "@/utils/formatters";

interface DetailModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead, options?: { keepOpen?: boolean }) => void;
  onDeleteClick: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
  availableUsers: { id: string; name: string }[];
}

export function DetailModal({
  lead,
  onClose,
  onLeadUpdate,
  onDeleteClick,
  showToast,
  availableUsers,
}: DetailModalProps) {
  const maxFiles = 5;
  const {
    files: queuedFiles,
    completedCount: completedUploadCount,
    addFiles,
    removeFile,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
  } = useUploadQueue({ maxFiles });
  const dispatch = useAppDispatch();
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const [form, setForm] = useState<LeadDetailFormData>(() =>
    leadToFormData(lead),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<
    { id: string; name: string; url: string; size: number }[]
  >(lead.uploadedFiles);
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

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: `lead-${lead.id}`,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    markUploading(queuedFile.id);

    try {
      const blob = await upload(
        buildBlobPath({
          leadId: lead.id.toString(),
          fileId: queuedFile.id,
          fileName: queuedFile.file.name,
        }),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            leadId: lead.id.toString(),
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            isOfferFile: false,
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: `lead-${lead.id}`,
                fileId: queuedFile.id,
                progress: percentage,
              }),
            );
            updateProgress(queuedFile.id, percentage);
          },
        },
      );

      dispatch(
        completeProjectUpload({
          projectId: `lead-${lead.id}`,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);
      return blob.url;
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

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
      showToast("Add a lost reason before updating this lead.", "error");
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
        secondaryName: form.secondaryName || null,
        secondaryEmail: form.secondaryEmail || null,
        secondaryPhone: form.secondaryPhone || null,
        source: form.sourceDetail,
        sourceDetail: form.sourceDetail,
        stage,
        assignedId: form.assignedId || null,
        assignedUser: form.assignedUser || null,
        budget: form.budget,
        estimatedValue: form.estimatedValue === "" ? null : form.estimatedValue,
        estimatedValueSource: form.estimatedValueSource,
        // Clamp and round at the source. The input is free-typed, so 150 or
        // 79.6 would otherwise fail Zod's int 0-100 rule and reject the whole
        // save — every unrelated edit in the modal with it — behind a generic
        // toast that names no field.
        probabilityOverride:
          form.probabilityOverride === ""
            ? null
            : Math.max(0, Math.min(100, Math.round(Number(form.probabilityOverride) || 0))),
        expectedCloseDate: form.expectedCloseDate || null,
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
      showToast("Failed to update the lead. Please try again.", "error");
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
      showToast("Failed to save the note. Please try again.", "error");
    } finally {
      setIsSavingNote(false);
    }
  };

  /* ── Common input class ── */
  /* ── Deal economics derived values ─────────────────────────────── */
  // form.stage is the UI label; the stage ladder is keyed by the Prisma enum.
  const stageProbability =
    stageDef(stageToPrismaMap[form.stage]).probability;

  const expectedCloseQuarter = useMemo(() => {
    if (!form.expectedCloseDate) return null;
    // Read the date as Sydney noon so the quarter matches what the forecast
    // computes — a bare YYYY-MM-DD parses as UTC midnight and can slip a day.
    const parsed = new Date(`${form.expectedCloseDate}T12:00:00+10:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    const { fy, quarter } = fyQuarterOf(parsed);
    return formatFyQuarter(fy, quarter);
  }, [form.expectedCloseDate]);

  const weightedPreview = useMemo(() => {
    const value = Number(form.estimatedValue);
    if (!form.estimatedValue || !Number.isFinite(value) || value <= 0) return null;
    const pct = form.probabilityOverride === ""
      ? stageProbability
      : Math.max(0, Math.min(100, Number(form.probabilityOverride) || 0));
    return {
      equation: `${currency.format(value)} × ${pct}%`,
      amount: currency.format((value * pct) / 100),
    };
  }, [form.estimatedValue, form.probabilityOverride, stageProbability]);

  const inputCls =
    "mt-1 w-full rounded-[4px] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-[color:var(--royal-gold)] focus:outline-none focus:ring-2 focus:ring-[color:var(--royal-gold-light)]";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <ModalShell
      open
      onClose={() => {
        resetQueue();
        onClose();
      }}
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
              Primary Client
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

        {/* Secondary client (optional) */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("secondary-name")} className={labelCls}>
              Secondary Client
            </label>
            <input
              id={fieldId("secondary-name")}
              className={inputCls}
              value={form.secondaryName}
              onChange={(e) => patch({ secondaryName: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("secondary-phone")} className={labelCls}>
              Secondary Phone
            </label>
            <input
              id={fieldId("secondary-phone")}
              className={inputCls}
              value={form.secondaryPhone}
              onChange={(e) => patch({ secondaryPhone: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={fieldId("secondary-email")} className={labelCls}>
              Secondary Email
            </label>
            <input
              id={fieldId("secondary-email")}
              className={inputCls}
              value={form.secondaryEmail}
              onChange={(e) => patch({ secondaryEmail: e.target.value })}
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
              Budget discussed — rough note
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

        {/* ── Deal economics ───────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor={fieldId("estimated-value")} className={labelCls}>
              Deal value
            </label>
            <div className="flex items-center gap-2">
              <input
                id={fieldId("estimated-value")}
                type="number"
                min={0}
                step={1000}
                className={inputCls}
                value={form.estimatedValue}
                onChange={(e) =>
                  // Typing takes ownership: this lead stops following the offer.
                  patch({
                    estimatedValue: e.target.value,
                    estimatedValueSource: "MANUAL",
                  })
                }
              />
              {form.estimatedValueSource === "OFFER" && (
                <span
                  className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{
                    background: "var(--info-light)",
                    color: "var(--info-ink)",
                  }}
                >
                  From offer
                </span>
              )}
            </div>
            {form.estimatedValueSource === "MANUAL" ? (
              <button
                type="button"
                className="mt-1 text-[11px] underline"
                onClick={() =>
                  // Clear only the ownership flag, never the figure. Nulling
                  // the value would drop this lead out of pipeline totals
                  // entirely until someone happens to re-save the offer
                  // workspace — the sync only runs on an offer write, so
                  // there is no path back in the meantime. A slightly stale
                  // number beats no number.
                  patch({ estimatedValueSource: null })
                }
              >
                Follow the offer price again
              </button>
            ) : (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Follows the quoted contract price once an offer exists.
              </span>
            )}
          </div>

          <div>
            <label htmlFor={fieldId("probability")} className={labelCls}>
              Likelihood
            </label>
            <input
              id={fieldId("probability")}
              type="number"
              min={0}
              max={100}
              className={inputCls}
              // The stage default is the PLACEHOLDER, never the value — writing
              // it in would silently convert every lead to a manual override.
              placeholder={String(stageProbability)}
              value={form.probabilityOverride}
              onChange={(e) => patch({ probabilityOverride: e.target.value })}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {form.stage} default is {stageProbability}%
            </span>
          </div>

          <div>
            <label htmlFor={fieldId("expected-close")} className={labelCls}>
              Expected close
            </label>
            <input
              id={fieldId("expected-close")}
              type="date"
              className={inputCls}
              value={form.expectedCloseDate}
              onChange={(e) => patch({ expectedCloseDate: e.target.value })}
            />
            {expectedCloseQuarter && (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Lands in {expectedCloseQuarter}
              </span>
            )}
          </div>

          {weightedPreview && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5 text-[12.5px] md:col-span-2">
              <span>
                Counts toward the forecast as{" "}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {weightedPreview.equation}
                </span>
              </span>
              <span className="font-heading text-lg font-semibold tabular-nums">
                {weightedPreview.amount}
              </span>
            </div>
          )}
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

        {/* Upload Supporting Documents */}
        <div className="space-y-1.5">
          <div className="flex flex-1 justify-between items-center">
            <span id={notesLabelId} className={labelCls}>
              Upload Supporting Documents
            </span>

            <Button
              size="sm"
              variant="outline"
              className="flex items-center gap-1 text-xs"
              disabled={isSubmitting}
              onClick={async () => {
                if (queuedFiles.length === 0) {
                  showToast("Add at least one file before uploading.", "error");
                  return;
                }
                setIsSubmitting(true);
                try {
                  const uploadedFiles = await Promise.all(
                    queuedFiles.map(async (file) => {
                      if (file.status === "uploaded" && file.url) {
                        return {
                          id: file.id,
                          name: file.file.name,
                          url: file.url,
                          size: file.file.size,
                        };
                      }
                      if (
                        file.status === "queued" ||
                        file.status === "uploading"
                      ) {
                        const url = await uploadQueuedFile(file);
                        return {
                          id: file.id,
                          name: file.file.name,
                          url,
                          size: file.file.size,
                        };
                      }
                      throw new Error(`"${file.file.name}" failed to upload.`);
                    }),
                  );
                  setUploadedFiles((prev) => [...prev, ...uploadedFiles]);
                  resetQueue();
                  showToast("Files uploaded successfully", "success");
                } catch (error) {
                  console.error("Failed to upload files", error);
                  showToast("Failed to upload the files. Please try again.", "error");
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-3 w-3" />
                  Upload{" "}
                  {queuedFiles.length > 0
                    ? `(${queuedFiles.length}) file${queuedFiles.length === 1 ? "" : "s"}`
                    : ""}
                </>
              )}
            </Button>
          </div>
          <UploadDropzone
            label=""
            summary={
              queuedFiles.length > 0
                ? `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} · ${completedUploadCount} uploaded`
                : `Drop files here or browse • Up to ${maxFiles} files`
            }
            helperText="Files upload directly from the browser and stay visible below while they sync."
            files={queuedFiles}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            maxFiles={maxFiles}
            disabled={isSubmitting}
            isLoading={isSubmitting}
            onFilesSelected={addFiles}
            removeFile={removeFile}
            dropzoneClassName="p-3"
            listClassName="p-2 space-y-1.5"
            itemClassName="p-2"
          />
        </div>

        {/* Uploaded Files */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-3">
            <h5 className={labelCls}>Uploaded Files</h5>

            <div className="space-y-2">
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {file.name}
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>

                  <Button asChild size="sm" variant="ghost">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-1 h-4 w-4" />
                      Open
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

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
