"use client";

import React, { useState, useRef, useEffect } from "react";
import { Mail } from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead, EmailTemplate } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { sendEmailToLead, fetchAllLeads } from "@/lib/leads/leads-service";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import {
  hydrateSubject,
  previewTemplateText,
  getTemplateDescription,
} from "@/lib/leads/lead-helpers";
import { Button } from "@/components/ui/button";
import { ReactEmailIframe } from "../render-email";

interface EmailCampaignModalProps {
  leads: Lead[];
  onClose: () => void;
  onCampaignComplete: (updatedLeads: Lead[]) => Promise<void>;
  showToast: (msg: string, type?: "success" | "info") => void;
}

type Step = "select" | "compose";

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
  const [emailTargetList, setEmailTargetList] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(true);


  const emailIframeRef = useRef<HTMLIFrameElement>(null);

  /* Fetch all leads for targets on mount */
  useEffect(() => {
    const loadTargets = async () => {
      try {
        setLoadingTargets(true);
        const data = await fetchAllLeads(); // Fetch all leads from the service
        setAllLeads(data);
        const withEmail = data.filter((l) => l.email);
        setEmailTargets(withEmail.map((l) => l.email!));
        setEmailTargetList(withEmail.map((l) => l.email).join(", "));
        setLoadingTargets(false);
      } catch (error) {
        console.error("Failed to load campaign leads:", error);
        // Fallback: use current page leads
        setAllLeads(leads);
        const withEmail = leads.filter((l) => l.email);
        setEmailTargets(withEmail.map((l) => l.email!));
        setEmailTargetList(withEmail.map((l) => l.email).join(", "));
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
      /* Grab any user edits from the iframe */
      let editedHtml = "";
      const iframeDoc = emailIframeRef.current?.contentDocument;
      if (iframeDoc) {
        const body = iframeDoc.body;
        if (body) {
          body.removeAttribute("contenteditable");
          body.style.outline = "";
        }
        editedHtml = iframeDoc.documentElement.outerHTML;
        if (body) {
          body.setAttribute("contenteditable", "true");
          body.style.outline = "none";
        }
      }
      const previewLead = allLeads[0] || leads[0];
      const updated = await Promise.all(
        allLeads.map(async (lead) => {
          if (!lead.email) return lead;

          try {
            const subject = hydrateSubject(subjectTemplate, lead);

            let finalHtml = editedHtml;
            if (finalHtml && previewLead && previewLead.name !== lead.name) {
              finalHtml = finalHtml.replace(
                new RegExp(previewLead.name, "g"),
                lead.name,
              );
              if (previewLead.email && previewLead.email) {
                finalHtml = finalHtml.replace(
                  new RegExp(previewLead.email!, "g"),
                  lead.email,
                );
              }
            }

            if (!finalHtml) {
              finalHtml = await renderEmailHtml(
                selectedTemplate.category,
                lead,
              );
            }

            if (!finalHtml) {
              console.error(
                `Failed to generate email content for ${lead.email}`,
              );
              return lead;
            }

            const sent = await sendEmailToLead(lead.email, subject, finalHtml);

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

      await onCampaignComplete(updated);
      showToast(
        `Campaign sent to ${successCount} of ${emailTargets.length} leads`,
        "success",
      );
    } catch (error) {
      console.error("Campaign error:", error);
      showToast("An unexpected error occurred during the campaign", "info");
    } finally {
      setSending(false);
      onClose();
    }
  };

  /* ── Preview subject: hydrate for first lead ── */
  const previewLead = allLeads[0] || leads[0];
  const previewSubject =
    previewLead && selectedTemplate
      ? hydrateSubject(subjectTemplate, previewLead)
      : subjectTemplate;

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
          <p className="text-sm font-medium text-slate-600">Loading campaign leads...</p>
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
        <div>
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
            rows={3}
            value={emailTargetList || "No leads with email"}
            readOnly
          />
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
            value={previewSubject}
            readOnly
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
          {selectedTemplate ? (
            <ReactEmailIframe
              ref={emailIframeRef}
              category={selectedTemplate.category}
              lead={allLeads[0] ?? null}
            />
          ) : (
            <div className="mt-2 flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              Select a template to preview
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSend}
            disabled={
              !subjectTemplate.trim() ||
              emailTargets.length === 0 ||
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
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}