"use client";

import { CertifierEmailDirection } from "@prisma/client";
import { Loader2, Mail, Paperclip, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import { certifierEmailAttachments } from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat, stripEmailBody } from "@/utils/formatters";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";

/**
 * What a bubble needs from a message. Structural, so a compliance email and a
 * tradie email both fit without either being converted into the other.
 */
export type ThreadEmail = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  sentAt: string | Date;
  /** `[{ name, url }]`; anything else renders as no attachments. */
  attachments?: unknown;
  subject?: string;
  /** A line under the body, for something the transcript cannot show. */
  footnote?: string | null;
};

type CertifierThreadProps = {
  projectId: string;
  emails: readonly ThreadEmail[];
  isSending: boolean;
  onSend: (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => Promise<void>;
  /** Set by the modal that hosts this, so the transcript uses the extra room. */
  isFullScreen?: boolean;
  /**
   * Who the other end of this thread is, in the placeholder and the empty
   * state. The compliance file now runs several of these side by side and a
   * composer that says "message to the certifier" on the surveyor's tab is
   * how somebody sends the wrong firm the wrong thing.
   */
  counterpartyLabel?: string;
  /**
   * No composer.
   *
   * For a thread there is nothing to reply to: a party whose documents the
   * client supplied has no address, and the planning portal is not a
   * correspondent. The transcript still renders -- there may be inbound mail on
   * it -- but offering a Send that would have nowhere to go is worse than
   * offering nothing.
   */
  readOnly?: boolean;
  /** Offer the Attach button. Off where the send cannot carry files. */
  allowAttachments?: boolean;
  /** Each bubble's subject above its body, for a thread of separate emails. */
  showSubjects?: boolean;
  /** Under "Nothing sent yet" when the thread is empty. */
  emptyHint?: string;
};

/**
 * The certifier conversation, as a chat.
 *
 * Adapted from the lead email section, with one deliberate difference: which
 * side a bubble sits on comes from `email.direction` rather than from sniffing
 * the sender for the company domain. That column exists precisely so this does
 * not have to guess — mail sent from an alias, or a reply relayed through a
 * ticketing system, both broke the domain check.
 *
 * Renders bare rather than in a Card: it lives inside `ModalShell`, which
 * already supplies the frame, the title and the close/fullscreen controls.
 */
/**
 * The composer's upload key.
 *
 * The one control here, and deliberately not a document scope: an attachment
 * belongs to the message being written, not to any row on the compliance file,
 * so it must not share a busy flag with one.
 */
const COMPOSER_UPLOAD_KEY = "composer";

export function CertifierThread({
  projectId,
  emails,
  isSending,
  onSend,
  isFullScreen = false,
  counterpartyLabel = "certifier",
  readOnly = false,
  allowAttachments = true,
  showSubjects = false,
  emptyHint = "The conversation appears here once the documents go out.",
}: CertifierThreadProps) {
  const dispatch = useAppDispatch();
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<CertifierReplyAttachment[]>([]);
  const { uploadFile, isUploading } = useComplianceUpload(projectId);
  const isAttaching = isUploading(COMPOSER_UPLOAD_KEY);

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
      const uploaded = await uploadFile(file, COMPOSER_UPLOAD_KEY, {
        rootTrail: true,
        trail: ["Project", "Compliance", "Certifier thread"],
        tags: ["Compliance", "Certifier email", "Email attachment"],
      });
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
    <div className="flex flex-col">
      <div className="min-h-0 flex-1">
        {orderedEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail
              className="mb-3 size-8 text-muted-foreground/40"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-muted-foreground">
              Nothing sent yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">{emptyHint}</p>
          </div>
        ) : (
          <ScrollArea
            className={cn(
              "rounded-lg border border-border/70 bg-muted/20 px-4",
              isFullScreen ? "h-[65vh]" : "h-[52vh] max-h-115",
            )}
          >
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
                          "max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-5",
                          isSent
                            ? "bg-muted text-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm",
                        )}
                      >
                        {showSubjects && email.subject ? (
                          <p className="mb-1 text-xs font-semibold text-foreground">
                            {email.subject}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap wrap-break-word">
                          {plainBody}
                        </p>

                        {email.footnote ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {email.footnote}
                          </p>
                        ) : null}

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
                                    "text-royal-gold-ink-text",
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
                            "text-muted-foreground",
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
      </div>

      {readOnly ? null : (
        <div className="mt-3 shrink-0 border-t border-border/70 pt-3">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={`Write a message to the ${counterpartyLabel}…`}
            rows={3}
            aria-label={`Message to the ${counterpartyLabel}`}
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
            {allowAttachments ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isAttaching || isSending}
                onClick={() => attachmentInputRef.current?.click()}
              >
                {isAttaching ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Paperclip className="size-4" aria-hidden="true" />
                )}
                Attach
              </Button>
            ) : (
              <span />
            )}

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
      )}
    </div>
  );
}
