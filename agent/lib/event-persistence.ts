import { AgentSessionStatus, Prisma } from "@prisma/client";
import type { HookContext, HookEvent } from "eve/hooks";
import type { ConversationTitleGenerator } from "@/agent/lib/session-title";
import prisma from "@/lib/prisma";
import { reportError } from "@/lib/observability/report-error";
import {
  FINAL_OUTPUT_DIAGNOSTIC_EVENT,
  FINAL_OUTPUT_TOOL_NAME,
  finalOutputIssues,
} from "@/agent/lib/final-output-diagnostics";
import { specialistResultSchema } from "@/agent/lib/result-contracts";
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
 * A session's status after this event.
 *
 * A specialist (child) session is created for one delegation and never sent
 * another task, so once its turn completes it is done. It used to stay WAITING
 * for ever (all 146 in production, #617), which read the same as one parked on
 * an approval. eve still emits `session.waiting` after the turn; that must not
 * move a completed child back, which the store enforces. A child parked on an
 * approval never completes its turn, so it still reads WAITING.
 */
export function sessionStatusAfter(
  eventType: string,
  isChildSession: boolean,
): AgentSessionStatus | undefined {
  if (isChildSession && eventType === "turn.completed")
    return AgentSessionStatus.COMPLETED;
  return EVENT_SESSION_STATUS[eventType as HookEvent["type"]];
}

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
  /** A specialist's streamed `final_output` arguments, by call (#619). */
  finalOutputs: Map<string, string>;
  /** Every write for this session, in order. */
  chain: Promise<void>;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type AgentEventStore = {
  writeBatch(identity: SessionIdentity, batch: PendingEvent[]): Promise<void>;
};

/**
 * Thrown when a session row already belongs to someone else. This is the one
 * write failure that must fail the turn: it is the ownership check, not a
 * storage problem.
 */
export class AgentSessionOwnerMismatchError extends Error {
  constructor() {
    super("Agent session owner mismatch while persisting an Eve event.");
    this.name = "AgentSessionOwnerMismatchError";
  }
}

const NUL = /\u0000/g;
// A high surrogate not followed by a low one, or a low one not preceded by a
// high one. `JSON.stringify` writes either as a `\udXXX` escape, which jsonb
// refuses just as it refuses `\u0000`.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function cleanString(value: string): string {
  return value.replace(NUL, "").replace(LONE_SURROGATE, "�");
}

function cleanJson(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(cleanJson);
  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cleaned[cleanString(key)] = cleanJson(entry);
    }
    return cleaned;
  }
  return value;
}

/**
 * The event as jsonb can store it (#615).
 *
 * Postgres refuses a NUL (`\u0000`) and a lone surrogate anywhere in a jsonb
 * value, and the `JSON.stringify` round trip keeps both. A tool result holding
 * one — OCR text, an email body, a file read — used to fail the turn. This
 * table is the application's copy of the stream (eve keeps its own), so
 * dropping a NUL or replacing a broken surrogate with U+FFFD loses nothing a
 * reader of this table needs.
 */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return cleanJson(JSON.parse(JSON.stringify(value))) as Prisma.InputJsonValue;
}

/**
 * Whether a write failed because of what was in the batch rather than because
 * the database was unreachable or the session belongs to someone else.
 *
 * SQLSTATE class 22 is "data exception": `22P05` (unsupported Unicode escape),
 * `22021` (invalid byte sequence), `22P02` (invalid text representation) and
 * the rest. Retrying the same rows can never succeed. Prisma surfaces the code
 * in `meta.code` for a known request error and only in the message for an
 * unknown one, so both are read.
 */
export function isUnstorablePayloadError(error: unknown): boolean {
  if (error instanceof AgentSessionOwnerMismatchError) return false;
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown };
    message?: unknown;
  };
  const isDataException = (code: unknown) =>
    typeof code === "string" && /^22[0-9A-Z]{3}$/.test(code);
  if (isDataException(candidate.code) || isDataException(candidate.meta?.code))
    return true;
  return (
    typeof candidate.message === "string"
    && /Code: `22[0-9A-Z]{3}`/.test(candidate.message)
  );
}

/**
 * What is stored in place of an event Postgres still would not take.
 *
 * Deliberately not a hydratable event (no `meta`): `getAgentSessionEvents`
 * stops at it, so a reload paints the conversation up to here and eve's live
 * replay supplies the real event and everything after it. A marker that looked
 * like the event would carry its `meta.id`, and eve would then drop the real
 * one as already applied.
 */
function unstorableEventMarker(event: PendingEvent): PendingEvent {
  return {
    ...event,
    payload: {
      omitted: true,
      reason: "The event payload could not be stored.",
      type: event.eventType,
      eveEventId: event.eveEventId,
    },
  };
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
        throw new AgentSessionOwnerMismatchError();
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
        // A completed specialist session stays completed (see
        // sessionStatusAfter): its trailing `session.waiting` moves only the
        // clock.
        const keepsCompleted =
          status === AgentSessionStatus.WAITING
          && identity.parentEveSessionId !== undefined;
        await tx.agentSession.updateMany({
          where: {
            id: session.id,
            OR: [{ lastEventAt: null }, { lastEventAt: { lt: latest } }],
          },
          data: {
            lastEventAt: latest,
            ...(status && !keepsCompleted ? { status } : {}),
          },
        });
        if (keepsCompleted) {
          await tx.agentSession.updateMany({
            where: {
              id: session.id,
              status: { not: AgentSessionStatus.COMPLETED },
            },
            data: { status },
          });
        }
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
 * - A write the database refuses because of what is in it (a data exception,
 *   #615) is not retried as it was, because it would fail the same way at
 *   every later boundary and wedge the session. It is reported, then written
 *   one event at a time, with a marker in place of any event still refused.
 *   An owner mismatch is not a data error and still fails the turn.
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
        finalOutputs: new Map(),
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
        if (isUnstorablePayloadError(error)) {
          await writeOneByOne(buffer, batch, error);
          return;
        }
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

  /**
   * The batch held something Postgres refused. Report it once (ids only, never
   * the payload), then write the events separately so the good ones land and
   * only the refused one becomes a marker. Any other failure on the way puts
   * the unwritten remainder back at the front and fails as a normal write.
   */
  async function writeOneByOne(
    buffer: SessionBuffer,
    batch: PendingEvent[],
    cause: unknown,
  ) {
    reportError(cause, {
      source: "eve:event-persistence",
      ids: { sessionId: buffer.identity.eveSessionId },
      extra: { batchSize: batch.length },
      fingerprint: ["eve-event-persistence", "unstorable-payload"],
    });
    for (let index = 0; index < batch.length; index += 1) {
      const event = batch[index]!;
      try {
        try {
          await store.writeBatch(buffer.identity, [event]);
        } catch (error) {
          if (!isUnstorablePayloadError(error)) throw error;
          console.error(
            `[agent-events] ${event.eventType} ${event.eveEventId} in session ${buffer.identity.eveSessionId} could not be stored; a marker was written instead`,
          );
          await store.writeBatch(buffer.identity, [
            unstorableEventMarker(event),
          ]);
        }
      } catch (error) {
        buffer.pending.unshift(...batch.slice(index));
        throw error;
      }
    }
  }

  function flushInBackground(buffer: SessionBuffer) {
    void flush(buffer).catch((error) => {
      console.error(
        "[agent-events] background write failed; retrying at the next boundary",
        error instanceof Error ? error.message : error,
      );
    });
  }

  /**
   * At the end of a specialist's step, check each `final_output` it attempted
   * and queue a diagnostic for one that does not fit the schema. Queued ahead
   * of the step boundary, so it lands in the same write.
   */
  function diagnoseFinalOutputs(buffer: SessionBuffer, event: HookEvent) {
    if (buffer.finalOutputs.size === 0) return;
    for (const [callId, inputText] of buffer.finalOutputs) {
      const issues = finalOutputIssues(inputText, specialistResultSchema);
      if (issues.length === 0) continue;
      buffer.pending.push({
        eveEventId: `${event.meta.id}:final-output:${callId}`,
        eventType: FINAL_OUTPUT_DIAGNOSTIC_EVENT,
        // Not a hydratable event (no `meta`), and only ever on a specialist
        // session, which the workspace never hydrates.
        payload: toInputJson({
          callId,
          issues,
          stepEventId: event.meta.id,
          type: FINAL_OUTPUT_DIAGNOSTIC_EVENT,
        }),
        occurredAt: new Date(event.meta.at),
        status: undefined,
      });
    }
    buffer.finalOutputs.clear();
  }

  function release(buffer: SessionBuffer) {
    if (
      buffer.pending.length === 0
      && !buffer.timer
      && buffer.finalOutputs.size === 0
    ) {
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
    const isSpecialist = ctx.session.parent != null;
    if (
      isSpecialist
      && event.type === "action.input.appended"
      && event.data.toolName === FINAL_OUTPUT_TOOL_NAME
    ) {
      buffer.finalOutputs.set(
        event.data.callId,
        (buffer.finalOutputs.get(event.data.callId) ?? "")
          + event.data.inputTextDelta,
      );
    }
    if (
      isSpecialist
      && (event.type === "step.completed" || event.type === "step.failed")
    ) {
      diagnoseFinalOutputs(buffer, event);
    }
    buffer.pending.push({
      eveEventId: event.meta.id,
      eventType: event.type,
      payload: toInputJson(event),
      occurredAt: new Date(event.meta.at),
      status: sessionStatusAfter(event.type, ctx.session.parent != null),
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
