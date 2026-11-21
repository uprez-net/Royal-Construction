import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// A small JSON document on disk, written atomically: to a temporary file in
// the same directory, then renamed over the old one. A crash mid-write leaves
// the previous version, never half a file. Writes are serialised so two
// updates in the same tick cannot interleave.

export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly empty: () => T,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.empty();
      }
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const run = this.queue.then(() => this.writeNow(value));
    this.queue = run.catch(() => undefined);
    await run;
  }

  private async writeNow(value: T): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, this.file);
  }
}
