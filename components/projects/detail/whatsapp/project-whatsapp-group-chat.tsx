"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, Users } from "lucide-react";

import { CopyButton } from "@/components/common/copy-button";
import { Button } from "@/components/ui/button";
import {
  ChatAvatar,
  ChatNotice,
  WhatsAppChatFrame,
  WhatsAppChatHeader,
  WhatsAppComposerBar,
  WhatsAppMessageList,
  type ChatMessage,
} from "@/components/whatsapp/whatsapp-chat";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { MAX_WHATSAPP_TEXT_LENGTH } from "@/lib/domain/leads/whatsapp/policy";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  announceProjectWhatsAppChange,
  reconcileProjectWhatsAppMessage,
  retryWhatsAppMediaFile,
  sendProjectWhatsAppMessage,
} from "@/lib/projects/whatsapp-service";
import type {
  ProjectWhatsAppMessageDto,
  ProjectWhatsAppThreadDto,
} from "@/lib/projects/whatsapp-types";

function toChatMessage(message: ProjectWhatsAppMessageDto): ChatMessage {
  return {
    authorName: message.authorName,
    body: message.body,
    direction: message.direction,
    id: message.id,
    kind: message.kind,
    media: message.media,
    needsReconciliation: message.needsReconciliation,
    occurredAt: message.occurredAt,
    providerErrorTitle: message.providerErrorTitle,
    senderKey: message.senderPhoneE164,
    senderName:
      message.senderName
      ?? (message.senderPhoneE164
        ? formatE164ForDisplay(message.senderPhoneE164)
        : null),
    status: message.status,
  };
}

/**
 * A project's WhatsApp group, drawn like WhatsApp. Shows who wrote each run,
 * and who of the owners has joined, in the header.
 */
export function ProjectWhatsAppGroupChat({
  thread,
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSent,
  onChanged,
  onInvite,
  className,
}: {
  thread: ProjectWhatsAppThreadDto;
  messages: readonly ProjectWhatsAppMessageDto[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSent: (message: ProjectWhatsAppMessageDto) => void;
  onChanged: () => void;
  onInvite: () => void;
  className?: string;
}) {
  const group = thread.group;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  // One key per composed message, rotated only after it is sent.
  const sendKey = useIdempotencyKey();

  if (!group) return null;

  const joinedOwners = thread.owners.filter((owner) => owner.joined);
  const activeParticipants = group.participants.filter(
    (participant) => !participant.leftAt,
  ).length;
  const subtitle = [
    joinedOwners.length > 0
      ? `${joinedOwners.map((owner) => owner.name.split(" ")[0]).join(", ")} joined`
      : "No owners have joined yet",
    activeParticipants > 0
      ? `${activeParticipants} member${activeParticipants === 1 ? "" : "s"}`
      : null,
    group.status === "SUSPENDED" ? "suspended by WhatsApp" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function send() {
    if (sending || !group) return;
    setSending(true);
    try {
      const result = await sendProjectWhatsAppMessage(
        thread.projectId,
        draft,
        sendKey.current(),
      );
      sendKey.rotate();
      onSent(result.message);
      setDraft("");
      if (result.alreadySent) {
        toast.info(
          "That message had already been sent — it was not sent again.",
        );
      }
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : "The WhatsApp message could not be sent.",
      );
      onChanged();
    } finally {
      setSending(false);
    }
  }

  async function reconcile(message: ChatMessage, outcome: "sent" | "not_sent") {
    setReconcilingId(message.id);
    try {
      await reconcileProjectWhatsAppMessage(
        thread.projectId,
        message.id,
        outcome,
      );
      sendKey.rotate();
      toast.success(
        outcome === "sent"
          ? "Marked as sent."
          : "Marked as not sent. You can send it again.",
      );
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not reconcile the message.",
      );
    } finally {
      setReconcilingId(null);
    }
  }

  async function retryMedia(mediaId: string) {
    try {
      await retryWhatsAppMediaFile(mediaId);
      toast.success("Fetching the file from WhatsApp again.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not retry the file.",
      );
    } finally {
      onChanged();
      announceProjectWhatsAppChange(thread.projectId);
    }
  }

  const readOnly = group.status !== "ACTIVE";

  return (
    <WhatsAppChatFrame
      className={className}
      header={
        <WhatsAppChatHeader
          avatar={<ChatAvatar icon={<Users className="size-5" />} />}
          title={group.subject}
          subtitle={subtitle}
          actions={
            group.inviteLink && group.status === "ACTIVE" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onInvite}
                  className="h-8 rounded-full px-3 text-[13px] text-royal-gold-ink-text hover:bg-royal-gold-light/60"
                >
                  <Mail className="mr-1.5 size-4" aria-hidden="true" />
                  Invite owners
                </Button>
                <CopyButton
                  value={group.inviteLink}
                  iconOnly
                  variant="ghost"
                  label="Copy invite link"
                  copiedLabel="Invite link copied"
                  successToast="Invite link copied."
                  className="rounded-full text-muted-foreground hover:bg-black/5"
                />
              </>
            ) : null
          }
        />
      }
      footer={
        <WhatsAppComposerBar
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          sending={sending}
          maxLength={MAX_WHATSAPP_TEXT_LENGTH}
          disabled={readOnly}
          disabledReason={
            group.status === "SUSPENDED"
              ? "WhatsApp has suspended this group. You can read it, but nothing can be sent until the suspension clears."
              : group.status === "DELETED"
                ? "This group was deleted in WhatsApp. Its history stays here; create a new group from the project header."
                : null
          }
          placeholder={`Message ${group.subject}`}
        />
      }
    >
      <WhatsAppMessageList
        messages={messages.map(toChatMessage)}
        showSenders
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onRetryMedia={(mediaId) => void retryMedia(mediaId)}
        banner={
          <ChatNotice>
            Messages you send here appear in the group from{" "}
            {formatE164ForDisplay(group.businessDisplayNumber)}.
          </ChatNotice>
        }
        empty={
          <ChatNotice>
            The group is ready. Invite the owners, then anything they post —
            messages, photos, voice notes — shows up here.
          </ChatNotice>
        }
        renderActions={(message) =>
          message.direction === "OUTBOUND" && message.needsReconciliation ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full bg-card text-xs"
                disabled={reconcilingId === message.id}
                onClick={() => void reconcile(message, "sent")}
              >
                Mark sent
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full bg-card text-xs"
                disabled={reconcilingId === message.id}
                onClick={() => void reconcile(message, "not_sent")}
              >
                Mark not sent
              </Button>
            </div>
          ) : null
        }
      />
    </WhatsAppChatFrame>
  );
}
