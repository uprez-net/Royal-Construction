"use client";

import React, { useRef, useState } from 'react';
import {
      Sparkles, Plus, Trash2, Link2, Paperclip, Mail, FileText, ChevronRight, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { generateEmailTemplate } from '@/lib/data/email-ad-hock';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LinkItem {
      id: string;
      label: string;
      url: string;
}

interface AttachmentItem {
      id: string;
      label: string;
      url: string;
}

interface EmailTemplate {
      id: number;
      subject: string;
      category: string;
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const EMAIL_TEMPLATES: EmailTemplate[] = [
      { id: 1, subject: 'Welcome {name} - next step for your {type} in {location}', category: 'Welcome' },
      { id: 2, subject: 'Quotation next steps for {name} - {project} ({amount})', category: 'Quotation' },
      { id: 3, subject: 'Following up on your {type} in {location} - {followup}', category: 'Follow-up' },
      { id: 4, subject: 'Finishes catalogue for your {type} in {location}', category: 'Catalogue' },
      { id: 5, subject: 'Variation update for {name} - {project}', category: 'Variation' },
      { id: 6, subject: '{name}, a Royal Constructions offer for your {type}', category: 'Promotion' },
      { id: 7, subject: 'Site visit for {name} - {location} on {followup}', category: 'Meeting' },
      { id: 8, subject: '{project} update - {milestone}', category: 'Update' },
      { id: 9, subject: 'Royal Constructions portfolio for your {type} in {location}', category: 'Portfolio' },
];

const SAVED_AI_EMAILS = [
      { id: 'ai-1', subject: 'Custom Follow-up for Syed', date: 'Today, 10:30 AM' },
      { id: 'ai-2', subject: 'Special Duplex Promotion', date: 'Yesterday, 2:15 PM' },
];

const STEPS = [
      { id: 1, name: 'Compose' },
      { id: 2, name: 'Preview' },
      { id: 3, name: 'Send' },
];

// ─── Helper ─────────────────────────────────────────────────────────────────

const generateId = () => Math.random().toString(36).substring(2, 9);

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AdHocEmailPage() {
      const [currentStep, setCurrentStep] = useState(1);
      const iframeRef = useRef<HTMLIFrameElement>(null);

      // Form State
      const [description, setDescription] = useState('');
      const [links, setLinks] = useState<LinkItem[]>([]);
      const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
      const [isGenerating, setIsGenerating] = useState(false);
      const [generationError, setGenerationError] = useState<string | null>(null);

      const [errors, setErrors] = useState<{
            description?: string;
            links?: { [id: string]: { label?: string; url?: string } };
            attachments?: { [id: string]: { label?: string; url?: string } };
      }>({});

      // Preview State
      const [generatedHtml, setGeneratedHtml] = useState<string>('');
      const [emailSubject, setEmailSubject] = useState<string>('');
      const [templateName, setTemplateName] = useState<string>('');



      // Inject interactive script into the HTML for the iframe preview
      const getEditablePreviewHtml = (html: string) => {
            if (!html) return '';

            // Build a full HTML document so the script always runs.
            // The generated email HTML is a <div> with tables — no <body> tag —
            // so the old .replace('</body>', ...) never matched.
            return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* Make the editing experience seamless */
    body { margin: 0; padding: 0; outline: none; }
    .rc-hover-toolbar {
      position: absolute;
      background: rgba(12,24,41,0.95);
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 9999;
      display: none;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      max-width: 90%;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .rc-hover-toolbar span {
      font-weight: 600;
      white-space: nowrap;
    }
    .rc-hover-toolbar input {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      font-size: 12px;
      width: 300px;
      max-width: 55vw;
      padding: 3px 8px;
      border-radius: 4px;
      outline: none;
      font-family: monospace;
    }
    .rc-hover-toolbar input:focus {
      border-color: #c6923a;
      background: rgba(255,255,255,0.15);
    }
  </style>
</head>
<body contenteditable="true">
  ${html}
  <script>
    (function() {
      // Prevent link clicks from navigating away
      document.addEventListener('click', function(e) {
        var anchor = e.target.closest('a');
        if (anchor) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);

      // Prevent link middle-click / ctrl-click too
      document.addEventListener('auxclick', function(e) {
        if (e.target.closest('a')) e.preventDefault();
      }, true);

      // Build hover toolbars for all <a> and <button> elements
      var clickables = document.querySelectorAll('a[href], button[data-href]');
      clickables.forEach(function(el) {
        var toolbar = document.createElement('div');
        toolbar.className = 'rc-hover-toolbar';

        var label = document.createElement('span');
        label.textContent = el.tagName === 'BUTTON' ? 'Action URL: ' : 'URL: ';

        var input = document.createElement('input');
        input.type = 'text';
        input.value = el.getAttribute('href') || el.getAttribute('data-href') || '';
        input.placeholder = 'https://...';

        // Prevent typing in the input from editing the email body
        input.addEventListener('keydown', function(e) { e.stopPropagation(); });
        input.addEventListener('mousedown', function(e) { e.stopPropagation(); });

        toolbar.appendChild(label);
        toolbar.appendChild(input);
        document.body.appendChild(toolbar);

        function showToolbar() {
          var rect = el.getBoundingClientRect();
          toolbar.style.top = (window.scrollY + rect.bottom + 5) + 'px';
          toolbar.style.left = Math.max(4, window.scrollX + rect.left) + 'px';
          toolbar.style.display = 'flex';
          el.style.outline = '2px dashed #c6923a';
          el.style.outlineOffset = '2px';
        }

        function hideToolbar() {
          setTimeout(function() {
            if (!toolbar.matches(':hover') && !el.matches(':hover')) {
              toolbar.style.display = 'none';
              el.style.outline = 'none';
            }
          }, 250);
        }

        el.addEventListener('mouseenter', showToolbar);
        el.addEventListener('mouseleave', hideToolbar);
        toolbar.addEventListener('mouseleave', hideToolbar);

        // Update href/data-href live
        input.addEventListener('input', function(e) {
          var nextValue = e.target.value;
          if (el.hasAttribute('data-href')) {
            el.setAttribute('data-href', nextValue);
          } else {
            el.setAttribute('href', nextValue);
          }
        });
      });


    })();
  </script>
</body>
</html>`;
      };

      // Handlers for Links
      const addLink = () => setLinks([...links, { id: generateId(), label: '', url: '' }]);
      const updateLink = (id: string, field: keyof LinkItem, value: string) => {
            setLinks(links.map(l => l.id === id ? { ...l, [field]: value } : l));
      };
      const removeLink = (id: string) => setLinks(links.filter(l => l.id !== id));

      // Handlers for Attachments
      const addAttachment = () => setAttachments([...attachments, { id: generateId(), label: '', url: '' }]);
      const updateAttachment = (id: string, field: keyof AttachmentItem, value: string) => {
            setAttachments(attachments.map(a => a.id === id ? { ...a, [field]: value } : a));
      };
      const removeAttachment = (id: string) => setAttachments(attachments.filter(a => a.id !== id));

      // Generate Email Handler
      const handleGenerate = async () => {
            const isValid = validateForm();
            if (!isValid) return;

            setIsGenerating(true);
            setGenerationError(null);
            try {
                  const result = await generateEmailTemplate(description, attachments, links);
                  setGeneratedHtml(result.html);
                  setEmailSubject(result.subject);
                  setTemplateName(result.name);
                  setCurrentStep(2);
                  setErrors({});
            } catch (error) {
                  console.error('Error generating email:', error);
                  setGenerationError(error instanceof Error ? error.message : "Failed to generate email");
            } finally {
                  setIsGenerating(false);
            }
      };

      // Handle moving to Step 3 by directly reading the iframe's DOM
      const handleNextToSend = () => {
            const doc = iframeRef.current?.contentDocument;
            if (!doc || !doc.body) {
                  console.warn('Iframe not ready, proceeding with original HTML');
                  setCurrentStep(3);
                  return;
            }

            // 1. Remove all hover toolbars from the DOM
            doc.querySelectorAll('.rc-hover-toolbar').forEach(t => t.remove());

            // 2. Remove outline styling from links/buttons
            doc.querySelectorAll('a, button').forEach(el => {
                  (el as HTMLElement).style.outline = '';
                  (el as HTMLElement).style.outlineOffset = '';
            });

            // 3. Disable contentEditable
            doc.body.contentEditable = 'false';

            // 4. Extract the inner HTML
            let cleanHtml = doc.body.innerHTML;

            // 5. Strip any remaining editing artifacts
            cleanHtml = cleanHtml.replace(/\s*contenteditable="[^"]*"/gi, '');
            cleanHtml = cleanHtml.replace(/\s*spellcheck="[^"]*"/gi, '');
            cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
            cleanHtml = cleanHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
            cleanHtml = cleanHtml.replace(/outline:\s*2px dashed #c6923a;?\s*/gi, '');
            cleanHtml = cleanHtml.replace(/outline-offset:\s*2px;?\s*/gi, '');
            cleanHtml = cleanHtml.replace(/outline:\s*none;?\s*/gi, '');

            // 6. Log the final email-ready HTML
            console.log('──── SAVED EMAIL HTML (clean, ready to send) ────');
            console.log(cleanHtml);
            console.log('──── END EMAIL HTML ────');

            // 7. Save and proceed
            setGeneratedHtml(cleanHtml);
            setCurrentStep(3);
      };

      // Template Select Handler
      const handleTemplateSelect = (template: EmailTemplate) => {
            console.log('Selected template:', template);
            setTemplateName(template.category);
            setEmailSubject(template.subject);
            setGeneratedHtml(`
                  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#1f2937;">
                        <h1 style="margin:0 0 16px;color:#0f172a;">${template.category}</h1>
                        <p style="margin:0 0 16px;">Use this template as a starting point and edit the preview before sending.</p>
                        <p style="margin:0;">Royal Constructions</p>
                  </div>
            `);
            setGenerationError(null);
            setCurrentStep(2);
      };

      const validateForm = () => {
            const newErrors: typeof errors = {};

            if (!description.trim()) {
                  newErrors.description = "Description is required";
            }

            links.forEach((link) => {
                  const labelError = !link.label.trim() ? "Label is required" : undefined;
                  const urlError = !link.url.trim() ? "URL is required" : undefined;

                  if (labelError || urlError) {
                        if (!newErrors.links) newErrors.links = {};
                        newErrors.links[link.id] = { label: labelError, url: urlError };
                  }
            });

            attachments.forEach((file) => {
                  const labelError = !file.label.trim() ? "Name is required" : undefined;
                  const urlError = !file.url.trim() ? "URL is required" : undefined;

                  if (labelError || urlError) {
                        if (!newErrors.attachments) newErrors.attachments = {};
                        newErrors.attachments[file.id] = { label: labelError, url: urlError };
                  }
            });

            setErrors(newErrors);
            return Object.keys(newErrors).length === 0;
      };

      return (
            <div className="min-h-screen bg-[#F7F6F2] p-6 sm:p-8">
                  <div className="mx-auto max-w-7xl">
                        {/* ── Progress Stepper Header ── */}
                        <div className="mb-10">
                              <nav aria-label="Progress" className="mx-auto max-w-xl">
                                    <ol className="flex items-center">
                                          {STEPS.map((step, index) => (
                                                <li key={step.name} className="relative flex-1 flex flex-col items-center">
                                                      {index < STEPS.length - 1 && (
                                                            <div
                                                                  className={cn(
                                                                        "absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[18px] h-0.5 -translate-y-1/2",
                                                                        currentStep > step.id ? "bg-[#C6923A]" : "bg-slate-200"
                                                                  )}
                                                                  aria-hidden="true"
                                                            />
                                                      )}
                                                      <div
                                                            className={cn(
                                                                  "relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                                                                  currentStep === step.id
                                                                        ? "border-[#C6923A] bg-[#C6923A] text-white"
                                                                        : currentStep > step.id
                                                                              ? "border-[#C6923A] bg-[#C6923A] text-white"
                                                                              : "border-slate-300 bg-white text-slate-400"
                                                            )}
                                                      >
                                                            {currentStep > step.id ? (
                                                                  <Check className="h-5 w-5" aria-hidden="true" />
                                                            ) : (
                                                                  <span className="text-sm font-semibold">{step.id}</span>
                                                            )}
                                                      </div>
                                                      <div className="mt-2 text-center">
                                                            <span
                                                                  className={cn(
                                                                        "text-xs font-semibold uppercase tracking-wider",
                                                                        currentStep >= step.id ? "text-[#C6923A]" : "text-slate-400"
                                                                  )}
                                                            >
                                                                  {step.name}
                                                            </span>
                                                      </div>
                                                </li>
                                          ))}
                                    </ol>
                              </nav>
                        </div>

                        {/* ── Step 1: Compose ── */}
                        {currentStep === 1 && (
                              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                    {/* Left Column: Composer */}
                                    <div className="space-y-6 lg:col-span-2">
                                          <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
                                                <div className="border-b border-[#E2E8F0] px-6 py-4">
                                                      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                                                            <Sparkles className="size-5 text-[#C6923A]" />
                                                            AI Email Generator
                                                      </h2>
                                                </div>

                                                <div className="space-y-6 p-6">
                                                      {/* Describe Section */}
                                                      <div>
                                                            <label className="mb-1.5 block text-sm font-medium text-slate-700">
                                                                  Describe what the email should cover
                                                            </label>
                                                            <Textarea
                                                                  value={description}
                                                                  onChange={(e) => {
                                                                        setDescription(e.target.value)
                                                                        if (errors.description) setErrors({ ...errors, description: undefined });
                                                                  }}
                                                                  placeholder="e.g. Write a follow-up email for a client named Kuldeep regarding his Double Storey project in Wilton, asking him to book a meeting..."
                                                                  className={cn(
                                                                        "min-h-[140px] border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]",
                                                                        errors.description && "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                                  )}
                                                            />
                                                            {errors.description && (
                                                                  <p className="mt-1 text-xs text-red-500 font-medium">{errors.description}</p>
                                                            )}
                                                      </div>

                                                      {/* Links Section */}
                                                      <div>
                                                            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                                                                  <Link2 className="size-4 text-slate-400" />
                                                                  Links (Displayed as Buttons)
                                                            </label>
                                                            <div className="space-y-3">
                                                                  {links.map((link) => {
                                                                        const linkError = errors.links?.[link.id];
                                                                        return (
                                                                              <div key={link.id} className="flex flex-col gap-1">
                                                                                    <div className="flex items-center gap-2">
                                                                                          <Input
                                                                                                placeholder="Button Label"
                                                                                                value={link.label}
                                                                                                onChange={(e) => {
                                                                                                      updateLink(link.id, 'label', e.target.value);
                                                                                                      if (errors.links?.[link.id]) {
                                                                                                            const updatedLinksErrors = { ...errors.links };
                                                                                                            delete updatedLinksErrors[link.id];
                                                                                                            setErrors({ ...errors, links: updatedLinksErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className={cn(
                                                                                                      "flex-1 border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]",
                                                                                                      linkError?.label && "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                                                                )}
                                                                                          />
                                                                                          <Input
                                                                                                placeholder="https://link-to-page.com"
                                                                                                value={link.url}
                                                                                                onChange={(e) => {
                                                                                                      updateLink(link.id, 'url', e.target.value);
                                                                                                      if (errors.links?.[link.id]) {
                                                                                                            const updatedLinksErrors = { ...errors.links };
                                                                                                            delete updatedLinksErrors[link.id];
                                                                                                            setErrors({ ...errors, links: updatedLinksErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className={cn(
                                                                                                      "flex-[2] border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]",
                                                                                                      linkError?.url && "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                                                                )}
                                                                                          />
                                                                                          <Button
                                                                                                variant="ghost"
                                                                                                size="icon"
                                                                                                onClick={() => {
                                                                                                      removeLink(link.id);
                                                                                                      if (errors.links?.[link.id]) {
                                                                                                            const updatedLinksErrors = { ...errors.links };
                                                                                                            delete updatedLinksErrors[link.id];
                                                                                                            setErrors({ ...errors, links: updatedLinksErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className="shrink-0 text-slate-400 hover:text-red-500"
                                                                                          >
                                                                                                <Trash2 className="size-4" />
                                                                                          </Button>
                                                                                    </div>
                                                                                    {(linkError?.label || linkError?.url) && (
                                                                                          <p className="text-[11px] text-red-500 font-medium">
                                                                                                {linkError.label && linkError.url
                                                                                                      ? "Label & URL are required"
                                                                                                      : linkError.label || linkError.url}
                                                                                          </p>
                                                                                    )}
                                                                              </div>
                                                                        );
                                                                  })}
                                                                  <Button
                                                                        variant="outline"
                                                                        onClick={addLink}
                                                                        className="border-dashed border-slate-300 text-slate-600 hover:border-[#C6923A] hover:text-[#C6923A]"
                                                                  >
                                                                        <Plus className="mr-2 size-4" /> Add Link
                                                                  </Button>
                                                            </div>
                                                      </div>

                                                      {/* Attachments Section */}
                                                      <div>
                                                            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                                                                  <Paperclip className="size-4 text-slate-400" />
                                                                  Files / Attachments
                                                            </label>
                                                            <div className="space-y-3">
                                                                  {attachments.map((file) => {
                                                                        const fileError = errors.attachments?.[file.id];
                                                                        return (
                                                                              <div key={file.id} className="flex flex-col gap-1">
                                                                                    <div className="flex items-center gap-2">
                                                                                          <Input
                                                                                                placeholder="File Name / Button Text"
                                                                                                value={file.label}
                                                                                                onChange={(e) => {
                                                                                                      updateAttachment(file.id, 'label', e.target.value);
                                                                                                      if (errors.attachments?.[file.id]) {
                                                                                                            const updatedAttachmentsErrors = { ...errors.attachments };
                                                                                                            delete updatedAttachmentsErrors[file.id];
                                                                                                            setErrors({ ...errors, attachments: updatedAttachmentsErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className={cn(
                                                                                                      "flex-1 border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]",
                                                                                                      fileError?.label && "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                                                                )}
                                                                                          />
                                                                                          <Input
                                                                                                placeholder="https://link-to-file.com"
                                                                                                value={file.url}
                                                                                                onChange={(e) => {
                                                                                                      updateAttachment(file.id, 'url', e.target.value);
                                                                                                      if (errors.attachments?.[file.id]) {
                                                                                                            const updatedAttachmentsErrors = { ...errors.attachments };
                                                                                                            delete updatedAttachmentsErrors[file.id];
                                                                                                            setErrors({ ...errors, attachments: updatedAttachmentsErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className={cn(
                                                                                                      "flex-[2] border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]",
                                                                                                      fileError?.url && "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                                                                )}
                                                                                          />
                                                                                          <Button
                                                                                                variant="ghost"
                                                                                                size="icon"
                                                                                                onClick={() => {
                                                                                                      removeAttachment(file.id);
                                                                                                      if (errors.attachments?.[file.id]) {
                                                                                                            const updatedAttachmentsErrors = { ...errors.attachments };
                                                                                                            delete updatedAttachmentsErrors[file.id];
                                                                                                            setErrors({ ...errors, attachments: updatedAttachmentsErrors });
                                                                                                      }
                                                                                                }}
                                                                                                className="shrink-0 text-slate-400 hover:text-red-500"
                                                                                          >
                                                                                                <Trash2 className="size-4" />
                                                                                          </Button>
                                                                                    </div>
                                                                                    {(fileError?.label || fileError?.url) && (
                                                                                          <p className="text-[11px] text-red-500 font-medium">
                                                                                                {fileError.label && fileError.url
                                                                                                      ? "File name & URL are required"
                                                                                                      : fileError.label || fileError.url}
                                                                                          </p>
                                                                                    )}
                                                                              </div>
                                                                        );
                                                                  })}
                                                                  <Button
                                                                        variant="outline"
                                                                        onClick={addAttachment}
                                                                        className="border-dashed border-slate-300 text-slate-600 hover:border-[#C6923A] hover:text-[#C6923A]"
                                                                  >
                                                                        <Plus className="mr-2 size-4" /> Add Attachment
                                                                  </Button>
                                                            </div>
                                                      </div>
                                                </div>

                                                {/* Generate Footer */}
                                                <div className="flex flex-col items-end gap-2 border-t border-[#E2E8F0] bg-slate-50/50 px-6 py-4">
                                                      {generationError && (
                                                            <p className="text-sm font-medium text-red-600">{generationError}</p>
                                                      )}
                                                      <Button
                                                            onClick={handleGenerate}
                                                            disabled={isGenerating}
                                                            className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90"
                                                      >
                                                            {isGenerating ? (
                                                                  <>
                                                                        <Sparkles className="mr-2 size-4 animate-spin" />
                                                                        Generating...
                                                                  </>
                                                            ) : (
                                                                  <>
                                                                        <Sparkles className="mr-2 size-4" />
                                                                        Generate Email
                                                                  </>
                                                            )}
                                                      </Button>
                                                </div>
                                          </div>
                                    </div>

                                    {/* Right Column: Templates & Saved */}
                                    <div className="space-y-6 lg:col-span-1">
                                          <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
                                                <div className="border-b border-[#E2E8F0] px-5 py-4">
                                                      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                                                            <Mail className="size-5 text-[#C6923A]" />
                                                            Default Templates
                                                      </h2>
                                                </div>
                                                <div className="divide-y divide-[#E2E8F0]">
                                                      {EMAIL_TEMPLATES.map((template) => (
                                                            <button
                                                                  key={template.id}
                                                                  onClick={() => handleTemplateSelect(template)}
                                                                  className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-slate-50"
                                                            >
                                                                  <div className="min-w-0 pr-4">
                                                                        <span className={cn(
                                                                              "mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                                                              "bg-[#C6923A]/10 text-[#C6923A]"
                                                                        )}>
                                                                              {template.category}
                                                                        </span>
                                                                        <p className="truncate text-sm text-slate-700">
                                                                              {template.subject}
                                                                        </p>
                                                                  </div>
                                                                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                                                            </button>
                                                      ))}
                                                </div>
                                          </div>

                                          <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
                                                <div className="border-b border-[#E2E8F0] px-5 py-4">
                                                      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                                                            <FileText className="size-5 text-[#C6923A]" />
                                                            Saved AI Emails
                                                      </h2>
                                                </div>
                                                {SAVED_AI_EMAILS.length === 0 ? (
                                                      <div className="px-5 py-8 text-center text-sm text-slate-500">
                                                            No AI generated emails saved yet.
                                                      </div>
                                                ) : (
                                                      <div className="divide-y divide-[#E2E8F0]">
                                                            {SAVED_AI_EMAILS.map((email) => (
                                                                  <button
                                                                        key={email.id}
                                                                        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-slate-50"
                                                                  >
                                                                        <div className="min-w-0 pr-4">
                                                                              <p className="truncate text-sm font-medium text-slate-900">
                                                                                    {email.subject}
                                                                              </p>
                                                                              <p className="text-xs text-slate-500">{email.date}</p>
                                                                        </div>
                                                                        <ChevronRight className="size-4 shrink-0 text-slate-400" />
                                                                  </button>
                                                            ))}
                                                      </div>
                                                )}
                                          </div>
                                    </div>
                              </div>
                        )}

                        {/* ── Step 2: Preview ── */}
                        {currentStep === 2 && (
                              <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                          <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Template Name</label>
                                                <Input
                                                      value={templateName}
                                                      onChange={(e) => setTemplateName(e.target.value)}
                                                      className="text-lg font-semibold border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]"
                                                />
                                          </div>
                                          <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Subject</label>
                                                <Input
                                                      value={emailSubject}
                                                      onChange={(e) => setEmailSubject(e.target.value)}
                                                      className="text-lg border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]"
                                                />
                                          </div>
                                    </div>

                                    <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
                                          <div className="bg-slate-50 border-b border-[#E2E8F0] px-4 py-2 flex items-center justify-between">
                                                <span className="text-xs font-medium text-slate-500">Interactive Preview (Click to edit text. Hover links to change URLs)</span>
                                          </div>

                                          <div className="w-full bg-[#F7F6F2] p-4 md:p-8 flex justify-center">
                                                <div className="w-full max-w-[640px] min-h-[600px] bg-white rounded shadow-md overflow-hidden">
                                                      {generatedHtml ? (
                                                            <iframe
                                                                  ref={iframeRef}
                                                                  srcDoc={getEditablePreviewHtml(generatedHtml)}
                                                                  title="Email Preview"
                                                                  className="w-full h-[700px] border-none"
                                                                  sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin"
                                                            />
                                                      ) : (
                                                            <div className="flex h-[600px] items-center justify-center text-sm text-slate-400">
                                                                  No preview generated yet.
                                                            </div>
                                                      )}
                                                </div>
                                          </div>
                                    </div>

                                    <div className="flex justify-between items-center pt-2">
                                          <Button variant="outline" onClick={() => setCurrentStep(1)} className="border-slate-300">
                                                Back to Compose
                                          </Button>
                                          <Button className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90" onClick={handleNextToSend}>
                                                Next: Saved & Proceed
                                          </Button>
                                    </div>
                              </div>
                        )}

                        {/* ── Step 3: Send ── */}
                        {currentStep === 3 && (
                              <div className="flex flex-col items-center justify-center rounded-lg border border-[#E2E8F0] bg-white p-12 shadow-sm">
                                    <h2 className="mb-4 text-2xl font-bold text-slate-900">Send Mode</h2>
                                    <p className="mb-6 text-slate-500">Select recipients and dispatch your email.</p>
                                    <div className="flex gap-4">
                                          <Button variant="outline" onClick={() => setCurrentStep(2)}>Back to Preview</Button>
                                          <Button className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90">Send Email</Button>
                                    </div>
                              </div>
                        )}

                  </div>
            </div>
      );
}
