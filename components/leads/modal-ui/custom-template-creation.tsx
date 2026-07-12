"use client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useEmailAdHock } from "@/hooks/use-email-ad-hock";
import { Link2, LinkIcon, Loader2, Paperclip, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { GeneratingModal } from "@/components/leads/modal-ui/generating-modal";


export function CustomTemplateCreation({ hook, backgroundColor, borderColor }: { hook: ReturnType<typeof useEmailAdHock>, backgroundColor?: string, borderColor?: string }) {
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  if(hook.isGenerating) {
    return <GeneratingModal backgroundColor={backgroundColor} borderColor={borderColor} />;
  }

  return (
    <div
      style={
        {
          maxHeight: "calc(85vh - 140px)",
          "--primary-color": borderColor,
          "--primary-bg": backgroundColor,
        } as React.CSSProperties
      }
      className="overflow-y-auto overflow-x-hidden overscroll-contain"
    >
      <div className="space-y-6">
        {/* Describe */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Describe what the email should cover
          </label>
          <Textarea
            value={hook.description}
            onChange={(e) => {
              hook.setDescription(e.target.value);
              if (hook.errors.description) hook.setErrors({ ...hook.errors, description: undefined });
            }}
            placeholder="e.g. Write a follow-up email for a client named Kuldeep regarding his Double Storey project in Wilton, asking him to book a meeting..."
            className={cn(
              "min-h-[120px] resize-none border-slate-200",
              "focus-visible:border-[var(--primary-color)]",
              "focus-visible:ring-0",
              "focus-visible:outline-none",
              hook.errors.description && "border-red-500 !focus-visible:border-red-500 !focus-visible:ring-0"
            )}
          />
          {hook.errors.description && (
            <p className="mt-1 text-xs text-red-500 font-medium">{hook.errors.description}</p>
          )}
        </div>

        {/* Links */}
        <div>
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Link2 className="size-4 text-slate-400" />
            Links (Displayed as Buttons)
          </label>
          <div className="space-y-3">
            {hook.links.map((link) => {
              const linkError = hook.errors.links?.[link.id];
              return (
                <div key={link.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Button Label"
                      value={link.label}
                      onChange={(e) => hook.updateLink(link.id, 'label', e.target.value)}
                      className={cn(
                        "min-w-0 flex-1 border-slate-200",
                        "focus-visible:border-[var(--primary-color)]",
                        "focus-visible:ring-0",
                        "focus-visible:outline-none",
                        linkError?.label && "border-red-500"
                      )}
                    />
                    <Input
                      placeholder="https://link-to-page.com"
                      value={link.url}
                      onChange={(e) => hook.updateLink(link.id, 'url', e.target.value)}
                      className={cn(
                        "min-w-0 flex-[2] border-slate-200",
                        "focus-visible:border-[var(--primary-color)]",
                        "focus-visible:ring-0",
                        "focus-visible:outline-none",
                        linkError?.url && "border-red-500"
                      )}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => hook.removeLink(link.id)}
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
              onClick={hook.addLink}
              className="border-dashed border-slate-300 text-slate-600 hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]"
            >
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
            {hook.attachments.map((file) => {
              const fileError = hook.errors.attachments?.[file.id];
              return (
                <div
                  key={file.id}
                  className="flex flex-col gap-2 rounded-md border border-slate-200 p-3"
                >
                  {/* Row 1: Label & Delete */}
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="File Name / Button Text"
                      value={file.label}
                      onChange={(e) => hook.updateAttachment(file.id, 'label', e.target.value)}
                      className={cn(
                        "min-w-0 flex-1 border-slate-200",
                        "focus-visible:border-[var(--primary-color)]",
                        "focus-visible:ring-0",
                        "focus-visible:outline-none",
                        fileError?.label && "border-red-500"
                      )}
                    />

                    {/* Mode Toggle */}
                    <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-slate-200">
                      <button
                        type="button"
                        onClick={() => hook.updateAttachment(file.id, 'mode', 'upload')}
                        className={cn(
                          "flex h-full items-center gap-1.5 px-3 text-xs font-medium transition-colors",
                          file.mode === 'upload'
                            ? "bg-[var(--primary-bg)]/10 text-[var(--primary-color)]"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        )}
                      >
                        <Upload className="size-3.5" /> Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => hook.updateAttachment(file.id, 'mode', 'url')}
                        className={cn(
                          "flex h-full items-center gap-1.5 border-l border-slate-200 px-3 text-xs font-medium transition-colors",
                          file.mode === 'url'
                            ? "bg-[var(--primary-bg)]/10 text-[var(--primary-color)]"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        )}
                      >
                        <LinkIcon className="size-3.5" /> URL
                      </button>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => hook.removeAttachment(file.id)}
                      className="shrink-0 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {/* Row 2: Upload or URL Input based on Mode */}
                  {file.mode === 'upload' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        ref={(el) => {
                          fileInputRefs.current[file.id] = el;
                        }}
                        className="hidden"
                        onChange={(e) => {
                          const selectedFile = e.target.files?.[0];
                          if (selectedFile) hook.handleAttachmentUpload(file.id, selectedFile);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRefs.current[file.id]?.click()}
                        disabled={file.isUploading}
                        className="border-dashed border-slate-300 text-slate-600 hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]"
                      >
                        {file.isUploading ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 size-4" />
                        )}
                        {file.isUploading
                          ? "Uploading..."
                          : file.url
                            ? "Replace File"
                            : "Choose File"}
                      </Button>
                      {file.url && !file.isUploading && (
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-green-600">
                          File uploaded successfully
                        </span>
                      )}
                    </div>
                  ) : (
                    <Input
                      placeholder="https://link-to-file.com"
                      value={file.url}
                      onChange={(e) => hook.updateAttachment(file.id, 'url', e.target.value)}
                      className={cn(
                        "min-w-0 border-slate-200",
                        "focus-visible:border-[var(--primary-color)]",
                        "focus-visible:ring-0",
                        "focus-visible:outline-none",
                        fileError?.url && "border-red-500"
                      )}
                    />
                  )}

                  {/* Errors */}
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
              onClick={hook.addAttachment}
              className="border-dashed border-slate-300 text-slate-600 hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]"
            >
              <Plus className="mr-2 size-4" /> Add Attachment
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="-mx-6 -mb-6 mt-6 flex justify-end border-t border-[#E2E8F0] bg-slate-50/50 px-6 py-4">
        <Button
          onClick={hook.handleGenerate}
          disabled={hook.isGenerating}
          className="bg-[var(--primary-color)] text-white hover:bg-[var(--primary-color)]/90"
        >
          {hook.isGenerating ? (
            <>
              <Sparkles className="mr-2 size-4 animate-spin" /> Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 size-4" /> Generate Email
            </>
          )}
        </Button>
      </div>
    </div>
  )
}