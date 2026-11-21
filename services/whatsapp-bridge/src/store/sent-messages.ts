import path from "node:path";

import { JsonFile } from "./json-file.js";

// Messages the bridge sent for the app, by the app's Idempotency-Key.
//
// Two jobs. A retried send with the same key answers with the first send's
// message id instead of posting twice — the app's retry after a timeout is
// exactly when that matters. And a message the bridge sent itself is not
// echoed back to the app as "received" when WhatsApp reports it.
//
// Entries expire after a week; the app never retries a key that old.

export const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type SentRecord = {
  readonly key: string;
  readonly groupJid: string;
  readonly messageId: string;
  readonly sentAt: string;
};

type Document = { version: 1; sent: SentRecord[] };

export class SentMessageStore {
  private readonly file: JsonFile<Document>;
  private byKey: Map<string, SentRecord> | null = null;
  private readonly ownIds = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(dataDir: string) {
    this.file = new JsonFile<Document>(
      path.join(dataDir, "sent-messages.json"),
      () => ({ sent: [], version: 1 }),
    );
  }

  private async load(): Promise<Map<string, SentRecord>> {
    if (!this.byKey) {
      const cutoff = Date.now() - SENT_RETENTION_MS;
      const document = await this.file.read();
      this.byKey = new Map(
        document.sent
          .filter((record) => Date.parse(record.sentAt) >= cutoff)
          .map((record) => [record.key, record]),
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

  /** Remember a message id before it is sent, so its echo is recognised. */
  expect(messageId: string): void {
    this.ownIds.add(messageId);
  }

  isOwn(messageId: string): boolean {
    return this.ownIds.has(messageId);
  }

  async record(record: SentRecord): Promise<void> {
    const map = await this.load();
    const cutoff = Date.now() - SENT_RETENTION_MS;
    for (const [key, old] of map) {
      if (Date.parse(old.sentAt) < cutoff) map.delete(key);
    }
    map.set(record.key, record);
    this.ownIds.add(record.messageId);
    await this.file.write({ sent: [...map.values()], version: 1 });
  }
}
