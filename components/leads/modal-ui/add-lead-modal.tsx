"use client";

import React, { useState } from "react";
import { Plus, Check, Bell, X } from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import {
  Lead,
  LeadSource,
  LeadStage,
  BudgetRange,
  ProjectType,
  HistoryItem,
} from "@/lib/leads/types";
import { createLead } from "@/lib/leads/leads-service";
import { useAvailableUsers } from "@/hooks/use-available-users";
import {
  LEAD_SOURCE_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  HISTORY_TYPE_OPTIONS,
  BUDGET_OPTIONS,
  createCalendarEventIfValid,
} from "@/lib/leads/lead-helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ── Types ── */

interface HistoryEntryDraft {
  action: string;
  detail: string;
  type: HistoryItem["type"];
  actionDate: string;
}

interface AddLeadFormData {
  name: string;
  phone: string;
  email: string;
  location: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId: string;
  budget: string;
  type: ProjectType[];
  notes: string;
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  historyEntries: HistoryEntryDraft[];
}

interface AddLeadModalProps {
  onClose: () => void;
  onSuccess: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

/* ── Component ── */

export function AddLeadModal({
  onClose,
  onSuccess,
  showToast,
}: AddLeadModalProps) {
  const availableUsers = useAvailableUsers();

  const [form, setForm] = useState<AddLeadFormData>({
    name: "",
    phone: "",
    email: "",
    location: "",
    sourceDetail: "Personal",
    stage: "New",
    assignedId: "",
    budget: "Not Discussed",
    type: ["Not Specified"],
    notes: "",
    followupDate: "",
    followupTime: "",
    urgent: false,
    historyEntries: [],
  });

  const [historyDraft, setHistoryDraft] = useState<HistoryEntryDraft>({
    action: "",
    detail: "",
    type: "system",
    actionDate: "",
  });

  const [saving, setSaving] = useState(false);
  const [savingWithReminder, setSavingWithReminder] = useState(false);

  /* ── Helpers ── */

  const updateField = (field: keyof AddLeadFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleProjectType = (value: ProjectType) =>
    setForm((prev) => {
      if (value === "Not Specified") return { ...prev, type: ["Not Specified"] };
      const base = prev.type.filter((t) => t !== "Not Specified");
      const next = prev.type.includes(value)
        ? base.filter((t) => t !== value)
        : [...base, value];
      return { ...prev, type: next.length > 0 ? next : ["Not Specified"] };
    });

  const addHistoryEntry = () => {
    if (!historyDraft.action.trim() && !historyDraft.detail.trim()) return;
    setForm((prev) => ({
      ...prev,
      historyEntries: [...prev.historyEntries, { ...historyDraft }],
    }));
    setHistoryDraft({ action: "", detail: "", type: "system", actionDate: "" });
  };

  const removeHistoryEntry = (index: number) =>
    setForm((prev) => ({
      ...prev,
      historyEntries: prev.historyEntries.filter((_, i) => i !== index),
    }));

  const isFormValid =
    form.name.trim() &&
    form.phone.trim() &&
    form.location.trim() &&
    form.assignedId.trim() &&
    form.email.trim();

  /* ── Submit ── */

  const handleSubmit = async (setReminder: boolean) => {
    const setLoading = setReminder ? setSavingWithReminder : setSaving;
    setLoading(true);

    try {
      const stage: LeadStage =
        form.followupDate && form.followupTime ? "In Follow-up" : "Contacted";

      let calendarCreated = true;
      if (stage === "In Follow-up") {
        calendarCreated = await createCalendarEventIfValid(
          {
            name: form.name,
            email: form.email,
            followupDate: form.followupDate,
            followupTime: form.followupTime,
          },
          showToast,
        );
      }

      const today = new Date();
      const historyEntries = form.historyEntries.map((entry) => ({
        action: entry.action.trim() || "Note",
        detail: entry.detail.trim(),
        type: entry.type,
        actionDate: entry.actionDate || today.toISOString(),
      }));

      const createdLead = await createLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        location: form.location,
        source: form.sourceDetail as LeadSource,
        sourceDetail: form.sourceDetail,
        stage,
        assignedId: form.assignedId || null,
        budget: form.budget as BudgetRange,
        type: form.type.length > 0 ? form.type : ["Not Specified"],
        notes: form.notes,
        followupDate: form.followupDate || null,
        followupTime: form.followupTime || null,
        followupNotes: "",
        urgent: form.urgent,
        history: historyEntries,
      });

      onSuccess(createdLead);
      showToast(`Lead added: ${form.name}`, "success");

      if (!calendarCreated) {
        showToast("Lead was saved, but the calendar reminder could not be created.", "info");
      }

      if (setReminder && calendarCreated) {
        showToast(
          `Reminder set for ${form.followupDate || today.toISOString().split("T")[0]} at ${form.followupTime || "10:00"}`,
          "info",
        );
      }
    } catch (error) {
      console.error(error);
      showToast("Failed to create lead. Please try again.", "info");
    } finally {
      setSaving(false);
      setSavingWithReminder(false);
    }
  };

  /* ── Styles ── */

  const fieldCls =
    "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-none transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10";
  const textareaCls =
    "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10";
  const sectionLbl = "text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const itemLbl = "text-xs font-medium text-muted-foreground";

  /* ── Render ── */

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Add New Lead"
      subtitle="Manually add a lead to the pipeline"
      maxWidthClass="max-w-[920px]"
    >
      <div className="space-y-5">
        {/* Row 1: Contact + Source */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={itemLbl}>Full Name *</label>
            <input
              className={fieldCls}
              placeholder="e.g. Jaswinder Singh"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLbl}>Phone *</label>
            <input
              className={fieldCls}
              placeholder="e.g. 0412 345 678"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLbl}>Email *</label>
            <input
              className={fieldCls}
              placeholder="e.g. name@email.com"
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLbl}>Location *</label>
            <input
              className={fieldCls}
              placeholder="e.g. Blacktown, NSW"
              value={form.location}
              onChange={(e) => updateField("location", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLbl}>Source Detail</label>
            <select
              className={fieldCls}
              value={form.sourceDetail}
              onChange={(e) => updateField("sourceDetail", e.target.value)}
            >
              {LEAD_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={itemLbl}>Assigned To *</label>
            <select
              className={fieldCls}
              value={form.assignedId}
              onChange={(e) => updateField("assignedId", e.target.value)}
            >
              <option value="" disabled>
                Select a person
              </option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={itemLbl}>Budget Range</label>
            <select
              className={fieldCls}
              value={form.budget}
              onChange={(e) => updateField("budget", e.target.value)}
            >
              {BUDGET_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Project Type */}
        <div>
          <label className={sectionLbl}>Project Type</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PROJECT_TYPE_OPTIONS.map((option) => (
              <label
                key={option}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                  form.type.includes(option)
                    ? "border-teal-600 bg-teal-50 text-teal-700"
                    : "border-border bg-background text-muted-foreground hover:border-teal-300 hover:bg-teal-50/40",
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-teal-600"
                  checked={form.type.includes(option)}
                  onChange={() => toggleProjectType(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={itemLbl}>Notes</label>
          <textarea
            className={textareaCls}
            rows={3}
            placeholder="Initial notes about this lead..."
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
          />
        </div>

        {/* Follow-up */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={itemLbl}>Follow-up Date</label>
            <input
              className={fieldCls}
              type="date"
              value={form.followupDate}
              onChange={(e) => updateField("followupDate", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLbl}>Follow-up Time</label>
            <input
              className={fieldCls}
              type="time"
              value={form.followupTime}
              onChange={(e) => updateField("followupTime", e.target.value)}
            />
          </div>
        </div>

        {/* Urgent */}
        <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-teal-600"
            checked={form.urgent}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, urgent: e.target.checked }))
            }
          />
          Mark this lead as urgent
        </label>

        {/* History */}
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <label className={sectionLbl}>History</label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addHistoryEntry}
            >
              <Plus className="mr-1 size-3.5" /> Add Entry
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={itemLbl}>Action</label>
              <input
                className={fieldCls}
                placeholder="e.g. Called client"
                value={historyDraft.action}
                onChange={(e) =>
                  setHistoryDraft((p) => ({ ...p, action: e.target.value }))
                }
              />
            </div>
            <div>
              <label className={itemLbl}>Type</label>
              <select
                className={fieldCls}
                value={historyDraft.type}
                onChange={(e) =>
                  setHistoryDraft((p) => ({
                    ...p,
                    type: e.target.value as HistoryItem["type"],
                  }))
                }
              >
                {HISTORY_TYPE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={itemLbl}>Action Date</label>
              <input
                className={fieldCls}
                type="datetime-local"
                value={historyDraft.actionDate}
                onChange={(e) =>
                  setHistoryDraft((p) => ({ ...p, actionDate: e.target.value }))
                }
              />
            </div>
            <div className="md:col-span-2">
              <label className={itemLbl}>Detail</label>
              <textarea
                className={textareaCls}
                rows={2}
                placeholder="Add details about the action taken..."
                value={historyDraft.detail}
                onChange={(e) =>
                  setHistoryDraft((p) => ({ ...p, detail: e.target.value }))
                }
              />
            </div>
          </div>

          {form.historyEntries.length > 0 && (
            <div className="space-y-2">
              {form.historyEntries.map((entry, i) => (
                <div
                  key={`${entry.action}-${i}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">
                      {entry.action || "Note"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.detail || "No details provided."}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.actionDate
                        ? new Date(entry.actionDate).toLocaleString()
                        : "No date set"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {entry.type}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => removeHistoryEntry(i)}
                      aria-label="Remove history entry"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            onClick={() => handleSubmit(false)}
            disabled={!isFormValid || saving || savingWithReminder}
          >
            {saving ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving Lead...
              </>
            ) : (
              <>
                <Check size={15} /> Save Lead
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit(true)}
            disabled={!isFormValid || saving || savingWithReminder}
          >
            {savingWithReminder ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
                Saving & Setting Reminder...
              </>
            ):null}
            {!savingWithReminder && (
              <>
                <Bell size={15} /> Save & Set Reminder
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
