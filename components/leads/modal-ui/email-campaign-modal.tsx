"use client";

import React, { useMemo, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Mail,
  Plus,
  UserPlus,
  Users,
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
import { LeadEmailBadges } from "./lead-email-badges";
import DOMPurify from "dompurify";

interface EmailCampaignModalProps {
  leads: Lead[];
  onClose: () => void;
  onCampaignComplete: (updatedLeads: Lead[]) => Promise<void>;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

type Step = "select" | "compose" | "custom";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [subjectTemplate, setSubjectTemplate] = useState(""); // raw with {placeholders}
  const [sending, setSending] = useState(false);

  /* Email targets — fetched on open */
  const [emailTargets, setEmailTargets] = useState<string[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [showRecipients, setShowRecipients] = useState(false);
  const emailIframeRef = React.useRef<HTMLIFrameElement>(null);
  const hook = useEmailAdHock();

  // ─── Auto-transition to Compose when AI finishes ───
  // Render-time state adjustment per React docs (useState to track prev value)
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

  const invalidTargets = useMemo(
    () => emailTargets.filter((email) => !EMAIL_PATTERN.test(email.trim())),
    [emailTargets],
  );

  const recipientPreview = useMemo(
    () => emailTargets.slice(0, 4).join(", "),
    [emailTargets],
  );

  /* Fetch all leads for targets on mount */
  useEffect(() => {
    const loadTargets = async () => {
      try {
        setLoadingTargets(true);
        const data = await fetchAllLeads(); // Fetch all leads from the service
        setAllLeads(data);
        const withEmail = data.filter((l) => l.email && !l.isArchived);
        setEmailTargets(withEmail.map((l) => l.email!));
        setLoadingTargets(false);
      } catch (error) {
        console.error("Failed to load campaign leads:", error);
        // Fallback: use current page leads
        setAllLeads(leads);
        const withEmail = leads.filter((l) => l.email);
        setEmailTargets(withEmail.map((l) => l.email!));
        setLoadingTargets(false);
      } finally {
        setLoadingTargets(false);
      }
    };
    loadTargets();
  }, [leads]);

  /* ── Step: Select Template ── */
  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setSubjectTemplate(template.subject); // keep raw placeholders
    setStep("compose");
  };

  /* ── Step: Send Campaign ── */
  const handleSend = async () => {
    if (!selectedTemplate || emailTargets.length === 0) return;
    setSending(true);

    let successCount = 0;
    const now = new Date();

    try {
      const updated: Lead[] = [];
      const batchSize = 20;
      for (let index = 0; index < allLeads.length; index += batchSize) {
        const batch = allLeads.slice(index, index + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (lead) => {
            if (!lead.email) return lead;
            let finalHtmlBody = "";
            try {
              const subject = hydrateVariable(subjectTemplate, lead);
              const iframeDoc = emailIframeRef.current?.contentDocument;
              if (iframeDoc) {
                // Clean up DOM artifacts from interactive preview
                iframeDoc
                  .querySelectorAll(".rc-hover-toolbar")
                  .forEach((t) => t.remove());
                iframeDoc.querySelectorAll("a, button").forEach((el) => {
                  (el as HTMLElement).style.outline = "";
                  (el as HTMLElement).style.outlineOffset = "";
                });
                iframeDoc.body.contentEditable = "false";

                let cleanHtml = iframeDoc.body.innerHTML;
                cleanHtml = cleanHtml.replace(
                  /\s*contenteditable="[^"]*"/gi,
                  "",
                );
                cleanHtml = cleanHtml.replace(/\s*spellcheck="[^"]*"/gi, "");
                cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi, "");
                cleanHtml = cleanHtml.replace(
                  /<script[\s\S]*?<\/script>/gi,
                  "",
                );
                cleanHtml = cleanHtml.replace(
                  /outline:\s*2px dashed #c6923a;?\s*/gi,
                  "",
                );
                cleanHtml = cleanHtml.replace(
                  /outline-offset:\s*2px;?\s*/gi,
                  "",
                );
                cleanHtml = cleanHtml.replace(/outline:\s*none;?\s*/gi, "");
                // Capture the updated HTML
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
        `Campaign sent to ${successCount} of ${emailTargets.length} leads`,
        "success",
      );
    } catch (error) {
      console.error("Campaign error:", error);
      showToast("Failed to send the email campaign. Please try again.", "error");
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
        title="Email Campaign Templates"
        subtitle="Select a template to send to the leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600">
            Loading campaign leads...
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
        title="Email Campaign Templates"
        subtitle="Select a template to send to the leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-teal-100 bg-teal-50/30 px-4 py-3 text-sm text-foreground">
            Sending to:{" "}
            <span className="font-medium">{emailTargets.length}</span> leads
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
                  <Plus className="size-5 text-muted-foreground transition group-hover:text-teal-700" />
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
     Render: To Create your Own Custom Template
     ════════════════════════════════════════════ */
  if (step === "custom") {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Email Campaign Templates"
        subtitle="Select a template to send to the leads"
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
      title="Send Email Campaign"
      subtitle={`To: ${emailTargets.length} leads with email`}
      maxWidthClass="max-w-[600px]"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700">
                <Users className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {emailTargets.length} recipients selected
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {recipientPreview || "No leads with email"}
                  {emailTargets.length > 4
                    ? `, +${emailTargets.length - 4} more`
                    : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const archivedEmails = allLeads
                    .filter((l) => l.isArchived && l.email)
                    .map((l) => l.email);

                  if (archivedEmails.length === 0) {
                    showToast(
                      "No archived leads with an email address were found.",
                      "info",
                    );
                    return;
                  }

                  setEmailTargets((prev) => [
                    ...new Set([...prev, ...archivedEmails]),
                  ]);
                }}
                className="shrink-0"
              >
                <UserPlus className={`mr-1.5 size-3.5`} />
                Add Archived Leads
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRecipients((open) => !open)}
                className="shrink-0"
              >
                <ChevronDown
                  className={`mr-1.5 size-3.5 transition-transform ${showRecipients ? "rotate-180" : ""}`}
                />
                Review
              </Button>
            </div>
          </div>

          {invalidTargets.length > 0 && (
            <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {invalidTargets.length} recipient{" "}
                {invalidTargets.length === 1 ? "value" : "values"} may not be{" "}
                {invalidTargets.length === 1 ? "a " : ""}valid email
                {invalidTargets.length === 1 ? "" : "s"}. Review before sending.
              </span>
            </div>
          )}

          {showRecipients && (
            <LeadEmailBadges
              emails={emailTargets}
              onRemoveEmail={(email) => {
                setEmailTargets((prev) => prev.filter((e) => e !== email));
              }}
            />
          )}
        </div>

        {selectedTemplate && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>Template</span>
            <span className="font-medium text-foreground">
              {selectedTemplate.category}
            </span>
          </div>
        )}

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

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Email Preview
          </label>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Preview shows data for the first lead. All emails will be
            personalized per lead.
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
              <div
                className="overflow-hidden rounded-lg"
                style={{ height: 480 }}
              >
                <iframe
                  ref={emailIframeRef}
                  // The editor reads this frame's contentDocument to extract the
                  // edited HTML, so it must stay same-origin. Combined with
                  // allow-scripts that would let AI-generated markup run script
                  // in our origin — so sanitize the untrusted HTML first; the
                  // only script left to run is our trusted preview toolbar.
                  srcDoc={getEditablePreviewHtml(DOMPurify.sanitize(hook.generatedHtml))}
                  className="w-full h-full"
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

        <div className="sticky -bottom-4 -mx-5 mt-2 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={
              !subjectTemplate.trim() ||
              emailTargets.length === 0 ||
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
                Send Campaign
              </>
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
