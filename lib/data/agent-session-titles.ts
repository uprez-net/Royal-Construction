import prisma from "@/lib/prisma";

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
  await prisma.agentSession.updateMany({
    where: { eveSessionId, ownerUserId, title: null },
    data: { title },
  });
}
