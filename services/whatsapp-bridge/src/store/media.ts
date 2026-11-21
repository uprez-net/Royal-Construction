import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

// Files posted in mapped groups, downloaded when they arrive and kept for a
// while so the app can copy them into its own storage (GET /v1/media/:id).
//
// Downloaded eagerly because WhatsApp's media links expire: by the time the
// app asks, the encrypted original may be gone. Kept only for
// MEDIA_RETENTION_DAYS — the app's copy is the durable one.
//
// Each file is written once, to a temporary name in the same directory and
// renamed into place, so a reader never sees half a file — not even when
// WhatsApp delivers the same message twice.

export type StoredMediaMeta = {
  readonly messageId: string;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storedAt: string;
};

/** Message ids are WhatsApp's: letters and digits. Anything else is refused. */
export function isSafeMediaId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,128}$/.test(id);
}

export type PruneResult = { readonly removed: number; readonly failed: number };

export class MediaStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "media");
  }

  private paths(messageId: string) {
    if (!isSafeMediaId(messageId)) throw new Error("Unsafe media id.");
    return {
      body: path.join(this.dir, `${messageId}.bin`),
      meta: path.join(this.dir, `${messageId}.json`),
    };
  }

  private async publish(file: string, data: Uint8Array | string) {
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, data);
    await rename(temp, file);
  }

  async save(
    messageId: string,
    bytes: Uint8Array,
    info: { mimeType: string | null; fileName: string | null },
  ): Promise<StoredMediaMeta> {
    const existing = await this.read(messageId);
    if (existing) return existing.meta;
    await mkdir(this.dir, { recursive: true });
    const files = this.paths(messageId);
    const meta: StoredMediaMeta = {
      byteSize: bytes.byteLength,
      fileName: info.fileName,
      messageId,
      mimeType: info.mimeType,
      sha256: createHash("sha256").update(bytes).digest("base64"),
      storedAt: new Date().toISOString(),
    };
    await this.publish(files.body, bytes);
    // Meta last: a file is only "there" once both halves are.
    await this.publish(files.meta, JSON.stringify(meta));
    return meta;
  }

  async read(
    messageId: string,
  ): Promise<{ meta: StoredMediaMeta; bytes: Buffer } | null> {
    if (!isSafeMediaId(messageId)) return null;
    const files = this.paths(messageId);
    try {
      const meta = JSON.parse(
        await readFile(files.meta, "utf8"),
      ) as StoredMediaMeta;
      return { bytes: await readFile(files.body), meta };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Delete files older than the retention. One file that cannot be deleted
   * does not stop the rest; it is counted so the caller can report it.
   */
  async prune(retentionDays: number, now = Date.now()): Promise<PruneResult> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { failed: 0, removed: 0 };
      }
      throw error;
    }
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    let failed = 0;
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const info = await stat(file);
        if (info.mtimeMs >= cutoff) continue;
        await rm(file, { force: true });
        if (name.endsWith(".bin")) removed += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") failed += 1;
      }
    }
    return { failed, removed };
  }
}
