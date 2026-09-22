"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEveAgent } from "eve/react";
import type { MessageStreamEvent } from "eve/client";
import type { AgentInputResponse } from "@/components/agent/agent-approval";
import { AgentComposer } from "@/components/agent/agent-composer";
import { AgentHeader } from "@/components/agent/agent-header";
import { AgentHistory } from "@/components/agent/agent-history";
import { AgentInspector } from "@/components/agent/agent-inspector";
import type { AgentAnnotation } from "@/components/agent/agent-mentions";
import {
  agentTranscriptReducer,
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
  const [composer, setComposer] = useState("");
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
  // Rails are the wide-screen panes; `sheet` is the narrow-screen drawer. Kept
  // apart so a phone never mounts a drawer just because a rail defaults open.
  const [rails, setRails] = useState({ history: true, inspector: true });
  const [sheet, setSheet] = useState<"history" | "inspector" | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessageAnnotationsRef = useRef<AgentAnnotation[] | null>(null);
  const pendingUserMessagesRef = useRef(0);
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

  const agent = useEveAgent<AgentTranscriptData>({
    // Hydrated events are a prefix of this session's stream, and the cursor is
    // deliberately left at 0. The persisted copy can trail the durable stream by
    // an event or two, and claiming a cursor past that would skip whatever is
    // missing. Eve drops any event whose `meta.id` it has already applied, so
    // the overlapping catch-up costs bandwidth, not correctness.
    initialEvents: hydratedEvents,
    initialSession: selectedSessionId
      ? { sessionId: selectedSessionId, streamIndex: 0 }
      : undefined,
    onEvent: (event) => {
      if (event.type !== "message.received") return;
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
    resume: Boolean(selectedSessionId),
  });

  const busy =
    agent.status === "resuming"
    || agent.status === "submitted"
    || agent.status === "streaming";
  const canSend =
    !busy
    && !uploading
    && (composer.trim().length > 0 || attachments.length > 0);
  const statusLabel = useMemo(
    () => agentStatusLabel(agent.status),
    [agent.status],
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

  async function sendMessage(message: string) {
    const text = message.trim() || "Please review the attached file(s).";
    if ((!message.trim() && attachments.length === 0) || busy || uploading)
      return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setSendError(null);
    setUploading(attachments.length > 0);
    try {
      const uploaded = await Promise.all(attachments.map(uploadAttachment));
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
      pendingMessageAnnotationsRef.current = annotations;
      setPendingMessageAnnotations(annotations);
      pendingUserMessagesRef.current += 1;
      await agent.send(content, {
        clientContext: {
          route: window.location.pathname,
          forkContext,
          annotations: annotations.map(({ type, id, label }) => ({
            type,
            id,
            label,
          })),
        },
      });
      setComposer("");
      setAttachments([]);
      setAnnotations([]);
      setForkContext(null);
      setEditingMessageId(null);
      sessionStorage.removeItem("rc-agent-fork-context");
    } catch (error) {
      pendingUserMessagesRef.current = Math.max(
        0,
        pendingUserMessagesRef.current - 1,
      );
      pendingMessageAnnotationsRef.current = null;
      setPendingMessageAnnotations(null);
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

  const history = (
    <AgentHistory
      activeSessionId={activeSessionId}
      activeSessionTitle={activeSessionTitle}
      initialSessions={initialSessions}
      onArchive={archiveSession}
      onNavigate={() => setSheet(null)}
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
    <section className="flex h-full max-h-full min-h-full w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm">
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
            {history}
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AgentTranscript
            agentError={agent.error ?? null}
            agentStatus={agent.status}
            archiveError={archiveError}
            busy={busy}
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
            disabled={agent.status === "resuming"}
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
        <SheetContent className="w-76 p-0" side="left">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
            <SheetDescription>
              Switch between your agent conversations.
            </SheetDescription>
          </SheetHeader>
          {history}
        </SheetContent>
      </Sheet>

      <Sheet
        onOpenChange={(open) => setSheet(open ? "inspector" : null)}
        open={sheet === "inspector"}
      >
        <SheetContent className="w-84 p-0" side="right">
          <SheetHeader className="sr-only">
            <SheetTitle>This session</SheetTitle>
            <SheetDescription>
              What the agent needs from you, what it has delegated, and what it
              has spent.
            </SheetDescription>
          </SheetHeader>
          {inspector}
        </SheetContent>
      </Sheet>
    </section>
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
