import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
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
// DATA_DIR/outbox — written, flushed to disk and renamed into place before
// `enqueue` resolves — delivered in order and deleted only when the app
// answers 2xx. Anything else is retried with backoff for as long as it takes,
// except a definite refusal (4xx other than 401/408/429), which is moved to
// outbox-dead/ and logged as an error — retrying a request the app rejects
// would block every event behind it.
//
// Order: enqueues are serialised, so a file becomes visible to the drain only
// after every earlier one has; and a drain stops at the first event it cannot
// deliver — or cannot even read — rather than send a later one first.
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

type Outcome = "delivered" | "rejected" | "retry";

/** Write a file and flush it to disk, so a crash after this cannot lose it. */
async function writeDurably(file: string, data: string): Promise<void> {
  const handle = await open(file, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Flush a directory's entries (the rename). Not supported on Windows. */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // EISDIR/EPERM on platforms that cannot fsync a directory.
  }
}

export class EventOutbox {
  private readonly dir: string;
  private readonly deadDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
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

  /**
   * Queue one event. Resolves once it is durably on disk and visible to the
   * drain after every earlier event — not once it is delivered.
   */
  enqueue<T extends BridgeEventType>(
    type: T,
    data: BridgeEventMap[T],
    id: string = randomUUID(),
  ): Promise<BridgeEvent<T>> {
    const run = this.writes.then(async () => {
      const event: BridgeEvent<T> = {
        data,
        id,
        occurredAt: new Date(this.now()).toISOString(),
        type,
      };
      await mkdir(this.dir, { recursive: true });
      // Named inside the serialised step, so name order is call order.
      const name = `${String(this.now()).padStart(15, "0")}-${String(this.sequence++).padStart(6, "0")}-${randomUUID()}.json`;
      const temp = path.join(this.dir, `${name}.tmp`);
      await writeDurably(temp, JSON.stringify(event));
      await rename(temp, path.join(this.dir, name));
      await syncDirectory(this.dir);
      this.pendingCount += 1;
      return event;
    });
    this.writes = run.catch(() => undefined);
    return run.then((event) => {
      // While backing off, the timer already owns the next attempt.
      if (this.started && this.failures === 0) this.schedule(0);
      return event;
    });
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

  private backoffMs(): number {
    return Math.min(
      BASE_BACKOFF_MS * 2 ** Math.max(0, this.failures - 1),
      MAX_BACKOFF_MS,
    );
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush()
        .catch((error: unknown) => {
          // Deleting a delivered file or moving a refused one failed: keep
          // the file (it is redelivered, which the app deduplicates) and
          // back off rather than stop.
          this.failures += 1;
          this.noteError(
            `Outbox storage error: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.options.logger.error(
            { lastError: this.lastError },
            "The outbox could not update its files; retrying with backoff.",
          );
        })
        .then(async () => {
          if (this.failures > 0) {
            this.schedule(this.backoffMs());
          } else if ((await this.files()).length > 0) {
            // Events queued while this pass ran (or while it was retrying).
            this.schedule(0);
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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        // Unreadable right now (EIO, EMFILE…): never skip it and send a
        // later event first. Stop and retry with backoff.
        this.failures += 1;
        this.noteError(
          `Could not read a queued event: ${(error as Error).message}`,
        );
        logger.error(
          { event: name, lastError: this.lastError },
          "Could not read a queued event; retrying with backoff.",
        );
        return;
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
  ): Promise<Outcome> {
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
