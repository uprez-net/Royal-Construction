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
      showToast: (msg: string, type?: "success" | "info") => void;
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
                              ...lead,
                              history: [...lead.history, historyEntry],
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
                              <div className="rounded-[10px] border border-[#CCFBF1] bg-[#CCFBF1]/30 px-4 py-3 text-sm text-[#0c0a09]">
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
                                                      className="group rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px] transition hover:-translate-y-0.5 hover:border-[#0D9488] hover:shadow-[rgba(0,0,0,0.05)_0px_4px_16px_0px]"
                                                >
                                                      <div className="text-[11px] font-medium uppercase tracking-[0.048px] text-[#a8a29e]">
                                                            {template.category}
                                                      </div>
                                                      <div className="mt-1 text-[15px] font-medium text-[#0c0a09]">
                                                            {previewTemplateText(template.subject)}
                                                      </div>
                                                      <div className="mt-2 text-xs leading-relaxed text-[#78716c]">
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
                              <label className="text-xs font-medium text-[#78716c]">To</label>
                              <input
                                    className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-sm text-[#78716c]"
                                    value={lead.email || lead.name}
                                    readOnly
                              />
                        </div>
                        {selectedTemplate && (
                              <div className="flex items-center justify-between rounded-[4px] border border-[#e5e7eb] bg-[#fafaf9] px-3 py-2 text-xs text-[#78716c]">
                                    <span>Template</span>
                                    <span className="font-medium text-[#0c0a09]">
                                          {selectedTemplate.category}
                                    </span>
                              </div>
                        )}
                        <div>
                              <label className="text-xs font-medium text-[#78716c]">Subject</label>
                              <input
                                    className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                                    value={emailSubject}
                                    readOnly
                              />
                        </div>
                        <div>
                              <label className="text-xs font-medium text-muted-foreground">
                                    Email Preview
                              </label>
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
                                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={handleSend}
                                    disabled={!emailSubject.trim() || sending}
                              >
                                    {sending ? (
                                          <>
                                                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
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
                                    className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
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