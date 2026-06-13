import React, { useRef } from 'react';
import {
  Sparkles, Plus, Trash2, Link2, Paperclip, Mail, FileText, ChevronRight,
  LinkIcon,
  Loader2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { LinkItem, AttachmentItem, EmailTemplate, FormErrors, EmailAdHocTemplate } from '@/types/email-ad-hock';

interface ComposeStepProps {
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  links: LinkItem[];
  attachments: AttachmentItem[];
  errors: FormErrors;
  setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
  isGenerating: boolean;
  addLink: () => void;
  updateLink: (id: string, field: keyof LinkItem, value: string) => void;
  removeLink: (id: string) => void;
  addAttachment: () => void;
  updateAttachment: (id: string, field: keyof AttachmentItem, value: string | boolean) => void;
  removeAttachment: (id: string) => Promise<void>; // Now async
  handleAttachmentUpload: (id: string, file: File) => Promise<void>; // New
  handleGenerate: () => void;
  savedTemplates: EmailAdHocTemplate[];
  isLoadingTemplates: boolean;
  handleSelectSavedTemplate: (template: EmailAdHocTemplate) => void;
  handleDeleteTemplate: (template: EmailAdHocTemplate) => void;
  handleTemplateSelect: (template: EmailTemplate) => void;
  emailTemplateId: string | null;
  EMAIL_TEMPLATES: EmailTemplate[];
}

export default function ComposeStep({
  description, setDescription, links, attachments, errors, setErrors, isGenerating,
  addLink, updateLink, removeLink, addAttachment, updateAttachment, removeAttachment,
  handleAttachmentUpload, handleGenerate, savedTemplates, isLoadingTemplates, handleSelectSavedTemplate,
  handleDeleteTemplate, handleTemplateSelect, emailTemplateId, EMAIL_TEMPLATES,
}: ComposeStepProps) {
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  return (
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
            {/* Describe */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Describe what the email should cover
              </label>
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
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

            {/* Links */}
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
                          onChange={(e) => updateLink(link.id, 'label', e.target.value)}
                          className={cn("flex-1 border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]", linkError?.label && "border-red-500")}
                        />
                        <Input
                          placeholder="https://link-to-page.com"
                          value={link.url}
                          onChange={(e) => updateLink(link.id, 'url', e.target.value)}
                          className={cn("flex-[2] border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]", linkError?.url && "border-red-500")}
                        />
                        <Button variant="ghost" size="icon" onClick={() => removeLink(link.id)} className="shrink-0 text-slate-400 hover:text-red-500">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      {(linkError?.label || linkError?.url) && (
                        <p className="text-[11px] text-red-500 font-medium">
                          {linkError.label && linkError.url ? "Label & URL are required" : linkError.label || linkError.url}
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button variant="outline" onClick={addLink} className="border-dashed border-slate-300 text-slate-600 hover:border-[#C6923A] hover:text-[#C6923A]">
                  <Plus className="mr-2 size-4" /> Add Link
                </Button>
              </div>
            </div>

            {/* Attachments */}
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Paperclip className="size-4 text-slate-400" />
                Files / Attachments
              </label>
              <div className="space-y-3">
                {attachments.map((file) => {
                  const fileError = errors.attachments?.[file.id];
                  return (
                    <div key={file.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">

                      {/* Row 1: Label & Delete */}
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="File Name / Button Text"
                          value={file.label}
                          onChange={(e) => updateAttachment(file.id, 'label', e.target.value)}
                          className={cn("flex-1 border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]", fileError?.label && "border-red-500")}
                        />

                        {/* Mode Toggle */}
                        <div className="flex items-center border border-slate-200 rounded-md overflow-hidden h-9">
                          <button
                            type="button"
                            onClick={() => updateAttachment(file.id, 'mode', 'upload')}
                            className={cn("h-full px-3 flex items-center gap-1.5 text-xs font-medium transition-colors", file.mode === 'upload' ? 'bg-[#C6923A]/10 text-[#C6923A]' : 'bg-white text-slate-500 hover:bg-slate-50')}
                          >
                            <Upload className="size-3.5" /> Upload
                          </button>
                          <button
                            type="button"
                            onClick={() => updateAttachment(file.id, 'mode', 'url')}
                            className={cn("h-full px-3 flex items-center gap-1.5 text-xs font-medium border-l border-slate-200 transition-colors", file.mode === 'url' ? 'bg-[#C6923A]/10 text-[#C6923A]' : 'bg-white text-slate-500 hover:bg-slate-50')}
                          >
                            <LinkIcon className="size-3.5" /> URL
                          </button>
                        </div>

                        <Button variant="ghost" size="icon" onClick={() => removeAttachment(file.id)} className="shrink-0 text-slate-400 hover:text-red-500">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      {/* Row 2: Upload or URL Input based on Mode */}
                      {file.mode === 'upload' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            ref={(el) => { fileInputRefs.current[file.id] = el; }}
                            className="hidden"
                            onChange={(e) => {
                              const selectedFile = e.target.files?.[0];
                              if (selectedFile) handleAttachmentUpload(file.id, selectedFile);
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRefs.current[file.id]?.click()}
                            disabled={file.isUploading}
                            className="border-dashed border-slate-300 text-slate-600 hover:border-[#C6923A] hover:text-[#C6923A]"
                          >
                            {file.isUploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
                            {file.isUploading ? 'Uploading...' : file.url ? 'Replace File' : 'Choose File'}
                          </Button>
                          {file.url && !file.isUploading && (
                            <span className="text-xs text-green-600 font-medium truncate flex-1">File uploaded successfully</span>
                          )}
                        </div>
                      ) : (
                        <Input
                          placeholder="https://link-to-file.com"
                          value={file.url}
                          onChange={(e) => updateAttachment(file.id, 'url', e.target.value)}
                          className={cn("border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]", fileError?.url && "border-red-500")}
                        />
                      )}

                      {/* Errors */}
                      {(fileError?.label || fileError?.url) && (
                        <p className="text-[11px] text-red-500 font-medium">
                          {fileError.label && fileError.url ? "File name & URL are required" : fileError.label || fileError.url}
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button variant="outline" onClick={addAttachment} className="border-dashed border-slate-300 text-slate-600 hover:border-[#C6923A] hover:text-[#C6923A]">
                  <Plus className="mr-2 size-4" /> Add Attachment
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-[#E2E8F0] bg-slate-50/50 px-6 py-4">
            <Button onClick={handleGenerate} disabled={isGenerating} className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90">
              {isGenerating ? (
                <><Sparkles className="mr-2 size-4 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="mr-2 size-4" /> Generate Email</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Right Column: Templates */}
      <div className="space-y-6 lg:col-span-1">
        {/* Saved AI Templates */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
          <div className="border-b border-[#E2E8F0] px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <FileText className="size-5 text-[#C6923A]" />
              Saved AI Templates
            </h2>
          </div>
          {isLoadingTemplates ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">Loading templates...</div>
          ) : savedTemplates.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No AI generated templates saved yet.</div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] transition-colors">
              {savedTemplates.map((template) => (
                <div key={template.id} className={cn(
                  "group relative flex w-full items-center justify-between px-5 py-3 transition-colors hover:bg-slate-50",
                  emailTemplateId === template.id && "bg-[#C6923A]/5 border-l-2 border-[#C6923A]"
                )}>
                  <button onClick={() => handleSelectSavedTemplate(template)} className="flex-1 text-left min-w-0 pr-10 focus:outline-none group-hover:cursor-pointer">
                    <p className="truncate text-sm font-medium text-slate-900 group-hover:text-[#C6923A] transition-colors">{template.name}</p>
                    <p className="truncate text-xs text-slate-500 mt-0.5">Subject: {template.emailSubject}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Saved on {new Date(template.createdAt).toLocaleDateString()}</p>
                  </button>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(template); }} className="size-8 text-slate-400 group-hover:cursor-pointer hover:text-red-500 hover:bg-red-50 rounded-full">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Default Templates */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
          <div className="border-b border-[#E2E8F0] px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Mail className="size-5 text-[#C6923A]" />
              Default Templates
            </h2>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {EMAIL_TEMPLATES.map((template) => (
              <button key={template.id} onClick={() => handleTemplateSelect(template)} className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:cursor-pointer hover:bg-slate-50">
                <div className="min-w-0 pr-4">
                  <span className="mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#C6923A]/10 text-[#C6923A]">
                    {template.category}
                  </span>
                  <p className="truncate text-sm text-slate-700">{template.subject}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}