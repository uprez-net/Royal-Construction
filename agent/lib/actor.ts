import type { SessionContext } from "eve/context";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export class AgentAuthorizationError extends Error {
  readonly code = "agent_access_denied";

  constructor() {
    super("You do not have access to that agent resource.");
    this.name = "AgentAuthorizationError";
  }
}

export async function requireCurrentAgentActor(
  ctx: SessionContext,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const caller = ctx.session.auth.current;
  if (caller?.principalType !== "user") {
    throw new AgentAuthorizationError();
  }

  const user = await db.user.findUnique({
    where: { id: caller.principalId },
  });

  if (!user) throw new AgentAuthorizationError();
  return user;
}
