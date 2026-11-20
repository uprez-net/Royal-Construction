"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import type {
  TradieThread,
  TradieThreadReplyResult,
} from "@/lib/domain/tradies/emails";
import { FetchError, fetchJson } from "@/utils/fetch";

import {
  CertifierThread,
  type ThreadEmail,
} from "./compliance-tab/certifier-thread";

/** The thread as it arrives over JSON: dates are strings. */
type ThreadResponse = Omit<TradieThread, "messages"> & {
  messages: (Omit<TradieThread["messages"][number], "sentAt"> & {
    sentAt: string;
  })[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      thread: ThreadResponse;
      /**
       * A reload after the first one failed. The thread already on screen
       * stays, and the composer with it, so nothing typed is lost to a
       * refresh that did not come back.
       */
      refreshError: string | null;
    };

function threadUrl(projectId: string, tradieId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/tradies/${encodeURIComponent(tradieId)}/emails`;
}

/**
 * One tradie's emails about this project, and a box to answer them.
 *
 * Opened from a quote card on the Tradies tab. What it shows is filed by the
 * server (lib/domain/tradies/emails.ts): the request email, reminders and
 * reschedules, the week-out confirmation, replies typed here or in Outlook,
 * and whatever the tradie wrote back. A reply keeps the thread's reference in
 * its subject, so the tradie's answer comes back matched to the same bookings.
 */
export function TradieEmailThreadModal({
  projectId,
  tradie,
  onClose,
}: {
  projectId: string;
  /** Who the thread is with; null keeps the modal shut. */
  tradie: { tradieId: string; name: string } | null;
  onClose: () => void;
}) {
  const open = tradie !== null;
  return (
    <ModalShellFrame open={open} name={tradie?.name ?? ""} onClose={onClose}>
      {tradie ? (
        // Keyed, so switching tradies starts from a clean thread and a fresh
        // attempt key rather than showing one tradie's mail under another's
        // name for a render.
        <ThreadBody
          key={tradie.tradieId}
          projectId={projectId}
          tradieId={tradie.tradieId}
        />
      ) : null}
    </ModalShellFrame>
  );
}

function ModalShellFrame({
  open,
  name,
  onClose,
  children,
}: {
  open: boolean;
  name: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const onToggleFullScreen = useCallback(
    (minimize?: boolean) => setIsFullScreen(!minimize),
    [],
  );
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={name ? `Emails with ${name}` : "Emails"}
      subtitle="Everything sent to and received from this tradie about this project."
      maxWidthClass="max-w-[720px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={onToggleFullScreen}
    >
      {children}
    </ModalShell>
  );
}

function ThreadBody({
  projectId,
  tradieId,
}: {
  projectId: string;
  tradieId: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isSending, setIsSending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const attemptKey = useIdempotencyKey();

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ThreadResponse>(
      threadUrl(projectId, tradieId),
      { method: "GET" },
      "Could not load the emails with this tradie.",
      controller.signal,
    )
      .then((response) =>
        setState({
          refreshError: null,
          status: "ready",
          thread: response.data,
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Could not load the emails with this tradie.";
        setState((current) =>
          current.status === "ready"
            ? { ...current, refreshError: message }
            : { message, status: "error" },
        );
      });
    return () => controller.abort();
  }, [projectId, tradieId, reloadToken]);

  const reload = () => setReloadToken((value) => value + 1);

  const emails = useMemo<ThreadEmail[]>(
    () =>
      state.status === "ready"
        ? state.thread.messages.map((message) => ({
            body: message.body,
            direction: message.direction,
            footnote:
              message.source === "request"
                ? "Request email"
                : message.hasAttachments
                  ? "This email had attachments. Open it in Outlook to see them."
                  : null,
            id: message.id,
            sentAt: message.sentAt,
            subject: message.subject,
          }))
        : [],
    [state],
  );

  const send = async ({ body }: { body: string }) => {
    setIsSending(true);
    try {
      const response = await fetchJson<TradieThreadReplyResult>(
        threadUrl(projectId, tradieId),
        {
          body: JSON.stringify({ attemptKey: attemptKey.current(), body }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        "Could not send the email.",
      );
      // A new key for the next message: this one has gone.
      attemptKey.rotate();
      toast.success(
        response.data.alreadySent
          ? "That message had already gone; it was not sent again."
          : `Sent to ${response.data.to}.`,
      );
      reload();
    } catch (error) {
      // 502 is the send itself failing with an unknown outcome. The message
      // says to check Sent Items first; once someone has, sending again is a
      // deliberate new attempt, so it gets a new key rather than being refused
      // as a replay of this one. Anything else keeps the key: a timeout here
      // may be a send the server finished.
      if (error instanceof FetchError && error.status === 502) {
        attemptKey.rotate();
      }
      toast.error(
        error instanceof Error ? error.message : "Could not send the email.",
      );
      // The composer keeps what was typed.
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading emails…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  const blocked = state.thread.replyBlockedBy;
  return (
    <div className="space-y-2">
      {state.refreshError ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <span>
            Could not refresh the emails: {state.refreshError} What is shown may
            be out of date.
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={reload}>
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      ) : null}
      {blocked ? (
        <p className="rounded-md border border-warning/40 bg-warning-light px-3 py-2 text-xs text-warning-ink">
          {blocked}
        </p>
      ) : null}
      <CertifierThread
        projectId={projectId}
        emails={emails}
        isSending={isSending}
        onSend={send}
        counterpartyLabel="tradie"
        readOnly={blocked !== null}
        allowAttachments={false}
        showSubjects
        emptyHint="Request, reminder and reply emails with this tradie appear here."
      />
    </div>
  );
}
