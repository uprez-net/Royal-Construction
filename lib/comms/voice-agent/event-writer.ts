import type { AgentCallEventInput } from "@/lib/domain/comms/calls/agent-events";

import type { VoiceAgentEventSink } from "./session";

// What the call desk did on a call, written off the conversation's path.
//
// The session hands each event over with `emit`, which only queues it and
// returns: Mili's next words never wait on a database write. Queued events go
// out in batches — every FLUSH_MS, or sooner once MAX_BATCH have built up —
// one write after another, so the log stays in order. A write that fails is
// logged and its events are dropped: losing a log line is better than
// holding up a call or retrying into a database that is down. The session
// awaits `flush` only once the call has been reported, so the function stays
// alive until the last batch lands (the same reason checkpoints are awaited).

/** How long an event waits for others to share its write. */
export const EVENT_FLUSH_MS = 2_000;
/** A batch this big goes at once. */
export const EVENT_MAX_BATCH = 20;

type Target = { readonly callId: string; readonly providerCallId: string };

export type EventBatch = Target & {
  readonly events: readonly AgentCallEventInput[];
};

export function voiceAgentEventWriter(
  write: (batch: EventBatch) => Promise<unknown>,
  options: {
    readonly log?: Pick<Console, "warn">;
    readonly setTimer?: (fn: () => void, ms: number) => unknown;
    readonly clearTimer?: (handle: unknown) => void;
  } = {},
): VoiceAgentEventSink {
  const log = options.log ?? console;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer
    ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let target: Target | null = null;
  let queued: AgentCallEventInput[] = [];
  let timer: unknown = null;
  let writes: Promise<void> = Promise.resolve();

  const send = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!target || queued.length === 0) return;
    const batch: EventBatch = { ...target, events: queued };
    queued = [];
    writes = writes.then(() =>
      write(batch).then(
        () => undefined,
        (error: unknown) => {
          log.warn(
            `[voice-agent] could not keep ${batch.events.length} call event(s) (${
              error instanceof Error ? error.name : "error"
            }).`,
          );
        },
      ),
    );
  };

  return {
    emit(call, event) {
      // One sink per session, so one call: the first target is the call's.
      target ??= call;
      queued.push(event);
      if (queued.length >= EVENT_MAX_BATCH) {
        send();
      } else if (timer === null) {
        timer = setTimer(send, EVENT_FLUSH_MS);
      }
    },
    flush() {
      send();
      return writes;
    },
  };
}
