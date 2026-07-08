"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendLeadEmail } from "@/lib/data/leads";
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
      className="font-medium text-[#0D9488] underline decoration-[#5eead4] underline-offset-2"
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    bodyRef.current?.focus();
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
      );

      appendEmailToLead(leadId, email);
      setBody(createLeadNotesDocument({ plainText: "" }));
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

      <div className="relative z-10 mt-1 overflow-visible rounded-[6px] border border-[#d6d3d1] bg-white focus-within:border-[#0D9488] focus-within:ring-2 focus-within:ring-[#CCFBF1]">
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
              aria-labelledby={`${isReply ? "reply" : "compose"}-email-editor-label`}
              placeholder="Write your message here..."
            />
          </EditorContainer>
        </Plate>

        <div className="flex items-center justify-end border-t border-[#e7e5e4] bg-[#f8fafc] px-3 py-2">
          <Button
            size="icon"
            className="bg-royal-gold text-white shrink-0 hover:bg-royal-gold/90"
            disabled={sending || body === undefined || !body?.html.trim()}
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
    </div>
  );
}
