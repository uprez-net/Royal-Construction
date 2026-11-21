import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { Logger } from "pino";

import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  signBody,
  TIMESTAMP_HEADER,
} from "./sign.js";
import type { BridgeEvent, BridgeEventMap, BridgeEventType } from "./types.js";

// Events for the app, written to disk before anything is sent.
//
// A client's message must not vanish because the app was deploying, or
// Vercel answered 500, or the network blinked. So each event is a file in
// DATA_DIR/outbox, delivered in order and deleted only when the app answers
// 2xx. Anything else is retried with backoff for as long as it takes, except
// a definite refusal (4xx other than 408/429), which is moved to
// outbox-dead/ and logged as an error — retrying a request the app rejects
// would block every event behind it.
//
// The app deduplicates on the event's id and on WhatsApp's message id, so a
// delivery that landed but whose answer was lost is harmless to repeat.

export type OutboxHealth = {
  readonly pending: number;
  readonly dead: number;
  readonly lastDeliveredAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  /** False when APP_WEBHOOK_URL is not set: events wait on disk. */
  readonly delivering: boolean;
};

export type OutboxOptions = {
  readonly dataDir: string;
  readonly url: string | null;
  readonly secret: string | null;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  /** Overridable for tests. */
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
};

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 2_000;

export class EventOutbox {
  private readonly dir: string;
  private readonly deadDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private started = false;
  private stopped = false;
  private failures = 0;
  private sequence = 0;
  private lastDeliveredAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private deadCount = 0;
  private pendingCount = 0;

  constructor(private readonly options: OutboxOptions) {
    this.dir = path.join(options.dataDir, "outbox");
    this.deadDir = path.join(options.dataDir, "outbox-dead");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.deadDir, { recursive: true });
    this.pendingCount = (await this.files()).length;
    this.deadCount = (await readdir(this.deadDir)).filter((f) =>
      f.endsWith(".json"),
    ).length;
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  health(): OutboxHealth {
    return {
      dead: this.deadCount,
      delivering: Boolean(this.options.url && this.options.secret),
      lastDeliveredAt: this.lastDeliveredAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      pending: this.pendingCount,
    };
  }

  /** Queue one event. Resolves once it is on disk, not once it is delivered. */
  async enqueue<T extends BridgeEventType>(
    type: T,
    data: BridgeEventMap[T],
    id: string = randomUUID(),
  ): Promise<BridgeEvent<T>> {
    const event: BridgeEvent<T> = {
      data,
      id,
      occurredAt: new Date(this.now()).toISOString(),
      type,
    };
    await mkdir(this.dir, { recursive: true });
    // Sortable names keep delivery in arrival order.
    const name = `${String(this.now()).padStart(15, "0")}-${String(this.sequence++).padStart(6, "0")}-${randomUUID()}.json`;
    const temp = path.join(this.dir, `${name}.tmp`);
    await writeFile(temp, JSON.stringify(event), "utf8");
    await rename(temp, path.join(this.dir, name));
    this.pendingCount += 1;
    // While backing off, the timer already owns the next attempt.
    if (this.started && this.failures === 0) this.schedule(0);
    return event;
  }

  /** Deliver everything waiting, now. One drain at a time, in order. */
  async flush(): Promise<void> {
    while (this.running) await this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async files(): Promise<string[]> {
    return (await readdir(this.dir).catch(() => [] as string[]))
      .filter((name) => name.endsWith(".json"))
      .sort();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().then(() => {
        if (this.failures > 0) {
          this.schedule(
            Math.min(
              BASE_BACKOFF_MS * 2 ** (this.failures - 1),
              MAX_BACKOFF_MS,
            ),
          );
        }
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async drain(): Promise<void> {
    const { url, secret, logger } = this.options;
    if (!url || !secret) return;
    for (const name of await this.files()) {
      if (this.stopped) return;
      const file = path.join(this.dir, name);
      let body: string;
      try {
        body = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const outcome = await this.deliver(url, secret, body);
      if (outcome === "delivered") {
        await rm(file, { force: true });
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        this.failures = 0;
        this.lastDeliveredAt = new Date(this.now()).toISOString();
        continue;
      }
      if (outcome === "rejected") {
        await mkdir(this.deadDir, { recursive: true });
        await rename(file, path.join(this.deadDir, name));
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        this.deadCount += 1;
        logger.error(
          { event: name, lastError: this.lastError },
          "The app refused an event; moved to outbox-dead. It will not be retried.",
        );
        continue;
      }
      this.failures += 1;
      logger.warn(
        { attempt: this.failures, lastError: this.lastError },
        "Could not deliver an event to the app; retrying with backoff.",
      );
      return;
    }
  }

  private async deliver(
    url: string,
    secret: string,
    body: string,
  ): Promise<"delivered" | "rejected" | "retry"> {
    let eventId = "";
    try {
      eventId = (JSON.parse(body) as { id?: string }).id ?? "";
    } catch {
      this.noteError("A queued event was not valid JSON.");
      return "rejected";
    }
    const timestamp = Math.floor(this.now() / 1000);
    try {
      const response = await this.fetchImpl(url, {
        body,
        headers: {
          "Content-Type": "application/json",
          [EVENT_ID_HEADER]: eventId,
          [SIGNATURE_HEADER]: signBody(secret, timestamp, body),
          [TIMESTAMP_HEADER]: String(timestamp),
        },
        method: "POST",
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 15_000),
      });
      if (response.ok) return "delivered";
      this.noteError(`The app answered ${response.status}.`);
      if (
        response.status >= 400
        && response.status < 500
        && response.status !== 408
        && response.status !== 429
        // 401: our secret and the app's disagree — fixable, so keep the event.
        && response.status !== 401
      ) {
        return "rejected";
      }
      return "retry";
    } catch (error) {
      this.noteError(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : "Network error.",
      );
      return "retry";
    }
  }

  private noteError(message: string): void {
    this.lastError = message;
    this.lastErrorAt = new Date(this.now()).toISOString();
  }
}
