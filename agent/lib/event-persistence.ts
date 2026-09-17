import { AgentSessionStatus, Prisma } from "@prisma/client";
import type { HookContext, HookEvent } from "eve/hooks";
import { generateConversationTitle } from "@/agent/lib/session-title";
import prisma from "@/lib/prisma";

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

export async function persistAgentEvent(event: HookEvent, ctx: HookContext) {
  const owner = ctx.session.auth.initiator;
  if (owner?.principalType !== "user") return;

  const occurredAt = new Date(event.meta.at);
  const status = EVENT_SESSION_STATUS[event.type];
  const isRootSession = ctx.session.parent == null;
  const existingSession = isRootSession && event.type === "message.received"
    ? await prisma.agentSession.findUnique({
        where: { eveSessionId: ctx.session.id },
        select: { title: true },
      })
    : null;
  const title = isRootSession && event.type === "message.received" && existingSession?.title == null
    ? await generateConversationTitle(event.data.message)
    : undefined;

  await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.upsert({
      where: { eveSessionId: ctx.session.id },
      create: {
        eveSessionId: ctx.session.id,
        ownerUserId: owner.principalId,
        agentName: ctx.agent.name,
        parentEveSessionId: ctx.session.parent?.sessionId,
        rootEveSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
        title,
        lastEventAt: occurredAt,
        status: status ?? AgentSessionStatus.ACTIVE,
      },
      update: {
        agentName: ctx.agent.name,
        lastEventAt: occurredAt,
        ...(status ? { status } : {}),
      },
      select: { id: true, ownerUserId: true },
    });

    if (title) {
      await tx.agentSession.updateMany({
        where: { id: session.id, title: null },
        data: { title },
      });
    }

    if (session.ownerUserId !== owner.principalId) {
      throw new Error("Agent session owner mismatch while persisting an Eve event.");
    }

    await tx.agentSessionEvent.upsert({
      where: {
        agentSessionId_eveEventId: {
          agentSessionId: session.id,
          eveEventId: event.meta.id,
        },
      },
      create: {
        agentSessionId: session.id,
        eveEventId: event.meta.id,
        eventType: event.type,
        payload: toInputJson(event),
        occurredAt,
      },
      update: {},
    });
  });
}
