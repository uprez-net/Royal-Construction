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

/** Errors that mean "this platform cannot fsync a directory", not a fault. */
const UNSUPPORTED_DIR_SYNC = new Set([
  "EISDIR",
  "EPERM",
  "EACCES",
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EBADF",
]);

/**
 * Flush a directory's entries, so the rename survives a crash. Retried once;
 * a platform that cannot do it (Windows) is fine, but a storage fault such as
 * EIO is thrown, so enqueue never reports a write it could not make durable.
 */
async function syncDirectory(dir: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const handle = await open(dir, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (UNSUPPORTED_DIR_SYNC.has(code)) return;
      if (attempt >= 2) throw error;
    }
  }
}

/** The sequence number a queued file's name starts with. */
const SEQUENCE_DIGITS = 16;
function sequenceOf(name: string): number {
  const match = /^(\d{16})-/.exec(name);
  return match ? Number(match[1]) : -1;
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
  /**
   * The next file's sequence number. Monotonic across restarts — it resumes
   * after the highest queued or dead-lettered file — and independent of the
   * clock, so a later event can never sort before an earlier one.
   */
  private sequence: number | null = null;
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
    await this.renameLegacyFiles();
    this.pendingCount = (await this.files()).length;
    this.deadCount = (await this.list(this.deadDir)).filter((f) =>
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
      if (this.sequence === null) this.sequence = await this.nextSequence();
      const name = `${String(this.sequence++).padStart(SEQUENCE_DIGITS, "0")}-${randomUUID()}.json`;
      const temp = path.join(this.dir, `${name}.tmp`);
      await writeDurably(temp, JSON.stringify(event));
      await rename(temp, path.join(this.dir, name));
      await syncDirectory(this.dir);
      this.pendingCount += 1;
      return event;
    });
    this.writes = run.catch(() => undefined);
    return run.then((event) => {
      // While backing off, the timer already owns the next attempt; with no
      // app configured, events wait on disk and nothing polls.
      if (this.started && this.failures === 0 && this.configured) {
        this.schedule(0);
      }
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

  /** Directory entries, where only a missing directory counts as empty. */
  private async list(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async files(): Promise<string[]> {
    return (await this.list(this.dir))
      .filter((name) => name.endsWith(".json"))
      .sort();
  }

  private async nextSequence(): Promise<number> {
    const names = [
      ...(await this.list(this.dir)),
      ...(await this.list(this.deadDir)),
    ];
    return names.reduce((max, name) => Math.max(max, sequenceOf(name)), -1) + 1;
  }

  /**
   * Files queued by an earlier version were named by the clock. Renumber them,
   * in their existing order, so they keep their place ahead of new ones.
   */
  private async renameLegacyFiles(): Promise<void> {
    const legacy = (await this.files()).filter((name) => sequenceOf(name) < 0);
    if (legacy.length === 0) return;
    const current = (await this.files()).filter(
      (name) => sequenceOf(name) >= 0,
    );
    let next =
      current.reduce((max, name) => Math.max(max, sequenceOf(name)), -1) + 1;
    // Legacy files predate every numbered one, so numbered files move after.
    for (const name of [...legacy, ...current]) {
      const renamed = `${String(next++).padStart(SEQUENCE_DIGITS, "0")}-${randomUUID()}.json`;
      await rename(path.join(this.dir, name), path.join(this.dir, renamed));
    }
    await syncDirectory(this.dir);
  }

  private get configured(): boolean {
    return Boolean(this.options.url && this.options.secret);
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
          if (!this.configured) return;
          if (this.failures > 0) {
            this.schedule(this.backoffMs());
            return;
          }
          // Events queued while this pass ran (or while it was retrying).
          const remaining = await this.files().catch(() => null);
          if (remaining === null) {
            this.failures += 1;
            this.schedule(this.backoffMs());
          } else if (remaining.length > 0) {
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
