import type { SessionContext } from "eve/context";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { findUserById } from "@/lib/domain/identity/users";

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

  // lib/domain/identity/users.ts owns the lookup, so Eve and the app resolve
  // an application user the same way.
  const user = await findUserById(caller.principalId, db);

  if (!user) throw new AgentAuthorizationError();
  return user;
}
