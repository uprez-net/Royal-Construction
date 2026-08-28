"use client";

import { CertifierEmailDirection } from "@prisma/client";
import { Loader2, Mail, Paperclip, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import {
  certifierEmailAttachments,
  type CertifierEmailRecord,
} from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat, stripEmailBody } from "@/utils/formatters";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";

type CertifierThreadProps = {
  projectId: string;
  emails: CertifierEmailRecord[];
  isSending: boolean;
  onSend: (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => Promise<void>;
};

/**
 * The certifier conversation, as a chat.
 *
 * Adapted from the lead email section, with one deliberate difference: which
 * side a bubble sits on comes from `email.direction` rather than from sniffing
 * the sender for the company domain. That column exists precisely so this does
 * not have to guess — mail sent from an alias, or a reply relayed through a
 * ticketing system, both broke the domain check.
 */
export function CertifierThread({
  projectId,
  emails,
  isSending,
  onSend,
}: CertifierThreadProps) {
  const dispatch = useAppDispatch();
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<CertifierReplyAttachment[]>([]);
  const { uploadFile, uploadingKey } = useComplianceUpload(projectId);

  const orderedEmails = useMemo(
    () =>
      [...emails].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      ),
    [emails],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [orderedEmails.length]);

  /**
   * Every attachment on the thread, oldest first, deduplicated by url.
   *
   * The gallery pool for the bubbles. A certifier who sends six site photos
   * across three replies gets one gallery, not three — and because the thread
   * quotes itself, the same file can appear on more than one message.
   */
  const threadAttachments = useMemo(() => {
    const seen = new Set<string>();
    return orderedEmails.flatMap((email) =>
      certifierEmailAttachments(email.attachments).filter((attachment) => {
        if (seen.has(attachment.url)) return false;
        seen.add(attachment.url);
        return true;
      }),
    );
  }, [orderedEmails]);

  const handlePreviewAttachment = (url: string) => {
    const index = threadAttachments.findIndex(
      (attachment) => attachment.url === url,
    );
    // Attachments carry a name and a url only — no stored MIME type — so the
    // name is what tells a photo from a document here.
    const action = filePreviewModal(threadAttachments, index);
    if (action) dispatch(openModal(action));
  };

  const handleAttach = async (file: File) => {
    try {
      const uploaded = await uploadFile(file, "composer");
      setPending((current) => [
        ...current,
        { fileId: uploaded.fileId, name: uploaded.name, url: uploaded.url },
      ]);
    } catch {
      toast.error(`Could not attach ${file.name}.`);
    }
  };

  const handleSend = async () => {
    if (!body.trim()) {
      toast.error("Write a message before sending.");
      return;
    }
    try {
      await onSend({ body: body.trim(), attachments: pending });
      setBody("");
      setPending([]);
    } catch {
      // The thunk surfaces its own message; nothing to add here.
    }
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Certifier thread
          </CardTitle>
        </div>
        <Badge variant="secondary">
          {orderedEmails.length} message{orderedEmails.length === 1 ? "" : "s"}
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        {orderedEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Mail
              className="mb-3 size-8 text-muted-foreground/40"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-muted-foreground">
              Nothing sent yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              The conversation appears here once the documents go out.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-80 px-4">
            <div className="flex flex-col py-4">
              {orderedEmails.map((email) => {
                const isSent =
                  email.direction === CertifierEmailDirection.OUTBOUND;
                const plainBody = stripEmailBody(email.body);
                const attachments = certifierEmailAttachments(
                  email.attachments,
                );

                return (
                  <div key={email.id} className="mb-2 last:mb-0">
                    <div
                      className={cn(
                        "flex items-end gap-1.5 py-0.5",
                        isSent ? "flex-row-reverse" : "flex-row",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-5",
                          isSent
                            ? "bg-royal-gold text-white rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm",
                        )}
                      >
                        <p className="whitespace-pre-wrap wrap-break-word">
                          {plainBody}
                        </p>

                        {attachments.length > 0 ? (
                          <ul className="mt-2 space-y-1 border-t border-current/20 pt-2">
                            {attachments.map((attachment) => (
                              <li key={attachment.url}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePreviewAttachment(attachment.url)
                                  }
                                  className={cn(
                                    "inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline",
                                    isSent ? "text-white/90" : "text-primary",
                                  )}
                                >
                                  <Paperclip
                                    className="size-3"
                                    aria-hidden="true"
                                  />
                                  {attachment.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <p
                          className={cn(
                            "mt-1.5 text-right text-[10px]",
                            isSent ? "text-white/70" : "text-muted-foreground",
                          )}
                        >
                          {dataTimeFormat.format(new Date(email.sentAt))}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <div className="border-t border-border/70 p-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message to the certifier…"
          rows={3}
          aria-label="Message to the certifier"
        />

        {pending.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {pending.map((attachment) => (
              <li key={attachment.fileId}>
                <Badge variant="secondary" className="gap-1">
                  <Paperclip className="size-3" aria-hidden="true" />
                  {attachment.name}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <input
            ref={attachmentInputRef}
            type="file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleAttach(file);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploadingKey === "composer" || isSending}
            onClick={() => attachmentInputRef.current?.click()}
          >
            {uploadingKey === "composer" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip className="size-4" aria-hidden="true" />
            )}
            Attach
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isSending || !body.trim()}
            onClick={() => void handleSend()}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send
          </Button>
        </div>
      </div>
    </Card>
  );
}
