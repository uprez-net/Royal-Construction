import { AgentSessionStatus, Prisma } from "@prisma/client";
import type { HookContext, HookEvent } from "eve/hooks";
import type { ConversationTitleGenerator } from "@/agent/lib/session-title";
import prisma from "@/lib/prisma";
import {
  getAgentSessionTitle,
  setAgentSessionTitleIfMissing,
} from "@/lib/data/agent-sessions";

const EVENT_SESSION_STATUS: Partial<Record<HookEvent["type"], AgentSessionStatus>> = {
  "session.started": AgentSessionStatus.ACTIVE,
  "session.waiting": AgentSessionStatus.WAITING,
  "session.completed": AgentSessionStatus.COMPLETED,
  "session.failed": AgentSessionStatus.FAILED,
  "turn.started": AgentSessionStatus.ACTIVE,
};

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function createAgentEventPersister(
  generateConversationTitle: ConversationTitleGenerator,
) {
  return async function persistAgentEvent(event: HookEvent, ctx: HookContext) {
    const owner = ctx.session.auth.initiator;
    if (owner?.principalType !== "user") return;

    const occurredAt = new Date(event.meta.at);
    const status = EVENT_SESSION_STATUS[event.type];
    const isRootSession = ctx.session.parent == null;
    const shouldGenerateTitle =
      isRootSession &&
      event.type === "message.received" &&
      (await getAgentSessionTitle(ctx.session.id)) === null;

    await prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.upsert({
        where: { eveSessionId: ctx.session.id },
        create: {
          eveSessionId: ctx.session.id,
          ownerUserId: owner.principalId,
          agentName: ctx.agent.name,
          parentEveSessionId: ctx.session.parent?.sessionId,
          rootEveSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
          lastEventAt: occurredAt,
          status: status ?? AgentSessionStatus.ACTIVE,
        },
        update: { agentName: ctx.agent.name },
        select: { id: true, ownerUserId: true },
      });

      if (session.ownerUserId !== owner.principalId) {
        throw new Error("Agent session owner mismatch while persisting an Eve event.");
      }

      const inserted = await tx.agentSessionEvent.createMany({
        data: {
          agentSessionId: session.id,
          eveEventId: event.meta.id,
          eventType: event.type,
          payload: toInputJson(event),
          occurredAt,
        },
        skipDuplicates: true,
      });

      if (inserted.count > 0) {
        await tx.agentSession.updateMany({
          where: {
            id: session.id,
            OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurredAt } }],
          },
          data: {
            lastEventAt: occurredAt,
            ...(status ? { status } : {}),
          },
        });
      }
    });

    if (shouldGenerateTitle && event.type === "message.received") {
      void generateConversationTitle(event.data.message)
        .then(async (title) => {
          if (title) {
            await setAgentSessionTitleIfMissing(
              ctx.session.id,
              owner.principalId,
              title,
            );
          }
        })
        .catch((error) => {
          console.error("Conversation title persistence failed", error);
        });
    }
  };
}
