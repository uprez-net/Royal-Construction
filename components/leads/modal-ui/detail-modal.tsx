import React, { useState, useMemo } from "react";
import { Lead, LeadSource, LeadStage, HistoryItem } from "@/lib/leads/types";
import { updateLead } from "@/lib/leads/leads-service";
import {
  LeadDetailFormData,
  leadToFormData,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  HISTORY_TYPE_OPTIONS,
  BUDGET_OPTIONS,
  createCalendarEventIfValid,
  shouldCreateCalendarEvent,
  buildCalendarHistoryEntry,
  isLostStage,
} from "@/lib/leads/lead-helpers";
import { ModalShell } from "@/components/common/modal-shell";

interface DetailModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead) => void;
  onDeleteClick: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info") => void;
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
  const [form, setForm] = useState<LeadDetailFormData>(() =>
    leadToFormData(lead),
  );
  const baseline = useMemo(() => leadToFormData(lead), [lead]);
  const [historyDraft, setHistoryDraft] = useState({
    action: "",
    detail: "",
    type: "call" as HistoryItem["type"],
  });
  const [isUpdating, setIsUpdating] = useState(false);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );

  const patch = (updates: Partial<LeadDetailFormData>) =>
    setForm((prev) => (prev ? { ...prev, ...updates } : prev));

  const addHistoryEntry = () => {
    if (!historyDraft.action.trim() && !historyDraft.detail.trim()) return;
    const now = new Date();
    patch({
      historyEntries: [
        ...form.historyEntries,
        {
          action: historyDraft.action,
          detail: historyDraft.detail,
          type: historyDraft.type,
          date: now.toISOString().slice(0, 10),
          time: now.toTimeString().slice(0, 5),
        },
      ],
    });
    setHistoryDraft({ action: "", detail: "", type: "call" });
  };

  const handleUpdate = async () => {
    if (isLostStage(form.stage) && !form.lostReason.trim()) {
      showToast(`Please provide a reason for the ${form.stage} lead.`, "info");
      return;
    }

    setIsUpdating(true);
    try {
      let stage = form.stage;
      const historyToSend = [...form.historyEntries];

      if (shouldCreateCalendarEvent(lead, form)) {
        const success = await createCalendarEventIfValid(form, showToast);
        if (!success) return;
        stage = "In Follow-up";
        historyToSend.push(
          buildCalendarHistoryEntry(form.followupDate, form.followupTime),
        );
      }

      const typeValue = (form.type.length > 0 ? form.type : ["Not Specified"])
        .join(", ");

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
        followupDate: form.followupDate,
        followupTime: form.followupTime,
        urgent: form.urgent,
        lostReason: isLostStage(stage) ? form.lostReason : "",
        history: historyToSend,
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

  /* ── Common input class ── */
  const inputCls =
    "mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]";
  const smallInputCls =
    "mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-1.5 text-xs text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]";

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
            <span className="status-banner-title">
              Status: {form.stage}
            </span>
            <span className="status-banner-text">
              {form.lostReason
                ? `Reason: ${form.lostReason}`
                : "Add a reason before updating."}
            </span>
          </div>
        )}

        {/* Contact fields */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-[#78716c]">Name</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">Phone</label>
            <input
              className={inputCls}
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">Email</label>
            <input
              className={inputCls}
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">
              Location
            </label>
            <input
              className={inputCls}
              value={form.location}
              onChange={(e) => patch({ location: e.target.value })}
            />
          </div>
        </div>

        {/* Source + Stage */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-[#78716c]">
              Source Detail
            </label>
            <select
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
            <label className="text-xs font-medium text-[#78716c]">Stage</label>
            <select
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
            <label className="text-xs font-medium text-[#78716c]">
              Assigned To
            </label>
            <select
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
            <label className="text-xs font-medium text-[#78716c]">Budget</label>
            <select
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
            <label className="text-xs font-medium text-[#78716c]">
              Follow-up Date
            </label>
            <input
              type="date"
              className={inputCls}
              value={form.followupDate}
              onChange={(e) => patch({ followupDate: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">
              Follow-up Time
            </label>
            <input
              type="time"
              className={inputCls}
              value={form.followupTime}
              onChange={(e) => patch({ followupTime: e.target.value })}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-[#78716c]">Notes</label>
          <textarea
            className={inputCls}
            rows={4}
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </div>

        {/* Urgent */}
        <div className="flex items-center gap-2">
          <input
            id="urgent-checkbox"
            type="checkbox"
            checked={form.urgent}
            onChange={(e) => patch({ urgent: e.target.checked })}
          />
          <label
            htmlFor="urgent-checkbox"
            className="text-xs font-medium text-[#78716c]"
          >
            Urgent
          </label>
        </div>

        {/* History */}
        <div>
          <label className="text-xs font-medium text-[#78716c]">History</label>
          {lead.history.length === 0 ? (
            <div className="mt-2 text-xs text-[#a8a29e]">
              No history recorded yet.
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

          {/* Add new history entry */}
          <div className="mt-4 rounded-[8px] border border-[#e5e7eb] bg-[#fafaf9] p-3">
            <h5 className="mb-3 text-xs font-medium text-[#0c0a09]">
              Add New History Entry
            </h5>

            {form.historyEntries.length > 0 && (
              <div className="mb-4 space-y-2">
                {form.historyEntries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between rounded-[6px] border border-[#e5e7eb] bg-white p-2 text-xs"
                  >
                    <div>
                      <div className="font-medium text-[#0c0a09]">
                        {entry.action}{" "}
                        <span className="font-normal text-[#a8a29e]">
                          ({entry.type})
                        </span>
                      </div>
                      {entry.detail && (
                        <div className="mt-0.5 text-[#78716c]">
                          {entry.detail}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-[#a8a29e]">
                        {entry.date} {entry.time}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[#e5e7eb]">
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[#78716c]">
                  Action
                </label>
                <input
                  className={smallInputCls}
                  placeholder="e.g. Left a voicemail"
                  value={historyDraft.action}
                  onChange={(e) =>
                    setHistoryDraft((prev) => ({
                      ...prev,
                      action: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[#78716c]">
                  Detail
                </label>
                <textarea
                  className={smallInputCls}
                  placeholder="Additional context..."
                  rows={2}
                  value={historyDraft.detail}
                  onChange={(e) =>
                    setHistoryDraft((prev) => ({
                      ...prev,
                      detail: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[#78716c]">
                  Type
                </label>
                <select
                  className={smallInputCls}
                  value={historyDraft.type}
                  onChange={(e) =>
                    setHistoryDraft((prev) => ({
                      ...prev,
                      type: e.target.value as HistoryItem["type"],
                    }))
                  }
                >
                  {HISTORY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="w-full rounded-[4px] bg-[#0c0a09] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#292524] disabled:opacity-50"
                  onClick={addHistoryEntry}
                  disabled={
                    !historyDraft.action.trim() && !historyDraft.detail.trim()
                  }
                >
                  Add Entry
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Lost reason */}
        {isLostStage(form.stage) && (
          <div className="col-span-1 rounded-[8px] border border-red-200 bg-red-50 p-4 md:col-span-2">
            <label className="text-sm font-medium text-red-900">
              Reason for {form.stage}{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              className={`mt-1 w-full rounded-[4px] border ${!form.lostReason.trim() ? "border-red-400 ring-1 ring-red-400/20" : "border-[#d6d3d1]"} bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200`}
              placeholder="e.g. Went with competitor, Price ..."
              value={form.lostReason}
              onChange={(e) => patch({ lostReason: e.target.value })}
            />
            {!form.lostReason.trim() && (
              <p className="mt-1.5 text-xs font-medium text-red-600">
                This is required when marking a lead as {form.stage}.
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleUpdate}
            disabled={!hasChanges || isUpdating}
          >
            {isUpdating ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
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
              className="inline-flex items-center justify-center rounded-full border border-[#fecaca] bg-[#fee2e2] px-4 py-2 text-xs font-medium text-[#b91c1c] transition hover:border-[#fca5a5]"
              onClick={() => onDeleteClick(lead)}
            >
              Delete Lead
            </button>
          )}

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </ModalShell>
  );
}