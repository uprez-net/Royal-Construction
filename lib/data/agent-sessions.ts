import "server-only";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import {
  getAgentSessionTitle,
  setAgentSessionTitleIfMissing,
} from "@/lib/data/agent-session-titles";

export { getAgentSessionTitle, setAgentSessionTitleIfMissing };

const SESSION_REGISTRY_RETRY_DELAYS_MS = [
  40, 100, 200, 400, 800, 1_200,
] as const;

async function waitForOwnedSession(ownerUserId: string, eveSessionId: string) {
  for (
    let attempt = 0;
    attempt <= SESSION_REGISTRY_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const session = await prisma.agentSession.findFirst({
      where: {
        eveSessionId,
        ownerUserId,
        parentEveSessionId: null,
        archivedAt: null,
      },
      select: { eveSessionId: true },
    });
    if (session) return true;
    const delay = SESSION_REGISTRY_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined)
      await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}

export type AgentSessionListItem = {
  agentName: string;
  createdAt: string;
  eveSessionId: string;
  lastEventAt: string | null;
  status: "ACTIVE" | "WAITING" | "ARCHIVED" | "COMPLETED" | "FAILED";
  summary: string | null;
  title: string | null;
  updatedAt: string;
};

export type AgentWorkspaceData = {
  selectedAnnotationsByTurn: Record<
    string,
    Array<{
      type: string;
      id: string;
      label: string;
      href: string;
      group: string;
    }>
  >;
  selectedSessionId: string | null;
  selectedSessionUnavailable: boolean;
  sessions: AgentSessionListItem[];
};

export async function getAgentWorkspaceData(
  selectedSessionId?: string,
): Promise<AgentWorkspaceData> {
  const { userId } = await auth();
  if (!userId)
    return {
      selectedAnnotationsByTurn: {},
      selectedSessionId: null,
      selectedSessionUnavailable: selectedSessionId !== undefined,
      sessions: [],
    };

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!user)
    return {
      selectedAnnotationsByTurn: {},
      selectedSessionId: null,
      selectedSessionUnavailable: selectedSessionId !== undefined,
      sessions: [],
    };

  // A new Eve session is registered by the event hook immediately after the
  // first stream starts. The browser can navigate to its durable URL a few
  // milliseconds earlier, so wait for that registry write before declaring a
  // session unavailable. This keeps a normal first turn from becoming a
  // misleading 404/auth failure while still rejecting unknown sessions.
  const selectedSessionRegistered =
    selectedSessionId === undefined
      ? true
      : await waitForOwnedSession(user.id, selectedSessionId);

  const rows = await prisma.agentSession.findMany({
    where: {
      archivedAt: null,
      ownerUserId: user.id,
      parentEveSessionId: null,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      agentName: true,
      createdAt: true,
      eveSessionId: true,
      lastEventAt: true,
      status: true,
      summary: true,
      title: true,
      updatedAt: true,
      selectedContext: true,
    },
  });

  const sessions: AgentSessionListItem[] = rows.map((row) => ({
    agentName: row.agentName,
    createdAt: row.createdAt.toISOString(),
    eveSessionId: row.eveSessionId,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const ownsSelectedSession =
    selectedSessionId === undefined ||
    (selectedSessionRegistered &&
      sessions.some((session) => session.eveSessionId === selectedSessionId));

  const selectedContext = rows.find(
    (row) => row.eveSessionId === selectedSessionId,
  )?.selectedContext;
  const contextObject =
    selectedContext &&
    typeof selectedContext === "object" &&
    !Array.isArray(selectedContext)
      ? selectedContext
      : null;
  const annotationsByTurn =
    contextObject &&
    typeof contextObject.annotationsByTurn === "object" &&
    contextObject.annotationsByTurn !== null &&
    !Array.isArray(contextObject.annotationsByTurn)
      ? contextObject.annotationsByTurn
      : {};

  return {
    selectedAnnotationsByTurn:
      annotationsByTurn as AgentWorkspaceData["selectedAnnotationsByTurn"],
    selectedSessionId:
      selectedSessionId !== undefined && ownsSelectedSession
        ? selectedSessionId
        : null,
    sessions,
    selectedSessionUnavailable:
      selectedSessionId !== undefined && !ownsSelectedSession,
  };
}
