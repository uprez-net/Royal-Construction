import "server-only";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import {
  getAgentSessionEvents as getAgentSessionEventsDomain,
  getAgentWorkspaceData as getAgentWorkspaceDataDomain,
} from "@/lib/domain/agent/sessions";
import { principalForClerkId } from "@/lib/domain/identity/users";
import {
  getAgentSessionTitle,
  setAgentSessionTitleIfMissing,
} from "@/lib/data/agent-session-titles";

export { getAgentSessionTitle, setAgentSessionTitleIfMissing };
export type {
  AgentSessionListItem,
  AgentWorkspaceData,
} from "@/lib/domain/agent/sessions";

const emptyWorkspace = (selectedSessionId: string | undefined) => ({
  selectedAnnotationsByTurn: {},
  selectedSessionId: null,
  selectedSessionUnavailable: selectedSessionId !== undefined,
  sessions: [],
});

/** Next adapter: resolve Clerk identity, then use the owner-scoped domain read. */
export async function getAgentWorkspaceData(selectedSessionId?: string) {
  const { userId } = await auth();
  if (!userId) return emptyWorkspace(selectedSessionId);

  const principal = await principalForClerkId(userId, prisma);
  if (!principal) return emptyWorkspace(selectedSessionId);

  return getAgentWorkspaceDataDomain(principal, selectedSessionId, prisma);
}

/** Next adapter: the persisted Eve stream prefix for one owned session. */
export async function getAgentSessionEvents(eveSessionId: string) {
  const { userId } = await auth();
  if (!userId) return [];

  const principal = await principalForClerkId(userId, prisma);
  if (!principal) return [];

  return getAgentSessionEventsDomain(principal, eveSessionId, prisma);
}
