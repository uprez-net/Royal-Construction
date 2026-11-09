"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { TaskForm } from "@/components/leads/task-form";
import { Button } from "@/components/ui/button";
import {
  ChatAvatar,
  ChatNotice,
  WhatsAppChatFrame,
  WhatsAppChatHeader,
  WhatsAppMessageList,
  type ChatMessage,
} from "@/components/whatsapp/whatsapp-chat";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useLeadWhatsAppThread } from "@/hooks/use-lead-whatsapp-thread";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import { useAppDispatch } from "@/lib/store/hooks";
import { bumpLeadTasks } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import {
  reconcileWhatsAppMessage,
  sendWhatsAppMessage,
} from "@/lib/leads/whatsapp-service";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import type {
  WhatsAppMessageDto,
  WhatsAppSendBody,
} from "@/lib/leads/whatsapp-types";
import { retryWhatsAppMediaFile } from "@/lib/projects/whatsapp-service";

import { WhatsAppComposer } from "./whatsapp-composer";
import { WhatsAppConsentPanel } from "./whatsapp-consent-panel";

export type LeadWhatsAppConversationLead = {
  id: number;
  name: string;
};

function toChatMessage(message: WhatsAppMessageDto): ChatMessage {
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
    status: message.status,
    templateName: message.templateName,
  };
}

/**
 * The one WhatsApp conversation for a lead (issue #333), drawn like WhatsApp.
 *
 * The lead modal and the project's Communications tab both render this — one
 * thread implementation, not two. It reads everything it shows from the
 * server (the thread, what may be sent next and why), so the rules live in
 * lib/domain/leads/whatsapp and nowhere here.
 */
export function LeadWhatsAppConversation({
  lead,
  className,
  headerActions,
}: {
  lead: LeadWhatsAppConversationLead;
  className?: string;
  /** Extra controls in the chat header (the modal's full-screen toggle). */
  headerActions?: React.ReactNode;
}) {
  const [sending, setSending] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [schedulingFollowUp, setSchedulingFollowUp] = useState(false);
  const dispatch = useAppDispatch();
  // One key per composed message, held until that message is sent: a double
  // click, or a retry after a timeout, is the same intent and the domain
  // answers it once. Rotated only after a success (or a reconcile), never on a
  // failure — a failed send may still have been accepted by WhatsApp.
  const sendKey = useIdempotencyKey();
  const {
    addLocal,
    error,
    hasOlder,
    lastUpdatedAt,
    loadOlder,
    loadingOlder,
    messages,
    refresh,
    refreshing,
    thread,
  } = useLeadWhatsAppThread(lead.id);

  async function handleSend(body: WhatsAppSendBody): Promise<boolean> {
    if (sending) return false;
    setSending(true);
    try {
      const result = await sendWhatsAppMessage(
        lead.id,
        body,
        sendKey.current(),
      );
      sendKey.rotate();
      addLocal(result.message);
      if (result.alreadySent) {
        toast.info(
          "That message had already been sent — it was not sent again.",
        );
      }
      void refresh();
      return true;
    } catch (sendError) {
      toast.error(
        sendError instanceof Error && sendError.message.trim()
          ? sendError.message
          : "The WhatsApp message could not be sent.",
      );
      // Show whatever the attempt left behind: a failed or unconfirmed bubble.
      void refresh();
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleReconcile(
    message: ChatMessage,
    outcome: "sent" | "not_sent",
  ) {
    setReconcilingId(message.id);
    try {
      await reconcileWhatsAppMessage(lead.id, message.id, outcome);
      // The unconfirmed attempt is settled; the next send is a new intent.
      sendKey.rotate();
      toast.success(
        outcome === "sent"
          ? "Marked as sent."
          : "Marked as not sent. You can send it again.",
      );
      void refresh();
    } catch (reconcileError) {
      toast.error(
        reconcileError instanceof Error
          ? reconcileError.message
          : "Could not reconcile the message.",
      );
    } finally {
      setReconcilingId(null);
    }
  }

  async function handleRetryMedia(mediaId: string) {
    try {
      await retryWhatsAppMediaFile(mediaId);
      toast.success("Fetching the file from WhatsApp again.");
    } catch (retryError) {
      toast.error(
        retryError instanceof Error
          ? retryError.message
          : "Could not retry the file.",
      );
    } finally {
      void refresh();
    }
  }

  const eligibility = thread?.eligibility;
  const destination = eligibility?.phone.e164
    ? formatE164ForDisplay(eligibility.phone.e164)
    : null;
  const windowOpen = eligibility?.window.open ?? false;

  const header = (
    <WhatsAppChatHeader
      avatar={<ChatAvatar name={lead.name} />}
      title={lead.name}
      subtitle={
        thread
          ? [
              destination
                ?? (eligibility && !eligibility.phone.usable
                  ? eligibility.phone.reason
                  : null),
              windowOpen && eligibility?.window.expiresAt
                ? `reply window open until ${formatSydneyStamp(eligibility.window.expiresAt)}`
                : "reply window closed · templates only",
            ]
              .filter(Boolean)
              .join(" · ")
          : "Loading…"
      }
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-[#54656f] hover:bg-black/5"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={
              lastUpdatedAt
                ? `Refresh conversation (updated ${formatSydneyStamp(lastUpdatedAt.toISOString())})`
                : "Refresh conversation"
            }
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 rounded-full text-[#54656f] hover:bg-black/5",
              showDetails && "bg-black/5",
            )}
            onClick={() => setShowDetails((value) => !value)}
            aria-pressed={showDetails}
            aria-label="Consent and follow-up"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
          </Button>
          {headerActions}
        </>
      }
    />
  );

  if (!thread) {
    return (
      <WhatsAppChatFrame header={header} className={className}>
        <div className="flex h-full min-h-[240px] items-center justify-center">
          {error ? (
            <div className="space-y-3 rounded-lg bg-white/90 px-5 py-4 text-center shadow-sm">
              <p role="alert" className="text-sm text-destructive-ink">
                {error}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <p className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm text-[#54656f] shadow-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading conversation…
            </p>
          )}
        </div>
      </WhatsAppChatFrame>
    );
  }

  return (
    <WhatsAppChatFrame
      header={header}
      className={className}
      footer={
        <>
          {showDetails ? (
            <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-t border-black/5 bg-white px-4 py-3">
              <WhatsAppConsentPanel
                thread={thread}
                onChanged={() => void refresh()}
              />
              {schedulingFollowUp ? (
                <TaskForm
                  leadId={lead.id}
                  leadName={lead.name}
                  defaultType="WHATSAPP"
                  onCancel={() => setSchedulingFollowUp(false)}
                  onCreated={() => {
                    dispatch(bumpLeadTasks());
                    setSchedulingFollowUp(false);
                    toast.success("WhatsApp follow-up scheduled.");
                  }}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSchedulingFollowUp(true)}
                  disabled={thread.lead.isArchived}
                  title={
                    thread.lead.isArchived
                      ? "This lead is archived, so it can no longer be actioned."
                      : undefined
                  }
                >
                  <CalendarPlus className="mr-1.5 size-4" aria-hidden="true" />
                  Schedule WhatsApp follow-up
                </Button>
              )}
            </div>
          ) : null}
          <WhatsAppComposer
            // Re-mount when the eligibility changes shape, so a composer that
            // was showing "text" does not keep a stale mode after the window
            // closes.
            key={`${thread.eligibility.text.allowed}:${thread.eligibility.template.allowed}`}
            thread={thread}
            sending={sending}
            onSend={handleSend}
          />
        </>
      }
    >
      <WhatsAppMessageList
        messages={messages.map(toChatMessage)}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
        onRetryMedia={(mediaId) => void handleRetryMedia(mediaId)}
        banner={
          error ? (
            <ChatNotice>{error} Showing the last loaded messages.</ChatNotice>
          ) : thread.senders.length > 1 && eligibility?.sender ? (
            <ChatNotice>
              Replies go from {eligibility.sender.label} (
              {formatE164ForDisplay(eligibility.sender.displayNumber)}).
            </ChatNotice>
          ) : null
        }
        empty={
          <ChatNotice>
            No WhatsApp messages with {lead.name} yet. Messages you send from
            here arrive from the Royal Constructions business number.
          </ChatNotice>
        }
        renderActions={(message) =>
          message.direction === "OUTBOUND" && message.needsReconciliation ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full bg-white text-xs"
                disabled={reconcilingId === message.id}
                onClick={() => void handleReconcile(message, "sent")}
              >
                Mark sent
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full bg-white text-xs"
                disabled={reconcilingId === message.id}
                onClick={() => void handleReconcile(message, "not_sent")}
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
