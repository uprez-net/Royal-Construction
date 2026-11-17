"use client";

import React, { useState } from "react";
import { Plus, Check, Bell, X, AlertTriangle } from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import {
  Lead,
  LeadSource,
  LeadStage,
  BudgetRange,
  ProjectType,
  HistoryItem,
} from "@/lib/leads/types";
import {
  createLead,
  isDuplicateLeadResult,
  type DuplicateLeadResult,
} from "@/lib/leads/leads-service";
import { FetchError } from "@/utils/fetch";
import { useAvailableUsers } from "@/hooks/use-available-users";
import {
  LEAD_SOURCE_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  HISTORY_TYPE_OPTIONS,
  BUDGET_OPTIONS,
} from "@/lib/leads/lead-helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createTask } from "@/lib/leads/task-service";
import { sydneyStartOfDay } from "@/lib/dates/sydney";

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
  secondaryName: string;
  secondaryEmail: string;
  secondaryPhone: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId: string;
  budget: string;
  estimatedValue: string;
  expectedCloseDate: string;
  estimatedStartDate: string;
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
    secondaryName: "",
    secondaryEmail: "",
    secondaryPhone: "",
    sourceDetail: "Personal",
    stage: "New",
    assignedId: "",
    budget: "Not Discussed",
    estimatedValue: "",
    expectedCloseDate: "",
    estimatedStartDate: "",
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
  // A toast is gone before the user has finished reading which lead they just
  // re-entered, so the duplicate the server named stays on screen until the
  // email or phone that collided is changed.
  const [duplicate, setDuplicate] = useState<DuplicateLeadResult | null>(null);
  const formId = React.useId();
  const fieldId = (name: string) => `${formId}-${name}`;
  const requiredFieldsId = fieldId("required-fields");

  /* ── Helpers ── */

  const updateField = (field: keyof AddLeadFormData, value: string) => {
    // Email and phone are the two fields the duplicate check matches on, so
    // touching either means the warning may no longer hold.
    if (field === "email" || field === "phone") setDuplicate(null);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleProjectType = (value: ProjectType) =>
    setForm((prev) => {
      if (value === "Not Specified")
        return { ...prev, type: ["Not Specified"] };
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
    form.name.trim()
    && form.phone.trim()
    && form.location.trim()
    && form.assignedId.trim()
    && form.email.trim();
  const missingRequiredFields = [
    !form.name.trim() && "primary client name",
    !form.phone.trim() && "phone",
    !form.email.trim() && "email",
    !form.location.trim() && "location",
    !form.assignedId.trim() && "assigned person",
  ].filter(Boolean);

  /* ── Submit ── */

  const handleSubmit = async (setReminder: boolean) => {
    if (!form.email.trim()) {
      showToast("Please add an email to create the lead.", "error");
      return;
    }

    if (!form.assignedId.trim()) {
      showToast("Please assign the lead to someone to create it.", "error");
      return;
    }

    const setLoading = setReminder ? setSavingWithReminder : setSaving;
    setLoading(true);
    setDuplicate(null);

    try {
      // Booking work at creation means Discovery has started. It used to write
      // "In Follow-up", which was a task masquerading as a stage: the lead then
      // dropped to Contacted the moment somebody answered the call.
      const stage: LeadStage =
        form.followupDate && form.followupTime ? "Discovery" : "Contacted";

      // let calendarCreated = true;
      // if (stage === "In Follow-up") {
      //   calendarCreated = await createCalendarEventIfValid(
      //     {
      //       name: form.name,
      //       email: form.email,
      //       followupDate: form.followupDate,
      //       followupTime: form.followupTime,
      //     },
      //     showToast,
      //   );
      // }

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
        secondaryName: form.secondaryName || null,
        secondaryEmail: form.secondaryEmail || null,
        secondaryPhone: form.secondaryPhone || null,
        source: form.sourceDetail as LeadSource,
        sourceDetail: form.sourceDetail,
        stage,
        assignedId: form.assignedId || null,
        budget: form.budget as BudgetRange,
        estimatedValue: form.estimatedValue === "" ? null : form.estimatedValue,
        expectedCloseDate: form.expectedCloseDate || null,
        estimatedStartDate: form.estimatedStartDate || null,
        type: form.type.length > 0 ? form.type : ["Not Specified"],
        notes: form.notes,
        // The date is still stored on the lead for now, and the task below is
        // what anything actually reads. Both go until the columns are dropped.
        followupDate: form.followupDate || null,
        followupTime: form.followupTime || null,
        followupNotes: "",
        urgent: form.urgent,
        history: historyEntries,
      });

      // The server answers a duplicate with the lead it collided with. Naming
      // that lead is the difference between "try again" and "here it is".
      if (isDuplicateLeadResult(createdLead)) {
        setDuplicate(createdLead);
        showToast(
          `${createdLead.message} Already in the pipeline as ${createdLead.existingLead.name}.`,
          "error",
        );
        return;
      }

      // A new lead booked with a follow-up needs a task, or the work is
      // invisible: the Follow-ups tab and both reminder crons read LeadTask.
      // Failing here must not fail the lead, which already exists by now.
      let saved = createdLead;
      if (form.followupDate) {
        try {
          const task = await createTask({
            leadId: createdLead.id,
            type: "CALL",
            dueDate: sydneyStartOfDay(form.followupDate).toISOString(),
            dueTime: form.followupTime || null,
          });
          // The task carries the lead's stage after any advance, so the row
          // the list renders is not one revision behind.
          if (task.lead.stage !== createdLead.stage) {
            saved = { ...createdLead, stage: task.lead.stage };
          }
        } catch (taskError) {
          console.error("Lead created but its first task was not", taskError);
          showToast(
            "Lead saved, but the follow-up task could not be created.",
            "info",
          );
        }
      }

      onSuccess(saved);
      showToast(`Lead added: ${form.name}`, "success");

      // if (!calendarCreated) {
      //   showToast("Lead was saved, but the calendar reminder could not be created.", "info");
      // }

      // if (setReminder && calendarCreated) {
      //   showToast(
      //     `Reminder set for ${form.followupDate || today.toISOString().split("T")[0]} at ${form.followupTime || "10:00"}`,
      //     "info",
      //   );
      // }
    } catch (error) {
      console.error(error);
      if (error instanceof FetchError) {
        console.error(
          "error Status:",
          error.status,
          "error Message:",
          error.message,
        );
        // Reached only when the 409 body could not be read; the normal path
        // returns the duplicate above, along with the lead it matched.
        if (error.status === 409) {
          showToast(
            "A lead with the same email or phone number already exists. Check in Leads Table",
            "error",
          );
          return;
        }
      }
      showToast("Failed to create the lead. Please try again.", "error");
    } finally {
      setSaving(false);
      setSavingWithReminder(false);
    }
  };

  /* ── Styles ── */

  const fieldCls =
    "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-none transition-all focus:border-[color:var(--royal-gold)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--royal-gold-light)]";
  const textareaCls =
    "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none transition-all focus:border-[color:var(--royal-gold)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--royal-gold-light)]";
  const sectionLbl =
    "text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground";
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
            <label htmlFor={fieldId("name")} className={itemLbl}>
              Primary Client *
            </label>
            <input
              id={fieldId("name")}
              className={fieldCls}
              placeholder="e.g. Jaswinder Singh"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={fieldId("phone")} className={itemLbl}>
              Phone *
            </label>
            <input
              id={fieldId("phone")}
              className={fieldCls}
              placeholder="e.g. 0412 345 678"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={fieldId("email")} className={itemLbl}>
              Email *
            </label>
            <input
              id={fieldId("email")}
              className={fieldCls}
              placeholder="e.g. name@email.com"
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={fieldId("location")} className={itemLbl}>
              Location *
            </label>
            <input
              id={fieldId("location")}
              className={fieldCls}
              placeholder="e.g. Blacktown, NSW"
              value={form.location}
              onChange={(e) => updateField("location", e.target.value)}
              required
            />
          </div>
        </div>

        {/* Row 1.5: Secondary client (optional) */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("secondary-name")} className={itemLbl}>
              Secondary Client
            </label>
            <input
              id={fieldId("secondary-name")}
              className={fieldCls}
              placeholder="e.g. Harpreet Kaur"
              value={form.secondaryName}
              onChange={(e) => updateField("secondaryName", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={fieldId("secondary-phone")} className={itemLbl}>
              Secondary Phone
            </label>
            <input
              id={fieldId("secondary-phone")}
              className={fieldCls}
              placeholder="e.g. 0412 345 678"
              value={form.secondaryPhone}
              onChange={(e) => updateField("secondaryPhone", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={fieldId("secondary-email")} className={itemLbl}>
              Secondary Email
            </label>
            <input
              id={fieldId("secondary-email")}
              className={fieldCls}
              placeholder="e.g. name@email.com"
              type="email"
              value={form.secondaryEmail}
              onChange={(e) => updateField("secondaryEmail", e.target.value)}
            />
          </div>
        </div>

        {/* Row 2: Source + Assignment + Budget */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("source-detail")} className={itemLbl}>
              Source Detail
            </label>
            <select
              id={fieldId("source-detail")}
              className={fieldCls}
              value={form.sourceDetail}
              onChange={(e) => updateField("sourceDetail", e.target.value)}
            >
              {LEAD_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("assigned-to")} className={itemLbl}>
              Assigned To *
            </label>
            <select
              id={fieldId("assigned-to")}
              className={fieldCls}
              value={form.assignedId}
              onChange={(e) => updateField("assignedId", e.target.value)}
              required
            >
              <option value="" disabled>
                Select a person
              </option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("budget")} className={itemLbl}>
              Budget Range
            </label>
            <select
              id={fieldId("budget")}
              className={fieldCls}
              value={form.budget}
              onChange={(e) => updateField("budget", e.target.value)}
            >
              {BUDGET_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Deal value + expected close. No likelihood field here — a new lead
            follows its stage default, and the value is usually unknown until
            an offer is priced, at which point it auto-fills. */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fieldId("estimated-value")} className={itemLbl}>
              Deal value (optional)
            </label>
            <input
              id={fieldId("estimated-value")}
              type="number"
              min={0}
              step={1000}
              className={fieldCls}
              value={form.estimatedValue}
              onChange={(e) => updateField("estimatedValue", e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Fills in automatically once an offer is priced.
            </span>
          </div>
          <div>
            <label htmlFor={fieldId("expected-close")} className={itemLbl}>
              Expected close (optional)
            </label>
            <input
              id={fieldId("expected-close")}
              type="date"
              className={fieldCls}
              value={form.expectedCloseDate}
              onChange={(e) => updateField("expectedCloseDate", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={fieldId("estimated-start")} className={itemLbl}>
              Est. start date (optional)
            </label>
            <input
              id={fieldId("estimated-start")}
              type="date"
              className={fieldCls}
              value={form.estimatedStartDate}
              onChange={(e) =>
                updateField("estimatedStartDate", e.target.value)
              }
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              When HBCF capacity planning should begin for this lead.
            </span>
          </div>
        </div>

        {/* Project Type */}
        <div>
          <p className={sectionLbl}>Project Type</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PROJECT_TYPE_OPTIONS.map((option) => (
              <label
                key={option}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                  form.type.includes(option)
                    ? "border-royal-gold bg-royal-gold-light text-royal-gold-ink-text"
                    : "border-border bg-background text-muted-foreground hover:border-royal-gold hover:bg-royal-gold-light",
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-royal-gold"
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
          <label htmlFor={fieldId("notes")} className={itemLbl}>
            Notes
          </label>
          <textarea
            id={fieldId("notes")}
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
            <label htmlFor={fieldId("followup-date")} className={itemLbl}>
              Follow-up Date
            </label>
            <input
              id={fieldId("followup-date")}
              className={fieldCls}
              type="date"
              min={new Date().toLocaleDateString("en-CA", {
                timeZone: "Australia/Sydney",
              })}
              value={form.followupDate}
              onChange={(e) => updateField("followupDate", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={fieldId("followup-time")} className={itemLbl}>
              Follow-up Time
            </label>
            <input
              id={fieldId("followup-time")}
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
            id={fieldId("urgent")}
            type="checkbox"
            className="size-3.5 accent-royal-gold"
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
            <p className={sectionLbl}>History</p>
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
              <label htmlFor={fieldId("history-action")} className={itemLbl}>
                Action
              </label>
              <input
                id={fieldId("history-action")}
                className={fieldCls}
                placeholder="e.g. Called client"
                value={historyDraft.action}
                onChange={(e) =>
                  setHistoryDraft((p) => ({ ...p, action: e.target.value }))
                }
              />
            </div>
            <div>
              <label htmlFor={fieldId("history-type")} className={itemLbl}>
                Type
              </label>
              <select
                id={fieldId("history-type")}
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
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={fieldId("history-date")} className={itemLbl}>
                Action Date
              </label>
              <input
                id={fieldId("history-date")}
                className={fieldCls}
                type="datetime-local"
                value={historyDraft.actionDate}
                onChange={(e) =>
                  setHistoryDraft((p) => ({ ...p, actionDate: e.target.value }))
                }
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor={fieldId("history-detail")} className={itemLbl}>
                Detail
              </label>
              <textarea
                id={fieldId("history-detail")}
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

        {/* Duplicate warning — the lead the server matched on email or phone */}
        {duplicate && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-destructive">
                {duplicate.message}
              </p>
              <p className="text-xs text-muted-foreground">
                Already in the pipeline as{" "}
                <span className="font-semibold text-foreground">
                  {duplicate.existingLead.name}
                </span>{" "}
                — {duplicate.existingLead.stage}
                {duplicate.existingLead.assignedUser
                  ? `, assigned to ${duplicate.existingLead.assignedUser.name}`
                  : ", unassigned"}
                .
              </p>
              <p className="text-xs text-muted-foreground">
                {duplicate.existingLead.email} · {duplicate.existingLead.phone}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Change the email or phone to save this as a separate lead.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            onClick={() => handleSubmit(false)}
            disabled={!isFormValid || saving || savingWithReminder}
            aria-describedby={!isFormValid ? requiredFieldsId : undefined}
          >
            {saving ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
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
            aria-describedby={!isFormValid ? requiredFieldsId : undefined}
          >
            {savingWithReminder ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-royal-gold border-t-transparent" />
                Saving & Setting Reminder...
              </>
            ) : null}
            {!savingWithReminder && (
              <>
                <Bell size={15} /> Save & Set Reminder
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!isFormValid && (
            <p
              id={requiredFieldsId}
              className="basis-full text-xs font-medium text-destructive"
            >
              Required: {missingRequiredFields.join(", ")}.
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
