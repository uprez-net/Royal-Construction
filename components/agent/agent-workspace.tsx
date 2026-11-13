"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEveAgent } from "eve/react";
import type { MessageStreamEvent } from "eve/client";
import type { AgentInputResponse } from "@/components/agent/agent-approval";
import { AgentComposer } from "@/components/agent/agent-composer";
import {
  classifySendFailure,
  draftStorageKey,
  isStalledTurn,
  isTerminalSessionStatus,
} from "@/components/agent/agent-connection";
import { AgentHeader } from "@/components/agent/agent-header";
import { AgentHistory } from "@/components/agent/agent-history";
import { AgentInspector } from "@/components/agent/agent-inspector";
import type { AgentAnnotation } from "@/components/agent/agent-mentions";
import {
  agentTranscriptReducer,
  isTaskNotification,
  type AgentTranscriptData,
} from "@/components/agent/agent-reducer";
import type { AgentResultAction } from "@/components/agent/agent-result";
import { AgentTranscript } from "@/components/agent/agent-transcript";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import type {
  AgentSessionListItem,
  AgentWorkspaceData,
} from "@/lib/data/agent-sessions";

export type AgentUploadedFile = {
  agentUrl: string | null;
  filename: string;
  fileType: string;
  url: string;
};

export function AgentWorkspace({
  initialAnnotationsByTurn,
  initialEvents,
  initialSessions,
  selectedSessionId,
}: {
  initialAnnotationsByTurn: AgentWorkspaceData["selectedAnnotationsByTurn"];
  initialEvents: readonly unknown[];
  initialSessions: AgentSessionListItem[];
  selectedSessionId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // A message left unsent by a reconnect reload or a "continue in a new
  // conversation" — both are full page loads, so this initialiser runs fresh.
  const [composer, setComposer] = useState(() => readDraft(selectedSessionId));
  const [sendError, setSendError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [annotations, setAnnotations] = useState<AgentAnnotation[]>([]);
  const [messageAnnotations, setMessageAnnotations] = useState<
    Record<string, AgentAnnotation[]>
  >(() => hydrateAnnotations(initialAnnotationsByTurn));
  const [pendingMessageAnnotations, setPendingMessageAnnotations] = useState<
    AgentAnnotation[] | null
  >(null);
  const [forkContext, setForkContext] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem("rc-agent-fork-context"),
  );
  const [sessions, setSessions] = useState(initialSessions);
  // An ended Eve session cannot take another turn. Its history is still the
  // app's to show, so it renders read-only instead of being mounted as live.
  const [closedAtLoad] = useState(() =>
    isTerminalSessionStatus(
      initialSessions.find(
        (session) => session.eveSessionId === selectedSessionId,
      )?.status,
    ),
  );
  const [sessionClosed, setSessionClosed] = useState(closedAtLoad);
  /** Eve accepted the message; the live stream is still being attached. */
  const [reconnecting, setReconnecting] = useState(false);
  const [stalled, setStalled] = useState(false);
  // Rails are the wide-screen panes; `sheet` is the narrow-screen drawer. Kept
  // apart so a phone never mounts a drawer just because a rail defaults open.
  // The inspector (session usage and cost) starts closed; the header toggle
  // opens it.
  const [rails, setRails] = useState({ history: true, inspector: false });
  const [sheet, setSheet] = useState<"history" | "inspector" | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessageAnnotationsRef = useRef<AgentAnnotation[] | null>(null);
  const pendingUserMessagesRef = useRef(0);
  /** The failure eve reported for the submission in flight, if any. */
  const lastAgentErrorRef = useRef<Error | null>(null);
  const activeSessionIdRef = useRef(selectedSessionId);
  const sessionPathUpdated = useRef(Boolean(selectedSessionId));
  const stickToBottomRef = useRef(true);
  const [reducer] = useState(agentTranscriptReducer);
  // Read once, when the hook builds its store. Keeping the identity stable
  // stops a re-render from discarding the projection mid-turn.
  const [hydratedEvents] = useState(
    () => initialEvents as readonly MessageStreamEvent[],
  );

  const onSessionChange = useCallback(
    (session: { sessionId: string; streamIndex: number } | undefined) => {
      if (!session) return;
      activeSessionIdRef.current = session.sessionId;
      setSessions((current) => {
        if (current.some((item) => item.eveSessionId === session.sessionId))
          return current;
        const now = new Date().toISOString();
        return [
          {
            agentName: "operations",
            createdAt: now,
            eveSessionId: session.sessionId,
            lastEventAt: now,
            status: "ACTIVE",
            summary: null,
            title: null,
            updatedAt: now,
          },
          ...current,
        ];
      });
      if (!sessionPathUpdated.current) {
        sessionPathUpdated.current = true;
        // The session is returned before its first hook write. Change only the
        // address bar so the active Eve store is not remounted into a 404.
        window.history.replaceState(
          null,
          "",
          `/agent/${encodeURIComponent(session.sessionId)}`,
        );
      }
    },
    [],
  );

  // The first message's session only moves the address bar (`replaceState`
  // above), so the router keeps this /agent page mounted, Eve store and all.
  // A link back to /agent — "New conversation", the nav, a fork — then
  // reshowed the old transcript and posted the next message into the old
  // session. Back on /agent while holding a session this page created means
  // a new conversation was asked for: start one with a full load, the same
  // way `continueInNewConversation` does. After the load the ref is empty, so
  // this cannot repeat.
  useEffect(() => {
    if (pathname !== "/agent" || selectedSessionId) return;
    if (!activeSessionIdRef.current) return;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- A fresh conversation must discard the mounted Eve store.
    window.location.assign("/agent");
  }, [pathname, selectedSessionId]);

  const agent = useEveAgent<AgentTranscriptData>({
    // Hydrated events are a prefix of this session's stream, and the cursor is
    // deliberately left at 0. The persisted copy can trail the durable stream by
    // an event or two, and claiming a cursor past that would skip whatever is
    // missing. Eve drops any event whose `meta.id` it has already applied, so
    // the overlapping catch-up costs bandwidth, not correctness.
    initialEvents: hydratedEvents,
    initialSession:
      selectedSessionId && !closedAtLoad
        ? { sessionId: selectedSessionId, streamIndex: 0 }
        : undefined,
    onEvent: (event) => {
      setStalled(false);
      setReconnecting(false);
      // A specialist wake-up is not a message this operator sent, so it must
      // not claim the annotations waiting for their own next message.
      if (event.type !== "message.received" || isTaskNotification(event))
        return;
      const isOwnMessage = pendingUserMessagesRef.current > 0;
      if (isOwnMessage) pendingUserMessagesRef.current -= 1;
      const pending = pendingMessageAnnotationsRef.current;
      if (!isOwnMessage || pending === null) return;
      setMessageAnnotations((current) => ({
        ...current,
        [`${event.data.turnId}:user`]: pending,
      }));
      void persistTurnAnnotations(
        activeSessionIdRef.current,
        event.data.turnId,
        pending,
      ).catch(() =>
        setSendError(
          "The message was sent, but its references could not be saved.",
        ),
      );
      pendingMessageAnnotationsRef.current = null;
      setPendingMessageAnnotations(null);
    },
    onError: (error) => {
      lastAgentErrorRef.current = error;
    },
    onSessionChange,
    prepareSend: (payload) => ({
      ...payload,
      clientContext: {
        ...(payload.clientContext
        && typeof payload.clientContext === "object"
        && !Array.isArray(payload.clientContext)
          ? payload.clientContext
          : {}),
        route: window.location.pathname,
      },
    }),
    reducer,
    resume: Boolean(selectedSessionId) && !closedAtLoad,
  });

  const busy =
    agent.status === "resuming"
    || agent.status === "submitted"
    || agent.status === "streaming";
  const canSend =
    !busy
    && !uploading
    && !sessionClosed
    && (composer.trim().length > 0 || attachments.length > 0);
  const pendingApprovalCount = agent.data.pendingApprovals.length;

  // Read once by the initialiser above; cleared here so a later visit does not
  // restore a message that has since been sent. This is the only place a draft
  // is cleared: one is written only when this conversation is left, and comes
  // back through here before anything can be sent. Clearing it again once a
  // send settles — which can take minutes — would delete a draft typed and
  // saved by leaving while that send was still running.
  useEffect(() => {
    sessionStorage.removeItem(draftStorageKey(selectedSessionId));
  }, [selectedSessionId]);

  // Eve's transport retries a dropped stream on its own, so a turn that goes
  // quiet for long enough has lost its connection for good. `resume()` refuses
  // while the hook still thinks it is streaming and `cancel()` would stop the
  // real turn, so the way back is the reload the operator would otherwise
  // reach for by hand — offered, not forced.
  const eventCount = agent.events.length;
  const eventCountRef = useRef(eventCount);
  useEffect(() => {
    eventCountRef.current = eventCount;
  }, [eventCount]);
  useEffect(() => {
    if (!busy) return;
    let seen = eventCountRef.current;
    let quietSince = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (eventCountRef.current !== seen) {
        seen = eventCountRef.current;
        quietSince = now;
      }
      setStalled(
        isStalledTurn({
          busy: true,
          lastEventAt: quietSince,
          now,
          pendingApprovals: pendingApprovalCount,
        }),
      );
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [busy, pendingApprovalCount]);

  function reloadConversation() {
    const sessionId = activeSessionIdRef.current;
    if (composer.trim())
      sessionStorage.setItem(draftStorageKey(sessionId), composer);
    window.location.assign(
      sessionId ? `/agent/${encodeURIComponent(sessionId)}` : "/agent",
    );
  }

  function continueInNewConversation() {
    // A fresh session with nothing carried over: the old run's approvals and
    // in-flight work do not continue, and its transcript is not replayed as
    // an instruction. Only the unsent draft comes along, still unsent.
    if (composer.trim())
      sessionStorage.setItem(draftStorageKey(null), composer);
    // A full load, not a client push: a hidden /agent kept alive by Activity
    // can still hold an earlier conversation's live session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- A fresh conversation must discard Activity-preserved Eve state.
    window.location.assign("/agent");
  }
  const statusLabel = useMemo(
    () => (sessionClosed ? "Ended" : agentStatusLabel(agent.status)),
    [agent.status, sessionClosed],
  );
  const activeSessionId = agent.session?.sessionId ?? selectedSessionId;
  const activeSessionTitle =
    initialSessions.find((session) => session.eveSessionId === activeSessionId)
      ?.title
    ?? sessions.find((session) => session.eveSessionId === activeSessionId)
      ?.title
    ?? "New conversation";

  useEffect(() => {
    if (!activeSessionId) return;
    window.dispatchEvent(
      new CustomEvent("agent-session-title", {
        detail: {
          path: window.location.pathname,
          sessionId: activeSessionId,
          title: activeSessionTitle,
        },
      }),
    );
  }, [activeSessionId, activeSessionTitle]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() =>
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [agent.data, agent.status]);

  // The title is generated a few seconds after the first message and written
  // server-side, so the sidebar read "New conversation" until a reload (#432).
  // Once a turn settles on an untitled conversation, ask for it a few times.
  const untitledSessionId =
    activeSessionId
    && !sessions.find((session) => session.eveSessionId === activeSessionId)
      ?.title
    && !initialSessions.find(
      (session) => session.eveSessionId === activeSessionId,
    )?.title
      ? activeSessionId
      : null;
  useEffect(() => {
    if (!untitledSessionId || busy) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;
    const poll = async () => {
      attempt += 1;
      try {
        const response = await fetch(
          `/api/agent/sessions/${encodeURIComponent(untitledSessionId)}/title`,
          { cache: "no-store" },
        );
        const payload = response.ok
          ? ((await response.json()) as { title?: string | null })
          : null;
        if (cancelled) return;
        const title = payload?.title?.trim();
        if (title) {
          setSessions((current) =>
            current.map((session) =>
              session.eveSessionId === untitledSessionId
                ? { ...session, title }
                : session,
            ),
          );
          return;
        }
      } catch {
        // A missing title is cosmetic; the next settled turn asks again.
      }
      if (!cancelled && attempt < 4)
        timer = window.setTimeout(() => void poll(), 2_500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [busy, untitledSessionId]);

  async function sendMessage(message: string) {
    const text = message.trim() || "Please review the attached file(s).";
    if (
      (!message.trim() && attachments.length === 0)
      || busy
      || uploading
      || sessionClosed
    )
      return;
    const sessionBefore = activeSessionIdRef.current;
    // The turn carries this exact snapshot. Uploading a 10MB attachment takes
    // long enough for someone to keep typing or drop another file, and clearing
    // the composer wholesale afterwards would throw that away without sending
    // it, so only what went out is removed.
    const sentAnnotations = annotations;
    const sentAttachments = attachments;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setSendError(null);
    setUploading(sentAttachments.length > 0);
    let sent = false;
    try {
      const uploaded = await Promise.all(sentAttachments.map(uploadAttachment));
      const unreachable = uploaded.filter((file) => file.agentUrl === null);
      if (unreachable.length > 0) {
        throw new Error(
          `The agent cannot read ${unreachable
            .map((file) => file.filename)
            .join(", ")}. Nothing was sent — try attaching the file again.`,
        );
      }
      const content = [
        { type: "text" as const, text },
        ...uploaded.map((file) => ({
          type: "file" as const,
          data: new URL(file.agentUrl as string),
          filename: file.filename,
          mediaType: file.fileType,
        })),
      ];
      pendingMessageAnnotationsRef.current = sentAnnotations;
      setPendingMessageAnnotations(sentAnnotations);
      pendingUserMessagesRef.current += 1;
      // `onEvent` takes this back down when eve confirms the message with
      // `message.received`; still at this value after `send` means it never
      // arrived.
      const awaitingReceipt = pendingUserMessagesRef.current;
      lastAgentErrorRef.current = null;
      // `agent.send` resolves when the whole turn settles, which includes any
      // specialist the orchestrator waits on — often a minute or more. The
      // message is already in the transcript, so the composer is cleared as
      // soon as it goes out rather than holding the sent text all that time.
      // Only what went out is removed; anything typed meanwhile stays.
      sent = true;
      setComposer((current) => (current === message ? "" : current));
      setAttachments((current) =>
        current.filter((file) => !sentAttachments.includes(file)),
      );
      setAnnotations((current) =>
        current.filter((item) => !sentAnnotations.includes(item)),
      );
      await agent.send(content, {
        clientContext: {
          route: window.location.pathname,
          forkContext,
          annotations: sentAnnotations.map(({ type, id, label }) => ({
            type,
            id,
            label,
          })),
        },
      });
      // eve's `send` records a failure in its error state and resolves rather
      // than rejecting, so a rejected promise alone misses a request that
      // never reached the agent. Confirmed receipt is the test: a message eve
      // accepted stays sent even if its turn later fails.
      if (pendingUserMessagesRef.current >= awaitingReceipt) {
        // Written by `onError` during the await, which the compiler cannot see.
        const reported = lastAgentErrorRef.current as Error | null;
        throw new Error(
          reported?.message ?? "The message did not reach the agent.",
        );
      }
      setForkContext(null);
      setEditingMessageId(null);
      sessionStorage.removeItem("rc-agent-fork-context");
    } catch (error) {
      const failure = classifySendFailure({
        // The thrown wrapper drops Eve's error code; the original is here.
        error: lastAgentErrorRef.current ?? error,
        sessionAfter: activeSessionIdRef.current,
        sessionBefore,
      });
      if (failure === "accepted") {
        // The turn is running. Leave the composer empty and the receipt
        // bookkeeping in place, so the `message.received` the reattached stream
        // replays still claims this message's annotations.
        setForkContext(null);
        setEditingMessageId(null);
        sessionStorage.removeItem("rc-agent-fork-context");
        setReconnecting(true);
        void agent
          .resume()
          .catch(() => undefined)
          .finally(() => setReconnecting(false));
        return;
      }
      if (sent) {
        // Put the unsent request back so it can be retried, unless the
        // operator has already started typing something else.
        setComposer((current) => (current === "" ? message : current));
        setAttachments((current) => [
          ...sentAttachments.filter((file) => !current.includes(file)),
          ...current,
        ]);
        setAnnotations((current) => [
          ...sentAnnotations.filter((item) => !current.includes(item)),
          ...current,
        ]);
      }
      // Undo this submission's receipt bookkeeping, so a later wake-up or
      // message is not mistaken for it.
      pendingUserMessagesRef.current = Math.max(
        0,
        pendingUserMessagesRef.current - 1,
      );
      pendingMessageAnnotationsRef.current = null;
      setPendingMessageAnnotations(null);
      if (failure === "closed") {
        // Not retried against the same id: Eve never reopens an ended session.
        // The draft is back in the composer for a new conversation.
        setSessionClosed(true);
        setSessions((current) =>
          current.map((item) =>
            item.eveSessionId === sessionBefore
              ? { ...item, status: "COMPLETED" }
              : item,
          ),
        );
        return;
      }
      setSendError(
        error instanceof Error
          ? error.message
          : "The message could not be sent.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function persistTurnAnnotations(
    sessionId: string | null,
    turnId: string,
    turnAnnotations: readonly AgentAnnotation[],
  ) {
    if (!sessionId || turnAnnotations.length === 0) return;
    const response = await fetch(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/context`,
      {
        body: JSON.stringify({ annotations: turnAnnotations, turnId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) throw new Error("Annotation persistence failed");
  }

  async function respond(responses: readonly AgentInputResponse[]) {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    await agent.respond(responses);
  }

  async function runAction(action: AgentResultAction) {
    await sendMessage(
      `Please execute the approved UI action "${action.label}" (${action.operation}, action id ${action.id}) after I review the prepared details.`,
    );
  }

  function forkConversation() {
    const transcript = agent.data.messages
      .flatMap((message) =>
        message.parts
          .filter((part) => part.type === "text")
          .map((part) => `${message.role}: ${part.text}`),
      )
      .join("\n")
      .slice(-12_000);
    sessionStorage.setItem("rc-agent-fork-context", transcript);
    router.push("/agent");
  }

  function editMessage(messageId: string, text: string) {
    setEditingMessageId(messageId);
    setComposer(text);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleMessageScroll(event: React.UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    const atBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48;
    if (stickToBottomRef.current === atBottom) return;
    stickToBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  }

  function scrollToBottom() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }

  async function archiveSession(sessionId: string) {
    setArchiveError(null);
    try {
      const response = await fetch(`/api/agent/sessions/${sessionId}/archive`, {
        method: "POST",
      });
      if (!response.ok)
        throw new Error("The conversation could not be archived.");
      setSessions((items) =>
        items.filter((item) => item.eveSessionId !== sessionId),
      );
    } catch (error) {
      setArchiveError(
        error instanceof Error
          ? error.message
          : "The conversation could not be archived.",
      );
    }
  }

  const wideEnoughForHistory = useMediaQuery("(min-width: 768px)");
  const wideEnoughForInspector = useMediaQuery("(min-width: 1280px)");
  const historyRailOpen = wideEnoughForHistory && rails.history;
  const inspectorRailOpen = wideEnoughForInspector && rails.inspector;

  function togglePane(pane: "history" | "inspector") {
    const docked =
      pane === "history" ? wideEnoughForHistory : wideEnoughForInspector;
    if (docked) setRails((current) => ({ ...current, [pane]: !current[pane] }));
    else setSheet((current) => (current === pane ? null : pane));
  }

  const renderHistory = (onClose?: () => void) => (
    <AgentHistory
      activeSessionId={activeSessionId}
      activeSessionTitle={activeSessionTitle}
      initialSessions={initialSessions}
      onArchive={archiveSession}
      onClose={onClose}
      onNavigate={() => {
        // Moving to another conversation from the rail must not lose what was
        // typed here; the initialiser restores it on the way back.
        if (composer.trim())
          sessionStorage.setItem(draftStorageKey(activeSessionId), composer);
        setSheet(null);
      }}
      sessions={sessions}
    />
  );

  const inspector = (
    <AgentInspector
      data={agent.data}
      onClose={() =>
        wideEnoughForInspector
          ? setRails((current) => ({ ...current, inspector: false }))
          : setSheet(null)
      }
      viewportRef={viewportRef}
    />
  );

  return (
    // The header meter, tool cards and approval controls use Radix tooltips,
    // which throw without a provider above them; the app shell only provides
    // one around its notifications.
    <TooltipProvider>
      <section className="flex h-full max-h-full min-h-full w-full flex-col overflow-hidden bg-white sm:rounded-xl sm:border sm:border-border/70 sm:shadow-sm">
        <AgentHeader
          agentStatus={agent.status}
          busy={busy}
          canFork={agent.data.messages.length > 0}
          historyOpen={historyRailOpen || sheet === "history"}
          inspectorOpen={inspectorRailOpen || sheet === "inspector"}
          onCancel={() => void agent.cancel()}
          onFork={forkConversation}
          onToggleHistory={() => togglePane("history")}
          onToggleInspector={() => togglePane("inspector")}
          pendingCount={agent.data.pendingApprovals.length}
          sessionTitle={activeSessionTitle}
          statusLabel={statusLabel}
          usage={agent.data.usage}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          {historyRailOpen ? (
            <div className="w-72 shrink-0 border-r border-border/70">
              {renderHistory()}
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AgentTranscript
              // An ended session and a stream still attaching each get their
              // own notice; a generic "could not continue" would contradict it.
              agentError={
                sessionClosed || reconnecting ? null : (agent.error ?? null)
              }
              agentStatus={agent.status}
              archiveError={archiveError}
              busy={busy}
              connection={{
                onContinue: continueInNewConversation,
                onReload: reloadConversation,
                reconnecting,
                sessionClosed,
                stalled: stalled && busy,
              }}
              data={agent.data}
              handleMessageScroll={handleMessageScroll}
              messageAnnotations={messageAnnotations}
              onAction={runAction}
              onEditMessage={editMessage}
              onRespond={respond}
              onRetry={() => void agent.resume()}
              onSuggestion={(suggestion) => void sendMessage(suggestion)}
              pendingMessageAnnotations={pendingMessageAnnotations}
              scrollToBottom={scrollToBottom}
              sendError={sendError}
              // The inspector already shows what is waiting, so the floating bar
              // is only needed when the inspector is not on screen.
              showApprovalBar={!inspectorRailOpen}
              showScrollToBottom={showScrollToBottom}
              viewportRef={viewportRef}
            />
            <AgentComposer
              annotations={annotations}
              attachments={attachments}
              canSend={canSend}
              composer={composer}
              composerRef={composerRef}
              disabled={agent.status === "resuming" || sessionClosed}
              editingMessageId={editingMessageId}
              onCancelEdit={() => {
                setEditingMessageId(null);
                setComposer("");
              }}
              onChange={setComposer}
              onSend={() => void sendMessage(composer)}
              setAnnotations={setAnnotations}
              setAttachments={setAttachments}
              uploading={uploading}
            />
          </div>

          {inspectorRailOpen ? (
            <div className="w-80 shrink-0">{inspector}</div>
          ) : null}
        </div>

        <Sheet
          onOpenChange={(open) => setSheet(open ? "history" : null)}
          open={sheet === "history"}
        >
          <SheetContent
            className="w-76 max-w-[calc(100vw-3rem)] p-0"
            showCloseButton={false}
            side="left"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>
                Switch between your agent conversations.
              </SheetDescription>
            </SheetHeader>
            {renderHistory(() => setSheet(null))}
          </SheetContent>
        </Sheet>

        <Sheet
          onOpenChange={(open) => setSheet(open ? "inspector" : null)}
          open={sheet === "inspector"}
        >
          {/* The inspector carries its own close control. */}
          <SheetContent
            className="w-84 max-w-[calc(100vw-3rem)] p-0"
            showCloseButton={false}
            side="right"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>This session</SheetTitle>
              <SheetDescription>
                What the agent needs from you, what it has delegated, and what
                it has spent.
              </SheetDescription>
            </SheetHeader>
            {inspector}
          </SheetContent>
        </Sheet>
      </section>
    </TooltipProvider>
  );
}

async function uploadAttachment(file: File): Promise<AgentUploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/agent/upload", {
    body: form,
    method: "POST",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Could not upload ${file.name}.`);
  }
  return ((await response.json()) as { file: AgentUploadedFile }).file;
}

/** Annotations persisted per turn render straight away on a reload. */
function hydrateAnnotations(
  byTurn: AgentWorkspaceData["selectedAnnotationsByTurn"],
) {
  return Object.fromEntries(
    Object.entries(byTurn).map(([turnId, turnAnnotations]) => [
      `${turnId}:user`,
      turnAnnotations,
    ]),
  );
}

function agentStatusLabel(status: ReturnType<typeof useEveAgent>["status"]) {
  const labels = {
    error: "Needs attention",
    ready: "Ready",
    resuming: "Restoring",
    streaming: "Working",
    submitted: "Starting",
  } as const;
  return labels[status];
}

function readDraft(sessionId: string | null): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(draftStorageKey(sessionId)) ?? "";
}
