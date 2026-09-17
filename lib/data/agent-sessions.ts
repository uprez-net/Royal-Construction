import "server-only";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

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

export async function getAgentWorkspaceData(selectedSessionId?: string) {
  const { userId } = await auth();
  if (!userId) return { selectedSessionId: null, sessions: [] };

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!user) return { selectedSessionId: null, sessions: [] };

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
    },
  });

  const sessions: AgentSessionListItem[] = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const ownsSelectedSession =
    selectedSessionId === undefined ||
    sessions.some((session) => session.eveSessionId === selectedSessionId);

  return {
    selectedSessionId:
      selectedSessionId !== undefined && ownsSelectedSession
        ? selectedSessionId
        : null,
    sessions,
    selectedSessionUnavailable:
      selectedSessionId !== undefined && !ownsSelectedSession,
  };
}
