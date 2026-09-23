import type { DomainDb, TransactionalDomainDb } from "@/lib/domain/db";

// A small in-memory database for the WhatsApp commands (issue #333).
//
// `recordingDb` answers reads from a script, which is right for a command that
// reads once and writes once. The send and the inbound path are state
// machines — the second call has to see what the first one wrote, or a replay
// test proves nothing — so these tests need the rows to persist between calls.
//
// Only the operations the WhatsApp commands use are implemented, and only the
// `where` shapes they use: equality, `in`, `lt`/`gt`, `OR`, compound unique
// keys. An unsupported shape throws rather than matching everything, for the
// same reason `recordingDb` throws on an unscripted read.
//
// `$transaction` snapshots every table and restores it if the callback throws,
// which is what Postgres does and what the failure paths depend on.

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const UNIQUE_KEYS: Record<string, string[][]> = {
  lead: [["id"]],
  leadWhatsAppConversation: [
    ["id"],
    ["leadId", "businessPhoneNumberId", "customerPhoneE164"],
  ],
  leadWhatsAppMessage: [["id"], ["providerMessageId"], ["idempotencyKey"]],
  outboxEvent: [["id"], ["key"]],
  whatsAppStatusEvent: [["id"], ["providerMessageId", "status"]],
  whatsAppUnmatchedMessage: [["id"], ["providerMessageId"]],
  leadHistory: [["id"]],
  user: [["id"]],
};

const COMPOUND_WHERE: Record<string, string> = {
  leadId_businessPhoneNumberId_customerPhoneE164: "compound",
  providerMessageId_status: "compound",
};

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${++sequence}`;

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

function compare(a: unknown, b: unknown): number {
  const left = isDate(a) ? a.getTime() : a;
  const right = isDate(b) ? b.getTime() : b;
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return (left as number | string) < (right as number | string) ? -1 : 1;
}

function flattenWhere(where: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(where)) {
    if (COMPOUND_WHERE[key]) Object.assign(out, value as Row);
    else out[key] = value;
  }
  return out;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(flattenWhere(where)).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Row[]).some((branch) => matches(row, branch));
    }
    const value = row[key];
    if (
      condition !== null
      && typeof condition === "object"
      && !isDate(condition)
      && !Array.isArray(condition)
    ) {
      const ops = condition as Row;
      return Object.entries(ops).every(([op, operand]) => {
        switch (op) {
          case "in":
            return (operand as unknown[]).includes(value);
          case "lt":
            return compare(value, operand) < 0;
          case "gt":
            return compare(value, operand) > 0;
          case "not":
            return compare(value, operand) !== 0;
          case "equals":
            return compare(value, operand) === 0;
          default:
            throw new Error(`fake db: unsupported operator ${op} on ${key}`);
        }
      });
    }
    return compare(value, condition) === 0;
  });
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (
      value !== null
      && typeof value === "object"
      && !isDate(value)
      && !Array.isArray(value)
    ) {
      const op = value as Row;
      if ("increment" in op) {
        next[key] = ((next[key] as number) ?? 0) + (op.increment as number);
        continue;
      }
      if ("connect" in op) {
        const id = (op.connect as Row).id;
        const fk = `${key}Id`;
        next[fk] = id;
        continue;
      }
      if ("disconnect" in op) {
        next[`${key}Id`] = null;
        continue;
      }
    }
    next[key] = value;
  }
  next.updatedAt = new Date();
  return next;
}

export type FakeWhatsAppDb = {
  readonly db: DomainDb;
  readonly transactionalDb: TransactionalDomainDb;
  readonly tables: Tables;
  /** Every mutation, in order, as "<model>.<op>". */
  readonly log: string[];
  /** Insert a row directly, for fixtures. */
  seed(model: string, row: Row): Row;
  rows(model: string): Row[];
};

export function fakeWhatsAppDb(): FakeWhatsAppDb {
  const tables: Tables = {};
  const log: string[] = [];
  const table = (name: string) => (tables[name] ??= []);

  const assertUnique = (model: string, candidate: Row, ignore?: Row) => {
    for (const key of UNIQUE_KEYS[model] ?? [["id"]]) {
      if (key.some((field) => candidate[field] === null || candidate[field] === undefined)) {
        continue;
      }
      const clash = table(model).find(
        (row) =>
          row !== ignore
          && key.every((field) => compare(row[field], candidate[field]) === 0),
      );
      if (clash) {
        const error = new Error(`Unique constraint failed on ${model}.${key.join("+")}`);
        (error as Error & { code: string }).code = "P2002";
        throw error;
      }
    }
  };

  const withRelations = (model: string, row: Row): Row => {
    const out: Row = { ...row };
    if (model === "leadWhatsAppMessage") {
      out.conversation = table("leadWhatsAppConversation").find(
        (conversation) => conversation.id === row.conversationId,
      );
      const author = table("user").find((user) => user.id === row.authorId);
      out.author = author ? { name: author.name } : null;
      out.lead = table("lead").find((lead) => lead.id === row.leadId);
    }
    if (model === "lead") {
      out.whatsappConversations = table("leadWhatsAppConversation").filter(
        (conversation) => conversation.leadId === row.id,
      );
    }
    return out;
  };

  const create = (model: string, data: Row): Row => {
    const now = new Date();
    const row = applyData(
      {
        createdAt: now,
        id: model === "lead" ? table(model).length + 1 : nextId(model),
        ...defaultsFor(model),
      },
      data,
    );
    assertUnique(model, row);
    table(model).push(row);
    return row;
  };

  const models = new Proxy(
    {},
    {
      get(_target, model: string) {
        if (model === "$transaction") {
          return async (fn: (tx: DomainDb) => Promise<unknown>) => {
            const snapshot = structuredClone(tables);
            try {
              return await fn(db);
            } catch (error) {
              for (const key of Object.keys(tables)) delete tables[key];
              Object.assign(tables, snapshot);
              throw error;
            }
          };
        }
        if (typeof model !== "string" || model.startsWith("$")) return undefined;
        return {
          count: async (args: Row = {}) =>
            table(model).filter((row) => matches(row, args.where as Row)).length,
          create: async (args: Row) => {
            log.push(`${model}.create`);
            return withRelations(model, create(model, args.data as Row));
          },
          findFirst: async (args: Row = {}) => {
            const row = table(model).find((candidate) =>
              matches(candidate, args.where as Row),
            );
            return row ? withRelations(model, row) : null;
          },
          findMany: async (args: Row = {}) => {
            if (
              args.skip !== undefined ||
              args.cursor !== undefined ||
              args.distinct !== undefined
            ) {
              throw new Error("fake db: unsupported-pagination");
            }
            if (typeof args.take === "number" && args.take < 0) {
              throw new Error("fake db: unsupported-pagination");
            }
            let rows = table(model).filter((row) => matches(row, args.where as Row));
            const orderBy = args.orderBy
              ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) as Row[]
              : [];
            rows = [...rows].sort((a, b) => {
              for (const order of orderBy) {
                const [field, direction] = Object.entries(order)[0];
                const result = compare(a[field], b[field]);
                if (result !== 0) return direction === "desc" ? -result : result;
              }
              return 0;
            });
            if (typeof args.take === "number") rows = rows.slice(0, args.take);
            return rows.map((row) => withRelations(model, row));
          },
          findUnique: async (args: Row) => {
            const row = table(model).find((candidate) =>
              matches(candidate, args.where as Row),
            );
            return row ? withRelations(model, row) : null;
          },
          update: async (args: Row) => {
            log.push(`${model}.update`);
            const rows = table(model);
            const index = rows.findIndex((row) => matches(row, args.where as Row));
            if (index < 0) throw new Error(`fake db: ${model}.update matched nothing`);
            const updated = applyData(rows[index], args.data as Row);
            assertUnique(model, updated, rows[index]);
            rows[index] = updated;
            return withRelations(model, updated);
          },
          updateMany: async (args: Row) => {
            log.push(`${model}.updateMany`);
            const rows = table(model);
            let count = 0;
            rows.forEach((row, index) => {
              if (!matches(row, args.where as Row)) return;
              rows[index] = applyData(row, args.data as Row);
              count += 1;
            });
            return { count };
          },
          upsert: async (args: Row) => {
            log.push(`${model}.upsert`);
            const rows = table(model);
            const index = rows.findIndex((row) => matches(row, args.where as Row));
            if (index < 0) {
              return withRelations(model, create(model, args.create as Row));
            }
            rows[index] = applyData(rows[index], args.update as Row);
            return withRelations(model, rows[index]);
          },
        };
      },
    },
  );
  const db = models as unknown as DomainDb;

  return {
    db,
    log,
    rows: (model) => table(model),
    seed: (model, row) => create(model, row),
    tables,
    transactionalDb: db as unknown as TransactionalDomainDb,
  };
}

function defaultsFor(model: string): Row {
  switch (model) {
    case "outboxEvent":
      return {
        attempts: 0,
        availableAt: new Date(),
        completedAt: null,
        lastError: null,
        lockedAt: null,
        result: null,
        status: "PENDING",
      };
    case "leadWhatsAppConversation":
      return {
        lastInboundAt: null,
        lastMessageAt: null,
        lastOutboundAt: null,
        unreadCount: 0,
        windowExpiresAt: null,
      };
    case "leadWhatsAppMessage":
      return {
        authorId: null,
        deliveredAt: null,
        failedAt: null,
        idempotencyKey: null,
        needsReconciliation: false,
        providerErrorCode: null,
        providerErrorTitle: null,
        providerMessageId: null,
        readAt: null,
        templateLanguage: null,
        templateName: null,
        templateParameters: null,
      };
    case "whatsAppStatusEvent":
      return { appliedAt: null, errorCode: null, errorTitle: null };
    case "whatsAppUnmatchedMessage":
      return {
        resolvedAt: null,
        resolvedById: null,
        resolvedLeadId: null,
        status: "PENDING",
      };
    case "lead":
      return {
        assignedId: null,
        isArchived: false,
        location: "",
        phone: "",
        phoneE164: null,
        type: [],
        whatsappConsentAt: null,
        whatsappConsentNote: null,
        whatsappConsentRecordedById: null,
        whatsappConsentSource: null,
        whatsappOptedOutAt: null,
      };
    default:
      return {};
  }
}
