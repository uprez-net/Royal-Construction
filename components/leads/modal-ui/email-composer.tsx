"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendLeadEmail } from "@/lib/data/leads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LeadEmails } from "@prisma/client";
import { ReplyBanner } from "./reply-email";

const ROYAL_DOMAIN = "@royalconstructions.com.au";

interface EmailComposerProps {
  leadId: number;
  /** Default recipient, used when composing a fresh (non-reply) message. */
  to: string;
  /** The message being replied to, if any. Presence of this drives reply mode. */
  replyTo?: LeadEmails | null;
  projectType: string;
  location: string;
  onCancelReply?: () => void;
  onSent?: (email: LeadEmails) => void;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
}

/** Deterministically derives the "Re: ..." subject for a reply, avoiding "Re: Re: ..." stacking. */
function buildReplySubject(subject: string) {
  const stripped = subject.replace(/^(re:\s*)+/i, "").trim();
  return `Re: ${stripped}`;
}

/** Replies go to whichever side of the thread isn't Royal Constructions. */
function getReplyRecipient(email: LeadEmails) {
  return email.emailFrom.includes(ROYAL_DOMAIN)
    ? email.emailTo
    : email.emailFrom;
}

export function EmailComposer({
  leadId,
  to,
  replyTo,
  onCancelReply,
  appendEmailToLead,
  onSent,
  projectType,
  location
}: EmailComposerProps) {
  const [body, setBody] = useState("");
  const [sending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const isReply = !!replyTo;
  const recipient = replyTo ? getReplyRecipient(replyTo) : to;

  useEffect(() => {
    bodyRef.current?.focus();
  }, [replyTo]);

  async function handleSend() {
    const finalSubject = replyTo
      ? buildReplySubject(replyTo.subject)
      : `Follow Up on your request - ${projectType} (${location})`;

    if (!isReply && !finalSubject) {
      toast.error("Please enter a subject.");
      return;
    }

    if (!body.trim()) {
      toast.error("Please enter a message.");
      return;
    }

    try {
      const email = await sendLeadEmail(
        leadId,
        finalSubject,
        body.trim(),
        recipient,
      );

      appendEmailToLead(leadId, email);
      setBody("");
      onCancelReply?.();
      toast.success("Email sent.");
      onSent?.(email);
    } catch (error) {
      console.error(error);
      toast.error("Failed to send email.");
    }
  }

  return (
    <div className="border-t bg-background">
      {replyTo && (
        <ReplyBanner email={replyTo} onCancel={() => onCancelReply?.()} />
      )}

      <div className="flex items-end gap-2 p-3">
        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            isReply ? `Message ${recipient}...` : "Write a message..."
          }
          className="min-h-11 max-h-40 flex-1 resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              startTransition(handleSend);
            }
          }}
        />

        <Button
          size="icon"
          className="bg-royal-gold text-white shrink-0 hover:bg-royal-gold/90"
          disabled={sending || !body.trim()}
          onClick={() => startTransition(handleSend)}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
