import React, { useState } from "react";
import { Mail } from "lucide-react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead, EmailTemplate } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { sendEmailToLead, updateLead } from "@/lib/leads/leads-service";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { ReactEmailIframe } from "../render-email";
import {
      hydrateSubject,
      previewTemplateText,
      getTemplateDescription,
} from "@/lib/leads/lead-helpers";

interface EmailFlowModalProps {
      lead: Lead;
      onClose: () => void;
      onLeadUpdate: (lead: Lead) => void;
      showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

type Step = "select" | "compose";

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
      const toId = `${formId}-to`;
      const subjectId = `${formId}-subject`;
      const subjectHelperId = `${subjectId}-helper`;

      const handleTemplateSelect = (template: EmailTemplate) => {
            setSelectedTemplate(template);
            setEmailSubject(hydrateSubject(template.subject, lead));
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
                        const body = iframeDoc.body;
                        if (body) {
                              // Temporarily remove contenteditable so it is not sent to the customer
                              body.removeAttribute("contenteditable");
                              body.style.outline = "";
                        }
                        // Capture the updated HTML
                        finalHtmlBody = iframeDoc.documentElement.outerHTML;

                        // Restore contenteditable for local preview editing
                        if (body) {
                              body.setAttribute("contenteditable", "true");
                              body.style.outline = "none";
                        }
                  }

                  // 2. Fallback if iframe document is not accessible (use "lead" instead of "emailLead")
                  if (!finalHtmlBody) {
                        finalHtmlBody = await renderEmailHtml(
                              selectedTemplate.category,
                              lead,
                        ) || "";
                  }
                  if (!finalHtmlBody) {
                        showToast("Failed to generate email content", "info");
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
                              date: now.toISOString().slice(0, 10),
                              time: now.toTimeString().slice(0, 5),
                              action: "Email sent",
                              detail: `Subject: ${emailSubject}`,
                              type: "email" as const,
                        };
                        const updated = await updateLead(lead.id, {
                              history: [...(lead.history ?? []), historyEntry],
                        });
                        if (updated) onLeadUpdate(updated);
                        showToast(`Email sent to ${lead.name} Successfully`, "success");
                  } else {
                        showToast(`Failed to send email to ${lead.name}`, "info");
                  }
            } catch (error) {
                  console.error("Error sending email:", error);
                  showToast("An unexpected error occurred", "info");
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
                                    Sending to:{" "}
                                    <span className="font-medium">{lead.name}</span> -{" "}
                                    {lead.email || "No email"}
                              </div>
                              <div className="max-h-[60vh] overflow-y-auto pr-1">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                                          !emailSubject.trim()
                                                ? subjectHelperId
                                                : undefined
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
                              {selectedTemplate ? (
                                    <div className="mt-2">
                                          <ReactEmailIframe
                                                ref={emailIframeRef}
                                                category={selectedTemplate.category}
                                                lead={lead}
                                          />
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
                                          !emailSubject.trim()
                                                ? subjectHelperId
                                                : undefined
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
