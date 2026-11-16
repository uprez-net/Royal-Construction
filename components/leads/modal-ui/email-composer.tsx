"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { sendLeadEmail } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import type { LeadEmails } from "@prisma/client";
import { ReplyBanner } from "./reply-email";
import { createLeadNotesDocument } from "@/lib/rich-text/lead-notes";
import {
  BasicBlocksPlugin,
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import { LinkPlugin } from "@platejs/link/react";
import type { LeadRichTextDocument, LeadRichTextNode } from "@/lib/leads/types";
import {
  Plate,
  PlateElement,
  type PlateElementProps,
  usePlateEditor,
} from "platejs/react";
import { type Value } from "platejs";
import { EditorToolbar } from "@/components/rich-text/lead-rich-text-editor";
import { Editor, EditorContainer } from "@/components/rich-text/plate-editor";

type LinkElementNode = LeadRichTextNode & {
  url?: string;
};

type MentionElementNode = LeadRichTextNode & {
  key?: string;
  value?: string;
};

type PreservedMention = {
  token: string;
  node: MentionElementNode;
};

function LinkElement(props: PlateElementProps) {
  const element = props.element as LinkElementNode;
  const href = typeof element.url === "string" ? element.url : undefined;

  return (
    <PlateElement
      {...props}
      as="a"
      attributes={{
        ...props.attributes,
        contentEditable: false,
        href,
        rel: "noreferrer",
        target: "_blank",
      }}
      className="font-medium text-royal-gold-ink underline underline-offset-2"
    >
      {props.children}
    </PlateElement>
  );
}

function cloneMentionNode(node: MentionElementNode): MentionElementNode {
  return {
    children: [{ text: "" }],
    key: node.key,
    type: "mention",
    value: node.value,
  };
}

function textWithMentionsToNodes(
  text: string,
  preservedMentions: PreservedMention[],
): LeadRichTextNode[] {
  const mentionsByToken = new Map(
    preservedMentions.map((mention) => [mention.token, mention.node]),
  );
  const escapedTokens = preservedMentions.map((mention) =>
    mention.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const tokenPattern =
    escapedTokens.length > 0
      ? new RegExp(`(${escapedTokens.join("|")})`, "g")
      : null;
  let restoredText = text.trim();

  for (const mention of preservedMentions) {
    if (!restoredText.includes(mention.token)) {
      restoredText = `${restoredText}${restoredText ? " " : ""}${mention.token}`;
    }
  }

  const paragraphs = restoredText
    ? restoredText.split(/\r?\n(?:\s*\r?\n)*/)
    : [""];

  return paragraphs.map((paragraph) => {
    if (!tokenPattern) {
      return { type: "p", children: [{ text: paragraph }] };
    }

    const children: LeadRichTextNode[] = [];
    const parts = paragraph.split(tokenPattern).filter((part) => part !== "");

    for (const part of parts) {
      const mention = mentionsByToken.get(part);
      if (mention) {
        children.push(cloneMentionNode(mention));
      } else if (part) {
        children.push({ text: part });
      }
    }

    return {
      type: "p",
      children: children.length > 0 ? children : [{ text: "" }],
    };
  });
}

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
  location,
}: EmailComposerProps) {
  const [body, setBody] = useState<LeadRichTextDocument>();
  const [sending, startTransition] = useTransition();
  const surface = useRef<HTMLDivElement>(null);

  const isReply = !!replyTo;
  const recipient = replyTo ? getReplyRecipient(replyTo) : to;
  const initialDocument = useMemo(
    () => createLeadNotesDocument({ plainText: "" }),
    [],
  );

  const editor = usePlateEditor(
    {
      plugins: [
        BasicBlocksPlugin,
        BoldPlugin,
        ItalicPlugin,
        UnderlinePlugin,
        StrikethroughPlugin,
        ListPlugin,
        LinkPlugin.configure({
          options: {
            defaultLinkAttributes: {
              rel: "noreferrer",
              target: "_blank",
            },
          },
        }).withComponent(LinkElement),
      ],
      value: initialDocument.value as unknown as Value,
    },
    [],
  );
  const replaceNoteText = (text: string) => {
    const nextDocument = createLeadNotesDocument({
      value: textWithMentionsToNodes(text, []),
    });
    editor.tf.replaceNodes(nextDocument.value as unknown as Value, {
      at: [],
      children: true,
    });
    setBody(nextDocument);
  };

  // Replying puts the cursor in the message, ready to type.
  useEffect(() => {
    if (!replyTo) return;
    surface.current
      ?.querySelector<HTMLElement>("[contenteditable='true']")
      ?.focus();
  }, [replyTo]);

  async function handleSend() {
    if (body === undefined) {
      toast.error("Please enter a message.");
      return;
    }

    if (!body.html.trim()) {
      toast.error("Please enter a message.");
      return;
    }

    try {
      const email = await sendLeadEmail(
        leadId,
        `${projectType} - ${location}`,
        body.html.trim(),
        recipient,
        replyTo ?? undefined,
      );

      appendEmailToLead(leadId, email);
      // Clear the editor itself, not only the copy held in state: leaving the
      // sent text in the box invites sending it a second time.
      replaceNoteText("");
      onCancelReply?.();
      toast.success("Email sent.");
      onSent?.(email);
    } catch (error) {
      console.error(error);
      toast.error("Failed to send email.");
    }
  }

  const canSend = !sending && body !== undefined && Boolean(body?.html.trim());

  return (
    <div className="border-t border-border/70 bg-card p-3 sm:p-4">
      <div
        ref={surface}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSend) startTransition(handleSend);
          }
        }}
        className="relative z-10 overflow-visible rounded-lg border border-border bg-background shadow-xs transition focus-within:border-royal-gold/60 focus-within:ring-4 focus-within:ring-royal-gold/10"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">To</span>
          <span className="inline-flex min-w-0 items-center rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground">
            <span className="truncate">
              {recipient || "No address on file"}
            </span>
          </span>
        </div>

        {replyTo && (
          <ReplyBanner email={replyTo} onCancel={() => onCancelReply?.()} />
        )}

        <EditorToolbar
          editor={editor}
          onReplaceNoteText={replaceNoteText}
          value={body}
          hideMentionInfo={true}
        />
        <Plate
          editor={editor}
          onChange={({ value: nextValue }) => {
            const newValue = createLeadNotesDocument({
              value: nextValue as LeadRichTextNode[],
            });
            setBody(newValue);
          }}
        >
          <EditorContainer>
            <Editor
              aria-label={isReply ? "Reply message" : "Email message"}
              placeholder={isReply ? "Write your reply…" : "Write a message…"}
            />
          </EditorContainer>
        </Plate>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3.5 py-2">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            <kbd className="rounded border border-border bg-muted px-1 font-sans">
              Ctrl
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans">
              Enter
            </kbd>{" "}
            to send · signed with your name
          </p>
          <Button
            variant="royal"
            className="ml-auto h-9 shrink-0 rounded-full px-4"
            aria-label={isReply ? "Send reply" : "Send email"}
            disabled={!canSend}
            onClick={() => startTransition(handleSend)}
          >
            {sending ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <SendHorizontal className="mr-1.5 size-4" aria-hidden="true" />
            )}
            {isReply ? "Send reply" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
