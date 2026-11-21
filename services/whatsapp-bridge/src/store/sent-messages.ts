import path from "node:path";

import { JsonFile } from "./json-file.js";

// Messages the bridge sends for the app, by the app's Idempotency-Key.
//
// Three jobs:
//
//   - A retried send with the same key answers with the first send instead of
//     posting twice — the app's retry after a timeout is exactly when that
//     matters.
//   - The intent is written BEFORE WhatsApp is called (`pending`, with the
//     message id chosen up front). If the answer is lost, the key stays
//     `unconfirmed` and a retry is refused rather than sent again: a second
//     copy on a client's phone is the expensive mistake.
//   - A message the bridge sent itself is not echoed back to the app as
//     "received" when WhatsApp reports it, even right after a restart:
//     `init()` loads the ids before the session connects.
//
// Entries expire after a week; the app never retries a key that old.

export const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type SentStatus = "pending" | "sent" | "unconfirmed";

export type SentRecord = {
  readonly key: string;
  readonly groupJid: string;
  readonly messageId: string;
  readonly status: SentStatus;
  /** When the intent was written, then when WhatsApp accepted it. */
  readonly sentAt: string;
};

type Document = { version: 2; sent: SentRecord[] };

export class SentMessageStore {
  private readonly file: JsonFile<Document>;
  private byKey: Map<string, SentRecord> | null = null;
  private readonly ownIds = new Set<string>();
  private readonly inFlight = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = new JsonFile<Document>(
      path.join(dataDir, "sent-messages.json"),
      () => ({ sent: [], version: 2 }),
    );
  }

  /** Load the stored sends. Call before the WhatsApp session connects. */
  async init(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<Map<string, SentRecord>> {
    if (!this.byKey) {
      const cutoff = Date.now() - SENT_RETENTION_MS;
      const document = (await this.file.read()) as {
        sent: (Omit<SentRecord, "status"> & { status?: SentStatus })[];
      };
      // A record from before intents were kept was a completed send.
      const records = document.sent.map((record) => ({
        ...record,
        status: record.status ?? ("sent" as const),
      }));
      // An intent still pending at start-up died with the process mid-send:
      // WhatsApp may have it, so it is unconfirmed, never retried.
      this.byKey = new Map(
        records
          .filter((record) => Date.parse(record.sentAt) >= cutoff)
          .map((record) => [
            record.key,
            record.status === "pending"
              ? { ...record, status: "unconfirmed" as const }
              : record,
          ]),
      );
      for (const record of this.byKey.values()) {
        this.ownIds.add(record.messageId);
      }
    }
    return this.byKey;
  }

  async find(key: string): Promise<SentRecord | null> {
    return (await this.load()).get(key) ?? null;
  }

  /** Claim a key for one send. False when another send holds it right now. */
  claim(key: string): boolean {
    if (this.inFlight.has(key)) return false;
    this.inFlight.add(key);
    return true;
  }

  release(key: string): void {
    this.inFlight.delete(key);
  }

  isOwn(messageId: string): boolean {
    return this.ownIds.has(messageId);
  }

  private async save(change: (map: Map<string, SentRecord>) => void) {
    const run = this.queue.then(async () => {
      const map = new Map(await this.load());
      const cutoff = Date.now() - SENT_RETENTION_MS;
      for (const [key, old] of map) {
        if (Date.parse(old.sentAt) < cutoff) map.delete(key);
      }
      change(map);
      await this.file.write({ sent: [...map.values()], version: 2 });
      this.byKey = map;
    });
    this.queue = run.catch(() => undefined);
    await run;
  }

  /** Write the intent, with its message id, before WhatsApp is called. */
  async begin(key: string, groupJid: string, messageId: string): Promise<void> {
    this.ownIds.add(messageId);
    await this.save((map) =>
      map.set(key, {
        groupJid,
        key,
        messageId,
        sentAt: new Date().toISOString(),
        status: "pending",
      }),
    );
  }

  /** WhatsApp accepted it. */
  async confirm(key: string, sentAt: string): Promise<SentRecord> {
    let record: SentRecord | undefined;
    await this.save((map) => {
      const current = map.get(key);
      if (!current) return;
      record = { ...current, sentAt, status: "sent" };
      map.set(key, record);
    });
    if (!record) throw new Error("No intent for that key.");
    return record;
  }

  /** WhatsApp refused before anything left: the key may be used again. */
  async discard(key: string): Promise<void> {
    await this.save((map) => void map.delete(key));
  }

  /** WhatsApp did not say: hold the key so a retry cannot post twice. */
  async markUnconfirmed(key: string): Promise<void> {
    await this.save((map) => {
      const current = map.get(key);
      if (current) map.set(key, { ...current, status: "unconfirmed" });
    });
  }
}
