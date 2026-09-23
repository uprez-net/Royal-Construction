"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Loader2, MessageCircle, RefreshCw } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { TaskForm } from "@/components/leads/task-form";
import { Button } from "@/components/ui/button";
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

import { WhatsAppComposer } from "./whatsapp-composer";
import { WhatsAppConsentPanel } from "./whatsapp-consent-panel";
import { WhatsAppThread } from "./whatsapp-thread";

export type LeadWhatsAppModalLead = {
  id: number;
  name: string;
};

/**
 * The one WhatsApp conversation for a lead (issue #333).
 *
 * The leads list, the lead page and the follow-ups view all open this same
 * component — one thread implementation, not a list copy and a detail copy.
 * It reads everything it shows from the server (the thread, what may be sent
 * next and why), so the rules live in lib/domain/leads/whatsapp and nowhere
 * here.
 */
export function LeadWhatsAppModal({
  lead,
  onClose,
}: {
  lead: LeadWhatsAppModalLead;
  onClose: () => void;
}) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sending, setSending] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
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
      const result = await sendWhatsAppMessage(lead.id, body, sendKey.current());
      sendKey.rotate();
      addLocal(result.message);
      if (result.alreadySent) {
        toast.info(
          "That message had already been sent — it was not sent again.",
        );
      } else {
        toast.success("WhatsApp message sent.");
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
    message: WhatsAppMessageDto,
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

  const eligibility = thread?.eligibility;
  const destination = eligibility?.phone.e164
    ? formatE164ForDisplay(eligibility.phone.e164)
    : null;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="size-4 text-emerald-600" aria-hidden="true" />
          {lead.name} — WhatsApp
        </span>
      }
      subtitle={
        destination
          ? `To ${destination}${eligibility?.sender ? ` · from ${eligibility.sender.label} (${formatE164ForDisplay(eligibility.sender.displayNumber)})` : ""}`
          : (eligibility?.phone.usable === false ? eligibility.phone.reason : undefined)
      }
      maxWidthClass="max-w-[720px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) => setIsFullScreen(!minimize)}
    >
      {!thread ? (
        error ? (
          <div className="space-y-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive-ink">
              {error}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading conversation…
          </div>
        )
      ) : (
        <div className={cn("flex flex-col gap-4", isFullScreen && "h-full")}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <WindowIndicator
              open={thread.eligibility.window.open}
              expiresAt={thread.eligibility.window.expiresAt}
            />
            <div className="flex items-center gap-2 text-muted-foreground">
              {lastUpdatedAt ? (
                <span aria-live="polite">
                  Updated {formatSydneyStamp(lastUpdatedAt.toISOString())}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh conversation"
              >
                <RefreshCw
                  className={cn("size-3.5", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-destructive-light px-3 py-2 text-xs text-destructive-ink">
              {error} Showing the last loaded messages.
            </p>
          ) : null}

          <div className={cn("overflow-y-auto pr-1", isFullScreen ? "flex-1" : "max-h-[45vh]")}>
            <WhatsAppThread
              messages={messages}
              hasOlder={hasOlder}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
              onReconcile={(message, outcome) =>
                void handleReconcile(message, outcome)
              }
              reconcilingId={reconcilingId}
              showSender={thread.senders.length > 1}
            />
          </div>

          <WhatsAppComposer
            // Re-mount when the eligibility changes shape, so a composer that
            // was showing "text" does not keep a stale mode after the window
            // closes.
            key={`${thread.eligibility.text.allowed}:${thread.eligibility.template.allowed}`}
            thread={thread}
            sending={sending}
            onSend={handleSend}
          />

          <WhatsAppConsentPanel thread={thread} onChanged={() => void refresh()} />

          <div className="border-t border-border pt-3">
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
        </div>
      )}
    </ModalShell>
  );
}

function WindowIndicator({
  open,
  expiresAt,
}: {
  open: boolean;
  expiresAt: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
        open
          ? "bg-success-light text-success-ink"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-2 rounded-full",
          open ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      {open && expiresAt
        ? `Reply window open until ${formatSydneyStamp(expiresAt)}`
        : "Reply window closed — approved templates only"}
    </span>
  );
}
