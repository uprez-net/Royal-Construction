"use client";

import {
  Check,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { cn } from "@/lib/utils";
import type { VaultAttachmentOption } from "@/types/compliance";

/**
 * One file the sender has added to this message.
 *
 * `source` is display only — the chip says whether this came off the file or
 * off somebody's desktop, because the two are answers to different questions
 * and a reader checking what a message carried should not have to guess which.
 * Both end up as the same thing on the send: a File id.
 */
export type ExtraAttachment = {
  fileId: string;
  name: string;
  source: "vault" | "upload";
};

/**
 * "Attach something else", on every modal that sends a party a message.
 *
 * Each of those modals already lists what the message will carry, resolved from
 * the document rows — the surveyor's three for the architect, the report and
 * the plans for the developer, the revised set for a redraw. That list is shown
 * and not chosen, deliberately: by the time an architect can be engaged the
 * survey is on the file by definition, and offering it as a checkbox invites
 * somebody to send an architect a site with no survey on it.
 *
 * What it could not do is carry anything else, and there are two quite separate
 * versions of "anything else". One is a document already on this job that this
 * particular party happens to need — the 10.7 for a consultant whose table does
 * not list it, the deposited plan for a developer asking about setbacks. The
 * other is something that has never been on the job at all: the estate's
 * covenant schedule, a neighbour's written consent, a photograph of the survey
 * pegs. So there are two controls, and the difference matters — picking from
 * the vault attaches the copy the file already holds, while uploading puts a
 * new document on the project.
 *
 * Without either, the answer was to send it from Outlook, which puts a document
 * this job depends on somewhere nothing on this job can see.
 *
 * The upload is a plain project file rather than a compliance document, and
 * that is deliberate. A covenant schedule is not one of the tracked types and
 * filing it as UNKNOWN would put it in the needs-identifying queue, where
 * somebody would have to decide what it was before the outreach could go.
 */
export function ExtraAttachmentsField({
  projectId,
  value,
  onChange,
  disabled = false,
  label = "Attach anything else",
  /**
   * What is on the file already, from `vaultAttachmentOptions`.
   *
   * Empty is legitimate — a modal on a job whose file is still empty, or a
   * caller that has nothing sensible to offer — and the vault control simply
   * does not render.
   */
  vaultOptions = [],
  /**
   * What this is for, in one line under the control.
   *
   * Per caller because the useful example differs: a developer wants the
   * covenant schedule, a consultant redoing a report wants the objection that
   * came in on paper. A generic "add files" says nothing anybody needed told.
   */
  hint,
  /**
   * Whether a transfer is in the air, reported to whoever owns the Send button.
   *
   * The count below is the whole point of this control and it was invisible
   * from outside: every modal disabled its submit on the mutation alone, so a
   * sender who attached a large file and pressed Send immediately dispatched
   * the ids of the uploads that had finished, and the mail went out short with
   * a success toast on top of it. The control cannot disable a button it does
   * not own, so it says, and the caller gates.
   */
  onUploadingChange,
}: {
  projectId: string;
  value: ExtraAttachment[];
  onChange: (next: ExtraAttachment[]) => void;
  disabled?: boolean;
  label?: string;
  vaultOptions?: readonly VaultAttachmentOption[];
  hint?: string;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useComplianceUpload(projectId);
  const [isVaultOpen, setIsVaultOpen] = useState(false);

  /**
   * How many transfers are in the air, not whether one is.
   *
   * The control takes several files at once and each is its own upload, so a
   * boolean would clear on the first one that finished and re-enable a Send
   * whose other two attachments were still uploading. That is a mail that goes
   * out short, which is exactly the failure this control exists to prevent.
   */
  const [inFlight, setInFlight] = useState(0);
  const isUploading = inFlight > 0;

  // Reported on the crossing rather than on every change, so a caller adding
  // three files at once is told "uploading" once and "done" once.
  //
  // The cleanup is the half that matters. Several callers render this control
  // conditionally -- ReviewPlansModal only on a rejection, ResolveMeetingModal
  // only on a reschedule -- so it can unmount with a transfer still in the air,
  // and the effect that would have reported the crossing back to false goes
  // with it. The caller is then left holding `true` for good: its Send button
  // never re-enables and the dialog cannot be submitted at all. Saying "not
  // uploading" on the way out is what a caller can actually act on; the
  // orphaned transfer resolves into a component that is gone.
  useEffect(() => {
    onUploadingChange?.(isUploading);
    return () => onUploadingChange?.(false);
  }, [isUploading, onUploadingChange]);

  /**
   * What is picked right now, for the upload to append to when it lands.
   *
   * `handleFiles` is async and closes over `value` as it was when the file was
   * chosen. The vault picker stays live during an upload — deliberately, since
   * the two are unrelated — so a sender who picks a document from the file
   * while a scan is transferring had that pick silently reverted the moment the
   * scan finished, by an `onChange` built from the value before it. They then
   * sent a message short of a file they had selected and watched appear.
   */
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  const picked = useMemo(
    () => new Set(value.map((attachment) => attachment.fileId)),
    [value],
  );

  const toggleVaultFile = (option: VaultAttachmentOption) => {
    if (picked.has(option.fileId)) {
      onChange(
        value.filter((attachment) => attachment.fileId !== option.fileId),
      );
      return;
    }
    onChange([
      ...value,
      {
        fileId: option.fileId,
        // Named by what it is and then what it is called, matching the list it
        // was picked from — a chip reading "scan_0043.pdf" is not a receipt
        // anybody can check.
        name: `${option.documentLabel} — ${option.filename}`,
        source: "vault",
      },
    ]);
  };

  const handleFiles = async (files: FileList) => {
    const chosen = Array.from(files);
    if (chosen.length === 0) return;

    setInFlight((count) => count + chosen.length);

    // Settled rather than all: one file failing must not discard the two that
    // uploaded beside it, which the sender would then have to find again.
    const results = await Promise.allSettled(
      chosen.map((file) =>
        uploadFile(file, `extra-attachment:${file.name}:${file.size}`),
      ),
    );

    const added: ExtraAttachment[] = [];
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        added.push({
          fileId: result.value.fileId,
          name: result.value.name,
          source: "upload",
        });
      } else {
        failed += 1;
      }
    }

    setInFlight((count) => Math.max(0, count - chosen.length));

    if (added.length > 0) {
      onChange([...latestValue.current, ...added]);
    }
    if (failed > 0) {
      toast.error(
        failed === 1
          ? "One file could not be uploaded. Try attaching it again."
          : `${failed} files could not be uploaded. Try attaching them again.`,
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>

        <div className="flex items-center gap-2">
          {vaultOptions.length > 0 ? (
            <Popover open={isVaultOpen} onOpenChange={setIsVaultOpen} modal>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                  From the file
                </Button>
              </PopoverTrigger>
              {/* Wider than the trigger, unlike the pickers elsewhere on this
                  tab: every row here is a document name and a filename, and at
                  trigger width both truncate to the point of uselessness. */}
              <PopoverContent className="w-96 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search documents on this job…" />
                  <CommandList>
                    <CommandEmpty>Nothing on the file matches.</CommandEmpty>
                    <CommandGroup>
                      {vaultOptions.map((option) => (
                        <CommandItem
                          key={option.fileId}
                          // Both, so searching by what a document is or by what
                          // the scanner called it both find the row.
                          value={`${option.documentLabel} ${option.filename}`}
                          onSelect={() => toggleVaultFile(option)}
                        >
                          <Check
                            className={cn(
                              "size-4 shrink-0",
                              picked.has(option.fileId)
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {option.documentLabel}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.filename}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : null}

          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = event.target.files;
              if (files) void handleFiles(files);
              // Cleared so re-picking the same file still fires a change.
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip className="size-4" aria-hidden="true" />
            )}
            {isUploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((attachment) => (
            <li
              key={attachment.fileId}
              className="flex items-center gap-2 rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm"
            >
              {attachment.source === "vault" ? (
                <FolderOpen
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <FileText
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              {/* Removed from the message, not from the project. A vault file
                  was never this control's to delete, and an upload has already
                  written a File row somebody may be relying on; unpicking here
                  is the sender changing their mind about what this email
                  carries. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    value.filter((entry) => entry.fileId !== attachment.fileId),
                  )
                }
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">
                  Remove {attachment.name} from this message
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** The ids, in the order they were picked, as every send wants them. */
export function extraAttachmentIds(
  attachments: readonly ExtraAttachment[],
): string[] {
  return attachments.map((attachment) => attachment.fileId);
}
