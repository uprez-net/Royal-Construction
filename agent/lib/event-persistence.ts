import { AgentSessionStatus, Prisma } from "@prisma/client";
import type { HookContext, HookEvent } from "eve/hooks";
import type { ConversationTitleGenerator } from "@/agent/lib/session-title";
import prisma from "@/lib/prisma";
import {
  getAgentSessionTitle,
  setAgentSessionTitleIfMissing,
} from "@/lib/data/agent-session-titles";

const EVENT_SESSION_STATUS: Partial<
  Record<HookEvent["type"], AgentSessionStatus>
> = {
  "session.started": AgentSessionStatus.ACTIVE,
  "session.waiting": AgentSessionStatus.WAITING,
  "session.completed": AgentSessionStatus.COMPLETED,
  "session.failed": AgentSessionStatus.FAILED,
  "turn.started": AgentSessionStatus.ACTIVE,
};

/**
 * Streaming deltas: the bulk of a turn's events, and redundant with the
 * `*.completed` / `actions.requested` / `action.result` event that closes each
 * of them.
 *
 * eve runs hooks inside the one serial pump that also writes each event to the
 * client's stream, and it awaits them. A database round trip per delta is
 * therefore a round trip between every chunk of text the office sees. These
 * are buffered and written in the background instead (#429).
 */
const STREAMING_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message.appended",
  "reasoning.appended",
  "action.input.appended",
  "action.partial",
]);

/** Write buffered deltas after this long, even with no boundary in sight. */
const BACKGROUND_FLUSH_DELAY_MS = 750;
/** …or as soon as this many are waiting. */
const BACKGROUND_FLUSH_BATCH = 100;

type PendingEvent = {
  eveEventId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  occurredAt: Date;
  status: AgentSessionStatus | undefined;
};

type SessionIdentity = {
  eveSessionId: string;
  ownerUserId: string;
  agentName: string;
  parentEveSessionId: string | undefined;
  rootEveSessionId: string;
};

type SessionBuffer = {
  identity: SessionIdentity;
  pending: PendingEvent[];
  /** Every write for this session, in order. */
  chain: Promise<void>;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type AgentEventStore = {
  writeBatch(identity: SessionIdentity, batch: PendingEvent[]): Promise<void>;
};

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * One transaction per batch: register the session (or confirm its owner),
 * insert the events, move `lastEventAt`/`status` forward.
 *
 * The owner check is unchanged from the per-event version: a session row with
 * a different owner throws, and because every boundary event waits for its
 * batch, that still fails the turn.
 */
export const prismaAgentEventStore: AgentEventStore = {
  async writeBatch(identity, batch) {
    if (batch.length === 0) return;
    const first = batch[0]!;
    let latest = first.occurredAt;
    let status: AgentSessionStatus | undefined;
    for (const event of batch) {
      if (event.occurredAt > latest) latest = event.occurredAt;
      if (event.status) status = event.status;
    }

    await prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.upsert({
        where: { eveSessionId: identity.eveSessionId },
        create: {
          eveSessionId: identity.eveSessionId,
          ownerUserId: identity.ownerUserId,
          agentName: identity.agentName,
          parentEveSessionId: identity.parentEveSessionId,
          rootEveSessionId: identity.rootEveSessionId,
          lastEventAt: first.occurredAt,
          status: first.status ?? AgentSessionStatus.ACTIVE,
        },
        update: { agentName: identity.agentName },
        select: { id: true, ownerUserId: true },
      });

      if (session.ownerUserId !== identity.ownerUserId) {
        throw new Error(
          "Agent session owner mismatch while persisting an Eve event.",
        );
      }

      const inserted = await tx.agentSessionEvent.createMany({
        data: batch.map((event) => ({
          agentSessionId: session.id,
          eveEventId: event.eveEventId,
          eventType: event.eventType,
          payload: event.payload,
          occurredAt: event.occurredAt,
        })),
        skipDuplicates: true,
      });

      if (inserted.count > 0) {
        await tx.agentSession.updateMany({
          where: {
            id: session.id,
            OR: [{ lastEventAt: null }, { lastEventAt: { lt: latest } }],
          },
          data: {
            lastEventAt: latest,
            ...(status ? { status } : {}),
          },
        });
      }
    });
  },
};

/**
 * Mirrors eve's stream into `AgentSessionEvent` without holding the stream up.
 *
 * - A streaming delta is queued and the hook returns at once. Queued deltas
 *   are written in the background, in order, a batch at a time.
 * - Any other event (a step, tool call, approval, turn or session boundary)
 *   waits for one write that carries everything queued before it plus itself.
 *   So the table is never further behind than the last delta, every boundary
 *   is durable before eve moves on, and the session-ownership row a stream
 *   request waits for (agent/lib/session-owner.ts) is written by the session's
 *   first event exactly as before.
 * - A background write that fails keeps its events queued; the next boundary
 *   retries them and, if it fails too, throws as the per-event write did.
 *
 * eve calls a session's hooks one event at a time, so a session's buffer is
 * never touched by two calls at once; the write chain keeps background and
 * boundary writes from overtaking each other.
 */
export function createAgentEventPersister(
  generateConversationTitle: ConversationTitleGenerator,
  store: AgentEventStore = prismaAgentEventStore,
) {
  const buffers = new Map<string, SessionBuffer>();

  function bufferFor(identity: SessionIdentity): SessionBuffer {
    let buffer = buffers.get(identity.eveSessionId);
    if (!buffer) {
      buffer = {
        identity,
        pending: [],
        chain: Promise.resolve(),
        timer: undefined,
      };
      buffers.set(identity.eveSessionId, buffer);
    }
    buffer.identity = identity;
    return buffer;
  }

  /** Queue a write of whatever is pending when the write actually starts. */
  function flush(buffer: SessionBuffer): Promise<void> {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = undefined;
    }
    const write = buffer.chain.then(async () => {
      const batch = buffer.pending.splice(0);
      if (batch.length === 0) return;
      try {
        await store.writeBatch(buffer.identity, batch);
      } catch (error) {
        // Back to the front of the queue, so the next write retries them in
        // order rather than leaving a gap the hydrated prefix would stop at.
        buffer.pending.unshift(...batch);
        throw error;
      }
    });
    // The chain itself never rejects, so one failed write cannot wedge every
    // later one; the caller decides whether this write's failure matters.
    buffer.chain = write.catch(() => undefined);
    return write;
  }

  function flushInBackground(buffer: SessionBuffer) {
    void flush(buffer).catch((error) => {
      console.error(
        "[agent-events] background write failed; retrying at the next boundary",
        error instanceof Error ? error.message : error,
      );
    });
  }

  function release(buffer: SessionBuffer) {
    if (buffer.pending.length === 0 && !buffer.timer) {
      buffers.delete(buffer.identity.eveSessionId);
    }
  }

  return async function persistAgentEvent(event: HookEvent, ctx: HookContext) {
    const owner = ctx.session.auth.initiator;
    if (owner?.principalType !== "user") return;

    const buffer = bufferFor({
      eveSessionId: ctx.session.id,
      ownerUserId: owner.principalId,
      agentName: ctx.agent.name,
      parentEveSessionId: ctx.session.parent?.sessionId,
      rootEveSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
    });
    buffer.pending.push({
      eveEventId: event.meta.id,
      eventType: event.type,
      payload: toInputJson(event),
      occurredAt: new Date(event.meta.at),
      status: EVENT_SESSION_STATUS[event.type],
    });

    if (STREAMING_EVENT_TYPES.has(event.type)) {
      if (buffer.pending.length >= BACKGROUND_FLUSH_BATCH) {
        flushInBackground(buffer);
      } else if (!buffer.timer) {
        buffer.timer = setTimeout(() => {
          buffer.timer = undefined;
          flushInBackground(buffer);
        }, BACKGROUND_FLUSH_DELAY_MS);
        buffer.timer.unref?.();
      }
      return;
    }

    const isRootSession = ctx.session.parent == null;
    const shouldGenerateTitle =
      isRootSession
      && event.type === "message.received"
      && (await getAgentSessionTitle(ctx.session.id)) === null;

    await flush(buffer);
    release(buffer);

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
