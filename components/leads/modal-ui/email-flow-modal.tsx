import React, { useState } from "react";
import { Mail } from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead, EmailTemplate } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { sendEmailToLead, updateLead } from "@/lib/leads/leads-service";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { ReactEmailIframe } from "../render-email";
import {
  hydrateVariable,
  previewTemplateText,
  getTemplateDescription,
} from "@/lib/leads/lead-helpers";
import { useEmailAdHock } from "@/hooks/use-email-ad-hock";
import { CustomTemplateCreation } from "./custom-template-creation";
import { getEditablePreviewHtml } from "@/lib/utils/email-preview";
import { sydneyDateOnly, sydneyTimeOnly } from "@/lib/dates/sydney";

interface EmailFlowModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

type Step = "select" | "compose" | "custom";

export function EmailFlowModal({
  lead,
  onClose,
  onLeadUpdate,
  showToast,
}: EmailFlowModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [sending, setSending] = useState(false);
  const emailIframeRef = React.useRef<HTMLIFrameElement>(null);
  const formId = React.useId();
  const hook = useEmailAdHock();
  const toId = `${formId}-to`;
  const subjectId = `${formId}-subject`;
  const subjectHelperId = `${subjectId}-helper`;

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
    setEmailSubject(hydrateVariable(hook.emailSubject, lead));
    setSelectedTemplate({
      id: -1,
      category: "custom",
      subject: hook.emailSubject,
    } as EmailTemplate);
    setStep("compose");
  }

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setEmailSubject(hydrateVariable(template.subject, lead));
    setStep("compose");
  };

  const handleSend = async () => {
    if (!selectedTemplate) return;
    setSending(true);
    try {
      let finalHtmlBody = "";

      // 1. Check if the iframe ref and document exist
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
        cleanHtml = cleanHtml.replace(/\s*contenteditable="[^"]*"/gi, "");
        cleanHtml = cleanHtml.replace(/\s*spellcheck="[^"]*"/gi, "");
        cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi, "");
        cleanHtml = cleanHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
        cleanHtml = cleanHtml.replace(
          /outline:\s*2px dashed #c6923a;?\s*/gi,
          "",
        );
        cleanHtml = cleanHtml.replace(/outline-offset:\s*2px;?\s*/gi, "");
        cleanHtml = cleanHtml.replace(/outline:\s*none;?\s*/gi, "");
        // Capture the updated HTML
        finalHtmlBody = cleanHtml;
        finalHtmlBody = hydrateVariable(finalHtmlBody, lead);
      }

      // 2. Fallback if iframe document is not accessible (use "lead" instead of "emailLead")
      if (!finalHtmlBody) {
        if (selectedTemplate.id === -1 && hook.generatedHtml) {
          finalHtmlBody = hook.generatedHtml; // Use AI HTML for custom
        } else {
          finalHtmlBody =
            (await renderEmailHtml(selectedTemplate.category, lead)) || "";
        }
      }
      if (!finalHtmlBody) {
        showToast(
          "Failed to generate the email content. Please try again.",
          "error",
        );
        setSending(false); // Used "setSending" instead of "setSendingEmail"
        return;
      }

      // Send the email (use "lead.email" instead of "emailLead.email")
      const sendCampaign = await sendEmailToLead(
        lead.email,
        emailSubject,
        finalHtmlBody,
      );
      // Check for "sendCampaign" instead of undefined "sent"
      if (sendCampaign) {
        const now = new Date();
        const historyEntry = {
          // Both halves from the same Sydney reading. A UTC date beside a
          // browser-local time disagreed with itself by a whole day for anyone
          // sending after 10am.
          date: sydneyDateOnly(now),
          time: sydneyTimeOnly(now),
          action: "Email sent",
          detail: `Subject: ${emailSubject}`,
          type: "email" as const,
        };
        // Only what just happened. Passing `[...lead.history, entry]` inserted
        // a second copy of every row the lead already had.
        const updated = await updateLead(lead.id, {
          history: [historyEntry],
        });
        if (updated) onLeadUpdate(updated);
        showToast(`Email sent to ${lead.name} Successfully`, "success");
      } else {
        showToast(
          `Failed to send the email to ${lead.name}. Please try again.`,
          "error",
        );
      }
    } catch (error) {
      console.error("Error sending email:", error);
      showToast("Failed to send the email. Please try again.", "error");
    } finally {
      setSending(false);
      onClose();
    }
  };

  /* ── Step: Select Template ── */
  if (step === "select") {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Email Templates"
        subtitle="Select a template to send to the lead"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          <div className="rounded-[10px] border border-[color:var(--royal-gold)]/30 bg-[color:var(--royal-gold-light)] px-4 py-3 text-sm text-foreground">
            Sending to: <span className="font-medium">{lead.name}</span> -{" "}
            {lead.email || "No email"}
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-2">
              <button
                type="button"
                onClick={() => setStep("custom")}
                className="group flex flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-border bg-card p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--royal-gold)] hover:bg-[color:var(--royal-gold)]/5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition group-hover:border-[color:var(--royal-gold)] group-hover:bg-[color:var(--royal-gold)]/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground/50 transition group-hover:text-[color:var(--royal-gold)]"
                  >
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </div>
                <div className="mt-3 text-[15px] font-medium text-foreground transition group-hover:text-[color:var(--royal-gold)]">
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
                  className="group rounded-[10px] border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--royal-gold)]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.048px] text-muted-foreground">
                    {template.category}
                  </div>
                  <div className="mt-1 text-[15px] font-medium text-foreground">
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

  /* ── Step: To Create your Own Custom Template ── */
  if (step === "custom") {
    return (
      <ModalShell
        open
        onClose={onClose}
        title="Create Custom Email Template"
        subtitle="Design your own email template"
        maxWidthClass="max-w-[720px]"
      >
        <CustomTemplateCreation
          hook={hook}
          backgroundColor="#C6923A"
          borderColor="#C6923A"
        />
      </ModalShell>
    );
  }

  /* ── Step: Compose & Send ── */
  return (
    <ModalShell
      open
      onClose={onClose}
      title="Send Email"
      subtitle={`To: ${lead.name} (${lead.email || "No email"})`}
      maxWidthClass="max-w-[600px]"
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor={toId}
            className="text-xs font-medium text-muted-foreground"
          >
            To
          </label>
          <input
            id={toId}
            className="mt-1 w-full rounded-[4px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            value={lead.email || lead.name}
            readOnly
          />
        </div>
        {selectedTemplate && (
          <div className="flex items-center justify-between rounded-[4px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>Template</span>
            <span className="font-medium text-foreground">
              {selectedTemplate.category}
            </span>
          </div>
        )}
        <div>
          <label
            htmlFor={subjectId}
            className="text-xs font-medium text-muted-foreground"
          >
            Subject
          </label>
          <input
            id={subjectId}
            className="mt-1 w-full rounded-[4px] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-[color:var(--royal-gold)] focus:outline-none focus:ring-2 focus:ring-[color:var(--royal-gold-light)]"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            required
            aria-describedby={
              !emailSubject.trim() ? subjectHelperId : undefined
            }
          />
          {!emailSubject.trim() && (
            <p
              id={subjectHelperId}
              className="mt-1.5 text-xs text-muted-foreground"
            >
              Enter a subject before sending.
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Email Preview
          </p>
          {selectedTemplate &&
          selectedTemplate.id !== -1 &&
          selectedTemplate.category !== "custom" &&
          !hook.generatedHtml ? (
            <div className="mt-2">
              <ReactEmailIframe
                ref={emailIframeRef}
                category={selectedTemplate.category}
                lead={lead}
              />
            </div>
          ) : selectedTemplate &&
            selectedTemplate.id === -1 &&
            selectedTemplate.category === "custom" &&
            hook.generatedHtml ? (
            <div className="mt-2">
              <div
                className="overflow-hidden rounded-lg"
                style={{ height: 480 }}
              >
                <iframe
                  ref={emailIframeRef}
                  srcDoc={getEditablePreviewHtml(hook.generatedHtml)}
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--royal-gold)] px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-[color:var(--royal-gold-dark)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSend}
            disabled={!emailSubject.trim() || sending}
            aria-describedby={
              !emailSubject.trim() ? subjectHelperId : undefined
            }
          >
            {sending ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Sending...
              </>
            ) : (
              <>
                <Mail size={14} />
                Send Email
              </>
            )}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-[color:var(--royal-gold)] hover:bg-muted"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
