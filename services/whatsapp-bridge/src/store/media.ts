import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
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

  async save(
    messageId: string,
    bytes: Uint8Array,
    info: { mimeType: string | null; fileName: string | null },
  ): Promise<StoredMediaMeta> {
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
    await writeFile(files.body, bytes);
    // Meta last: a file is only "there" once both halves are.
    await writeFile(files.meta, JSON.stringify(meta), "utf8");
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

  /** Delete files older than the retention. Returns how many went. */
  async prune(retentionDays: number, now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const name of names) {
      const file = path.join(this.dir, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) {
        await rm(file, { force: true });
        if (name.endsWith(".bin")) removed += 1;
      }
    }
    return removed;
  }
}
