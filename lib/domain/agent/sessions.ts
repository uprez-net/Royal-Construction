import type { DomainDb } from "../db";
import { requireUserPrincipal, type DomainPrincipal } from "../principal";

const SESSION_REGISTRY_RETRY_DELAYS_MS = [
  40, 100, 200, 400, 800, 1_200,
] as const;

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

/** Read only the current user's root, non-archived Eve sessions. */
export async function getAgentWorkspaceData(
  principal: DomainPrincipal,
  selectedSessionId: string | undefined,
  db: DomainDb,
): Promise<AgentWorkspaceData> {
  const actor = requireUserPrincipal(principal);
  const selectedSessionRegistered =
    selectedSessionId === undefined
      ? true
      : await waitForOwnedSession(actor.userId, selectedSessionId, db);

  const rows = await db.agentSession.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      agentName: true,
      createdAt: true,
      eveSessionId: true,
      lastEventAt: true,
      selectedContext: true,
      status: true,
      summary: true,
      title: true,
      updatedAt: true,
    },
    take: 50,
    where: {
      archivedAt: null,
      ownerUserId: actor.userId,
      parentEveSessionId: null,
    },
  });

  const sessions = rows.map((row) => ({
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
    selectedSessionUnavailable:
      selectedSessionId !== undefined && !ownsSelectedSession,
    sessions,
  };
}

async function waitForOwnedSession(
  ownerUserId: string,
  eveSessionId: string,
  db: DomainDb,
): Promise<boolean> {
  for (
    let attempt = 0;
    attempt <= SESSION_REGISTRY_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const session = await db.agentSession.findFirst({
      select: { eveSessionId: true },
      where: {
        archivedAt: null,
        eveSessionId,
        ownerUserId,
        parentEveSessionId: null,
      },
    });
    if (session) return true;
    const delay = SESSION_REGISTRY_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return false;
}
