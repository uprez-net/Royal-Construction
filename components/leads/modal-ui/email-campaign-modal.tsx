"use client";

import React, { useMemo, useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Mail,
  Users,
  X,
  RotateCcw,
  Search,
  UserMinus,
  UserPlus,
  CheckSquare,
  Square,
} from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead, EmailTemplate } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { sendEmailToLead, fetchAllLeads } from "@/lib/leads/leads-service";
import {
  hydrateVariable,
  previewTemplateText,
  getTemplateDescription,
} from "@/lib/leads/lead-helpers";
import { Button } from "@/components/ui/button";
import { ReactEmailIframe } from "../render-email";
import { useEmailAdHock } from "@/hooks/use-email-ad-hock";
import { CustomTemplateCreation } from "./custom-template-creation";
import { getEditablePreviewHtml } from "@/lib/utils/email-preview";

interface EmailCampaignModalProps {
  leads: Lead[];
  onClose: () => void;
  onCampaignComplete: (updatedLeads: Lead[]) => Promise<void>;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

type Step = "select" | "compose" | "custom";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecipientInfo {
  email: string;
  name: string;
}

export function EmailCampaignModal({
  leads,
  onClose,
  onCampaignComplete,
  showToast,
}: EmailCampaignModalProps) {
  const [step, setStep] = useState<Step>("select");

  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  /* Template / Compose state */
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [sending, setSending] = useState(false);

  /* ── Recipient Management State ── */
  const [allRecipients, setAllRecipients] = useState<RecipientInfo[]>([]);
  const [activeRecipients, setActiveRecipients] = useState<RecipientInfo[]>(
    [],
  );
  const [removedRecipients, setRemovedRecipients] = useState<RecipientInfo[]>(
    [],
  );
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [showRecipientManager, setShowRecipientManager] = useState(false);
  const [showRemovedSection, setShowRemovedSection] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const emailIframeRef = React.useRef<HTMLIFrameElement>(null);
  const hook = useEmailAdHock();

  // ─── Auto-transition to Compose when AI finishes ───
  const [prevGeneratedHtml, setPrevGeneratedHtml] = useState<string | null>(
    null,
  );
  const aiReady = !!(
    hook.templateName &&
    hook.generatedHtml &&
    hook.emailSubject
  );
  if (aiReady && prevGeneratedHtml !== hook.generatedHtml) {
    setPrevGeneratedHtml(hook.generatedHtml);
    setSubjectTemplate(hook.emailSubject);
    setSelectedTemplate({
      id: -1,
      category: "custom",
      subject: hook.emailSubject,
    } as EmailTemplate);
    setStep("compose");
  }

  const activeEmails = useMemo(
    () => activeRecipients.map((r) => r.email),
    [activeRecipients],
  );

  const invalidTargets = useMemo(
    () => activeEmails.filter((email) => !EMAIL_PATTERN.test(email.trim())),
    [activeEmails],
  );

  const recipientPreview = useMemo(
    () =>
      activeRecipients
        .slice(0, 4)
        .map((r) => r.email)
        .join(", "),
    [activeRecipients],
  );

  /* ── Fetch all leads for recipients on mount ── */
  useEffect(() => {
    const loadTargets = async () => {
      try {
        setLoadingTargets(true);
        const data = await fetchAllLeads();
        setAllLeads(data);
        const recipients: RecipientInfo[] = data
          .filter((l) => l.email)
          .map((l) => ({
            email: l.email!,
            name:
              `${l.name}`.trim() || l.email!,
          }));
        setAllRecipients(recipients);
        setActiveRecipients(recipients);
        setRemovedRecipients([]);
      } catch (error) {
        console.error("Failed to load leads:", error);
        const recipients: RecipientInfo[] = leads
          .filter((l) => l.email)
          .map((l) => ({
            email: l.email!,
            name:
              `${l.name}`.trim() || l.email!,
          }));
        setAllRecipients(recipients);
        setActiveRecipients(recipients);
        setRemovedRecipients([]);
      } finally {
        setLoadingTargets(false);
      }
    };
    loadTargets();
  }, [leads]);

  /* ── Recipient Actions ── */
  const removeRecipient = useCallback(
    (email: string) => {
      setActiveRecipients((prev) => prev.filter((r) => r.email !== email));
      setRemovedRecipients((prev) => {
        const toRemove = allRecipients.find((r) => r.email === email);
        return toRemove ? [...prev, toRemove] : prev;
      });
      setBulkSelected((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    },
    [allRecipients],
  );

  const restoreRecipient = useCallback(
    (email: string) => {
      setRemovedRecipients((prev) => prev.filter((r) => r.email !== email));
      setActiveRecipients((prev) => {
        const toRestore = allRecipients.find((r) => r.email === email);
        // Insert back in a reasonable position (alphabetically)
        if (!toRestore) return prev;
        const insertIdx = prev.findIndex((r) => r.email > email);
        if (insertIdx === -1) return [...prev, toRestore];
        return [
          ...prev.slice(0, insertIdx),
          toRestore,
          ...prev.slice(insertIdx),
        ];
      });
      setBulkSelected((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    },
    [allRecipients],
  );

  const removeSelected = useCallback(() => {
    const toRemove = new Set(bulkSelected);
    if (toRemove.size === 0) return;
    setActiveRecipients((prev) => prev.filter((r) => !toRemove.has(r.email)));
    setRemovedRecipients((prev) => [
      ...prev,
      ...allRecipients.filter((r) => toRemove.has(r.email)),
    ]);
    setBulkSelected(new Set());
    setBulkSelectMode(false);
  }, [bulkSelected, allRecipients]);

  const restoreAll = useCallback(() => {
    setActiveRecipients(allRecipients);
    setRemovedRecipients([]);
    setBulkSelected(new Set());
    setBulkSelectMode(false);
  }, [allRecipients]);

  const toggleBulkSelect = useCallback(
    (email: string) => {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(email)) {
          next.delete(email);
        } else {
          next.add(email);
        }
        return next;
      });
    },
    [],
  );

  /* ── Filtered lists for search ── */
  const filteredActive = useMemo(() => {
    if (!searchQuery.trim()) return activeRecipients;
    const q = searchQuery.toLowerCase();
    return activeRecipients.filter(
      (r) =>
        r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [activeRecipients, searchQuery]);

  const selectAllVisible = useCallback(() => {
    setBulkSelected(new Set(filteredActive.map((r) => r.email)));
  }, [filteredActive]);

  const deselectAll = useCallback(() => {
    setBulkSelected(new Set());
  }, []);

  const filteredRemoved = useMemo(() => {
    if (!searchQuery.trim()) return removedRecipients;
    const q = searchQuery.toLowerCase();
    return removedRecipients.filter(
      (r) =>
        r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [removedRecipients, searchQuery]);

  /* ── Step: Select Template ── */
  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setSubjectTemplate(template.subject);
    setStep("compose");
  };

  /* ── Step: Send Emails ── */
  const handleSend = async () => {
    if (!selectedTemplate || activeRecipients.length === 0) return;
    setSending(true);

    let successCount = 0;
    const now = new Date();
    const activeEmailSet = new Set(activeRecipients.map((r) => r.email));

    try {
      const updated: Lead[] = [];
      const batchSize = 20;
      for (let index = 0; index < allLeads.length; index += batchSize) {
        const batch = allLeads.slice(index, index + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (lead) => {
            // Skip leads not in active recipients
            if (!lead.email || !activeEmailSet.has(lead.email)) return lead;

            let finalHtmlBody = "";
            try {
              const subject = hydrateVariable(subjectTemplate, lead);
              const iframeDoc = emailIframeRef.current?.contentDocument;
              if (iframeDoc) {
                // Clean up DOM artifacts from interactive preview
                iframeDoc.querySelectorAll(".rc-hover-toolbar").forEach((t) => t.remove());
                iframeDoc.querySelectorAll("a, button").forEach((el) => {
                  (el as HTMLElement).style.outline = "";
                  (el as HTMLElement).style.outlineOffset = "";
                });
                iframeDoc.body.contentEditable = "false";

                let cleanHtml = iframeDoc.body.innerHTML;
                cleanHtml = cleanHtml.replace(/\s*contenteditable="[^"]*"/gi, "",);
                cleanHtml = cleanHtml.replace(/\s*spellcheck="[^"]*"/gi, "",);
                cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi,"",);
                cleanHtml = cleanHtml.replace(/<script[\s\S]*?<\/script>/gi,"",);
                cleanHtml = cleanHtml.replace(/outline:\s*2px dashed #c6923a;?\s*/gi,"",);
                cleanHtml = cleanHtml.replace(/outline-offset:\s*2px;?\s*/gi, "",);
                cleanHtml = cleanHtml.replace(/outline:\s*none;?\s*/gi, "",);
                finalHtmlBody = cleanHtml;
                finalHtmlBody = hydrateVariable(finalHtmlBody, lead);
              }

              if (!finalHtmlBody) {
                console.error(
                  `Failed to generate email content for ${lead.email}`,
                );
                return lead;
              }

              const sent = await sendEmailToLead(
                lead.email,
                subject,
                finalHtmlBody,
              );

              if (sent) {
                successCount++;
                return {
                  ...lead,
                  history: [
                    ...lead.history,
                    {
                      date: now.toISOString().slice(0, 10),
                      time: now.toTimeString().slice(0, 5),
                      action: "Email sent",
                      detail: `Subject: ${subject}`,
                      type: "email" as const,
                    },
                  ],
                };
              }

              console.error(`Failed to send email to ${lead.email}`);
              return lead;
            } catch (error) {
              console.error(`Error processing lead ${lead.email}:`, error);
              return lead;
            }
          }),
        );
        updated.push(...batchResults);
      }

      await onCampaignComplete(updated);
      showToast(
        `Emails sent to ${successCount} of ${activeRecipients.length} recipients`,
        "success",
      );
    } catch (error) {
      console.error("Send error:", error);
      showToast(
        "An unexpected error occurred while sending emails",
        "info",
      );
    } finally {
      setSending(false);
      onClose();
    }
  };

  /* ── Loading UI ── */
  if (loadingTargets) {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Send Email"
        subtitle="Select a template to send to leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600">
            Loading recipients...
          </p>
        </div>
      </ModalShell>
    );
  }

  /* ════════════════════════════════════════════
     Render: Select Template
     ════════════════════════════════════════════ */
  if (step === "select") {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Send Email"
        subtitle="Select a template to send to leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-teal-100 bg-teal-50/30 px-4 py-3 text-sm text-foreground">
            Sending to:{" "}
            <span className="font-medium">{allRecipients.length}</span> leads
            with email
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setStep("custom")}
                className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-background p-6 shadow-sm transition hover:border-teal-600 hover:bg-teal-50/50 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/50 transition group-hover:border-teal-600 group-hover:bg-teal-100/80">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground/60 transition group-hover:text-teal-600"
                  >
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </div>
                <div className="mt-3 text-sm font-semibold text-foreground transition group-hover:text-teal-700">
                  Custom Template
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Create your own
                </div>
              </button>
              {EMAIL_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="group rounded-xl border border-border bg-background p-4 text-left shadow-sm transition hover:border-teal-600 hover:shadow-md"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {template.category}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {previewTemplateText(template.subject)}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {getTemplateDescription(template)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ModalShell>
    );
  }

  /* ════════════════════════════════════════════
     Render: Custom Template Creation
     ════════════════════════════════════════════ */
  if (step === "custom") {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Send Email"
        subtitle="Create a custom template"
        maxWidthClass="max-w-[720px]"
      >
        <CustomTemplateCreation
          hook={hook}
          backgroundColor="#26a6b5"
          borderColor="#26A7B5DA"
        />
      </ModalShell>
    );
  }

  /* ════════════════════════════════════════════
     Render: Compose & Send
     ════════════════════════════════════════════ */
  return (
    <ModalShell
      open
      onClose={onClose}
      title="Send Email"
      subtitle={`To: ${activeRecipients.length} of ${allRecipients.length} recipients`}
      maxWidthClass="max-w-[640px]"
    >
      <div className="space-y-4">
        {/* ── Recipient Management Section ── */}
        <div className="rounded-lg border border-border bg-muted/20">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="flex min-w-0 gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700">
                <Users className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {activeRecipients.length} recipient
                  {activeRecipients.length !== 1 ? "s" : ""} selected
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {recipientPreview || "No recipients selected"}
                  {activeRecipients.length > 4
                    ? `, +${activeRecipients.length - 4} more`
                    : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {removedRecipients.length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
                  <UserMinus className="size-3" />
                  {removedRecipients.length} removed
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowRecipientManager((prev) => !prev);
                  if (showRecipientManager) {
                    setBulkSelectMode(false);
                    setBulkSelected(new Set());
                    setSearchQuery("");
                  }
                }}
                className="shrink-0"
              >
                <ChevronDown
                  className={`mr-1.5 size-3.5 transition-transform ${showRecipientManager ? "rotate-180" : ""}`}
                />
                {showRecipientManager ? "Hide" : "Manage"}
              </Button>
            </div>
          </div>

          {/* Invalid email warning */}
          {invalidTargets.length > 0 && (
            <div className="mx-3 mb-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {invalidTargets.length} recipient
                {invalidTargets.length === 1 ? "" : "s"} may not be a valid
                email. Review before sending.
              </span>
            </div>
          )}

          {/* ── Expanded Recipient Manager ── */}
          {showRecipientManager && (
            <div className="border-t border-border">
              {/* Search & Actions bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {bulkSelectMode ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={selectAllVisible}
                        className="h-7 px-2 text-[11px]"
                      >
                        <CheckSquare className="mr-1 size-3" />
                        All
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={deselectAll}
                        className="h-7 px-2 text-[11px]"
                      >
                        <Square className="mr-1 size-3" />
                        None
                      </Button>
                      {bulkSelected.size > 0 && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={removeSelected}
                          className="h-7 px-2 text-[11px]"
                        >
                          <UserMinus className="mr-1 size-3" />
                          Remove ({bulkSelected.size})
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setBulkSelectMode(false);
                          setBulkSelected(new Set());
                        }}
                        className="h-7 px-2 text-[11px]"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setBulkSelectMode(true)}
                      disabled={activeRecipients.length === 0}
                      className="h-7 px-2 text-[11px]"
                    >
                      <CheckSquare className="mr-1 size-3" />
                      Select
                    </Button>
                  )}
                </div>
              </div>

              {/* Active recipients list */}
              <div className="max-h-48 overflow-y-auto">
                {filteredActive.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                    {activeRecipients.length === 0 ? (
                      <>
                        <Users className="size-5 opacity-40" />
                        <span>All recipients have been removed</span>
                        {removedRecipients.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={restoreAll}
                            className="mt-1 h-7 text-[11px]"
                          >
                            <RotateCcw className="mr-1 size-3" />
                            Restore all
                          </Button>
                        )}
                      </>
                    ) : (
                      <span>No results found</span>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {filteredActive.map((recipient) => (
                      <div
                        key={recipient.email}
                        className={`group flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/50 ${bulkSelected.has(recipient.email) ? "bg-teal-50/60" : ""}`}
                      >
                        {/* Bulk select checkbox */}
                        {bulkSelectMode && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleBulkSelect(recipient.email)
                            }
                            className="shrink-0 text-teal-600"
                          >
                            {bulkSelected.has(recipient.email) ? (
                              <CheckSquare className="size-4" />
                            ) : (
                              <Square className="size-4 text-muted-foreground/40" />
                            )}
                          </button>
                        )}
                        {/* Recipient info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {recipient.name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {recipient.email}
                          </p>
                        </div>
                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() => removeRecipient(recipient.email)}
                          className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                          title="Remove recipient"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Removed Recipients Section ── */}
              {removedRecipients.length > 0 && (
                <div className="border-t border-red-200 bg-red-50/30">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setShowRemovedSection((prev) => !prev)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setShowRemovedSection((prev) => !prev);
                      }
                    }}
                    className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition hover:bg-red-50/60"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-red-700">
                      <UserMinus className="size-3" />
                      {removedRecipients.length} removed recipient
                      {removedRecipients.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          restoreAll();
                        }}
                        className="h-6 px-2 text-[10px] text-red-700 hover:bg-red-100 hover:text-red-800"
                      >
                        <RotateCcw className="mr-1 size-3" />
                        Restore all
                      </Button>
                      <ChevronDown
                        className={`size-3.5 text-red-500 transition-transform ${showRemovedSection ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>

                  {showRemovedSection && (
                    <div className="max-h-36 overflow-y-auto border-t border-red-200/50">
                      {filteredRemoved.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-red-600/60">
                          No matching removed recipients
                        </div>
                      ) : (
                        <div className="divide-y divide-red-200/30">
                          {filteredRemoved.map((recipient) => (
                            <div
                              key={recipient.email}
                              className="group flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-red-50/50"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-red-800/70 line-through">
                                  {recipient.name}
                                </p>
                                <p className="truncate text-[11px] text-red-600/50 line-through">
                                  {recipient.email}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  restoreRecipient(recipient.email)
                                }
                                className="shrink-0 rounded-md p-1 text-red-400 opacity-0 transition-all hover:bg-red-100 hover:text-red-700 group-hover:opacity-100"
                                title="Restore recipient"
                              >
                                <RotateCcw className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Template Info ── */}
        {selectedTemplate && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>Template</span>
            <span className="font-medium text-foreground">
              {selectedTemplate.category}
            </span>
          </div>
        )}

        {/* ── Subject ── */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10"
            value={subjectTemplate}
            onChange={(e) => setSubjectTemplate(e.target.value)}
          />
        </div>

        {/* ── Email Preview ── */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Email Preview
          </label>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Preview shows data for the first recipient. Each email will be
            personalized.
          </p>
          {selectedTemplate &&
            selectedTemplate.id !== -1 &&
            !hook.generatedHtml ? (
            <ReactEmailIframe
              ref={emailIframeRef}
              category={selectedTemplate.category}
              lead={allLeads[0] ?? null}
              editable={false}
            />
          ) : selectedTemplate &&
            selectedTemplate.id === -1 &&
            hook.generatedHtml ? (
            <div className="mt-2">
              <div className="overflow-hidden rounded-lg" style={{ height: 480 }}>
                <iframe
                  ref={emailIframeRef}
                  srcDoc={getEditablePreviewHtml(hook.generatedHtml)}
                  className="h-full w-full"
                  title="Email Preview"
                  sandbox="allow-same-origin allow-scripts"
                  style={{ border: "none" }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-2 flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              Select a template to preview
            </div>
          )}
        </div>

        {/* ── Action Buttons ── */}
        <div className="sticky -bottom-4 -mx-5 mt-2 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={
              !subjectTemplate.trim() ||
              activeRecipients.length === 0 ||
              invalidTargets.length > 0 ||
              sending
            }
          >
            {sending ? (
              <>
                <div className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-1.5 size-3.5" />
                Send to {activeRecipients.length} Recipient
                {activeRecipients.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}