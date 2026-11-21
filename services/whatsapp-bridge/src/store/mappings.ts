import path from "node:path";

import { JsonFile } from "./json-file.js";

// Which WhatsApp groups belong to which Royal project.
//
// The app is the source of truth (its ProjectWhatsAppGroup rows); this is the
// bridge's copy, kept so it forwards only the groups that matter. Every other
// group on the account — family, suppliers, anything — is never sent to the
// app at all. The app pushes each link and unlink, and can replace the whole
// set to reconcile (PUT /v1/mappings).
//
// Every change runs in one queue — read, edit, write — and the in-memory copy
// the session reads is replaced only once the file is written. Two changes at
// once cannot drop each other, and a failed write leaves the old mapping in
// force, so the caller's retry finds nothing half-done.

export type GroupMapping = {
  readonly groupJid: string;
  readonly projectId: string;
  readonly mappedAt: string;
};

type Document = { version: 1; mappings: Record<string, GroupMapping> };

export class MappingStore {
  private readonly file: JsonFile<Document>;
  private cache: Map<string, GroupMapping> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = new JsonFile<Document>(
      path.join(dataDir, "mappings.json"),
      () => ({ mappings: {}, version: 1 }),
    );
  }

  private async load(): Promise<Map<string, GroupMapping>> {
    if (!this.cache) {
      const document = await this.file.read();
      this.cache = new Map(Object.entries(document.mappings));
    }
    return this.cache;
  }

  /** Run one change: edit a copy, write it, and only then publish it. */
  private mutate<T>(
    change: (draft: Map<string, GroupMapping>) => {
      result: T;
      changed: boolean;
    },
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = new Map(await this.load());
      const { result, changed } = change(draft);
      if (changed) {
        await this.file.write({
          mappings: Object.fromEntries(draft),
          version: 1,
        });
        this.cache = draft;
      }
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<GroupMapping[]> {
    return [...(await this.load()).values()].sort((a, b) =>
      a.groupJid.localeCompare(b.groupJid),
    );
  }

  async get(groupJid: string): Promise<GroupMapping | null> {
    return (await this.load()).get(groupJid) ?? null;
  }

  /** Map a group to a project. A project has one group, so its old one is released. */
  set(groupJid: string, projectId: string): Promise<GroupMapping> {
    return this.mutate((draft) => {
      const current = draft.get(groupJid);
      if (current?.projectId === projectId) {
        return { changed: false, result: current };
      }
      for (const [jid, mapping] of draft) {
        if (mapping.projectId === projectId) draft.delete(jid);
      }
      const mapping = {
        groupJid,
        mappedAt: new Date().toISOString(),
        projectId,
      };
      draft.set(groupJid, mapping);
      return { changed: true, result: mapping };
    });
  }

  /**
   * Unmap a group. With `projectId`, only while it is still that project's:
   * a late unlink from one project must not undo a newer link to another.
   */
  remove(
    groupJid: string,
    projectId?: string,
  ): Promise<{ removed: boolean; mappedTo: string | null }> {
    return this.mutate<{ removed: boolean; mappedTo: string | null }>(
      (draft) => {
        const current = draft.get(groupJid);
        if (!current) {
          return { changed: false, result: { mappedTo: null, removed: false } };
        }
        if (projectId && current.projectId !== projectId) {
          return {
            changed: false,
            result: { mappedTo: current.projectId, removed: false },
          };
        }
        draft.delete(groupJid);
        return { changed: true, result: { mappedTo: null, removed: true } };
      },
    );
  }

  /** Replace every mapping with the app's list. Returns what changed. */
  replace(
    mappings: readonly { groupJid: string; projectId: string }[],
  ): Promise<{ added: number; removed: number; changed: number }> {
    return this.mutate((before) => {
      const next = new Map<string, GroupMapping>();
      let added = 0;
      let changed = 0;
      const now = new Date().toISOString();
      for (const { groupJid, projectId } of mappings) {
        const old = before.get(groupJid);
        if (!old) added += 1;
        else if (old.projectId !== projectId) changed += 1;
        next.set(groupJid, {
          groupJid,
          mappedAt: old && old.projectId === projectId ? old.mappedAt : now,
          projectId,
        });
      }
      const removed = [...before.keys()].filter((jid) => !next.has(jid)).length;
      before.clear();
      for (const [jid, mapping] of next) before.set(jid, mapping);
      return { changed: true, result: { added, changed, removed } };
    });
  }
}
