import path from "node:path";

import { JsonFile } from "./json-file.js";

// Which WhatsApp groups belong to which Royal project.
//
// The app is the source of truth (its ProjectWhatsAppGroup rows); this is the
// bridge's copy, kept so it forwards only the groups that matter. Every other
// group on the account — family, suppliers, anything — is never sent to the
// app at all. The app pushes each link and unlink, and can replace the whole
// set to reconcile (PUT /v1/mappings).

export type GroupMapping = {
  readonly groupJid: string;
  readonly projectId: string;
  readonly mappedAt: string;
};

type Document = { version: 1; mappings: Record<string, GroupMapping> };

export class MappingStore {
  private readonly file: JsonFile<Document>;
  private cache: Map<string, GroupMapping> | null = null;

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

  private async save(map: Map<string, GroupMapping>): Promise<void> {
    this.cache = map;
    await this.file.write({ mappings: Object.fromEntries(map), version: 1 });
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
  async set(groupJid: string, projectId: string): Promise<GroupMapping> {
    const map = new Map(await this.load());
    const current = map.get(groupJid);
    if (current?.projectId === projectId) return current;
    for (const [jid, mapping] of map) {
      if (mapping.projectId === projectId) map.delete(jid);
    }
    const mapping = { groupJid, mappedAt: new Date().toISOString(), projectId };
    map.set(groupJid, mapping);
    await this.save(map);
    return mapping;
  }

  async remove(groupJid: string): Promise<boolean> {
    const map = new Map(await this.load());
    const removed = map.delete(groupJid);
    if (removed) await this.save(map);
    return removed;
  }

  /** Replace every mapping with the app's list. Returns what changed. */
  async replace(
    mappings: readonly { groupJid: string; projectId: string }[],
  ): Promise<{ added: number; removed: number; changed: number }> {
    const before = await this.load();
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
    await this.save(next);
    return { added, changed, removed };
  }
}
