import prisma from "@/lib/prisma";
import { distinctConversationTitle } from "@/lib/agent/conversation-title";

export async function getAgentSessionTitle(eveSessionId: string) {
  const session = await prisma.agentSession.findUnique({
    where: { eveSessionId },
    select: { title: true },
  });
  return session?.title ?? null;
}

export async function setAgentSessionTitleIfMissing(
  eveSessionId: string,
  ownerUserId: string,
  title: string,
) {
  // Titles this person already has that start the same way, so a repeat can
  // be told apart in the sidebar.
  const existing = await prisma.agentSession.findMany({
    select: { title: true },
    where: {
      eveSessionId: { not: eveSessionId },
      ownerUserId,
      title: { startsWith: title, mode: "insensitive" },
    },
  });
  await prisma.agentSession.updateMany({
    where: { eveSessionId, ownerUserId, title: null },
    data: {
      title: distinctConversationTitle(
        title,
        existing.flatMap((row) => (row.title ? [row.title] : [])),
        new Date(),
      ),
    },
  });
}
