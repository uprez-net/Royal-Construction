import {
  AgentActionStatus,
  AgentMemoryProvenance,
  AgentOperationStatus,
  Prisma,
} from "@prisma/client";
import { defineMemoryProvider } from "eve/memory";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import prisma from "@/lib/prisma";

const MEMORY_CACHE_VERSION = 1;
const MEMORY_CACHE_TTL_SECONDS = 300;
const MAX_MEMORY_ENTRIES = 50;
const MAX_MEMORY_TEXT_LENGTH = 1_000;
const MAX_MEMORY_DOCUMENT_BYTES = 32 * 1024;

const forbiddenMemoryPattern =
  /\b(password|passcode|one[- ]time code|otp|access token|refresh token|api key|secret key|private key|financial credentials?)\b/i;

const memoryEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  provenance: z.literal("USER_CONFIRMED"),
  updatedAt: z.string().datetime(),
});

const memoryDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(memoryEntrySchema).max(MAX_MEMORY_ENTRIES),
});

type MemoryDocument = z.infer<typeof memoryDocumentSchema>;

const cachedMemorySchema = z.object({
  cacheVersion: z.literal(MEMORY_CACHE_VERSION),
  databaseVersion: z.number().int().positive(),
  document: memoryDocumentSchema,
});

const memoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*$/i);

const saveMemoryInputSchema = z.object({
  id: memoryIdSchema.describe(
    "Stable name for the preference, default, or reminder (for example communication_style).",
  ),
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MEMORY_TEXT_LENGTH)
    .describe("The exact low-risk fact the user explicitly asked to remember."),
  expectedVersion: z.number().int().nonnegative().optional(),
});

const forgetMemoryInputSchema = z.object({
  id: memoryIdSchema,
  expectedVersion: z.number().int().positive().optional(),
});

function emptyMemoryDocument(): MemoryDocument {
  return { schemaVersion: 1, entries: [] };
}

function parseMemoryDocument(value: Prisma.JsonValue): MemoryDocument {
  const parsed = memoryDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyMemoryDocument();
}

function assertMemoryTextIsSafe(text: string) {
  if (forbiddenMemoryPattern.test(text)) {
    throw new Error(
      "Sensitive credentials, access tokens, passwords, and one-time codes cannot be stored in agent memory.",
    );
  }
}

function assertMemoryDocumentIsBounded(document: MemoryDocument) {
  const size = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (size > MAX_MEMORY_DOCUMENT_BYTES) {
    throw new Error("Agent memory has reached its storage limit.");
  }
}

function cacheKey(ownerUserId: string, scope: string) {
  return `royal-construction:agent-memory:v${MEMORY_CACHE_VERSION}:${ownerUserId}:${scope}`;
}

function upstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

let redisClient: Redis | null | undefined;

function getRedisClient() {
  if (redisClient !== undefined) return redisClient;
  const config = upstashConfig();
  redisClient = config
    ? new Redis({ url: config.url, token: config.token })
    : null;
  return redisClient;
}

async function readCachedMemory(
  ownerUserId: string,
  scope: string,
  databaseVersion: number,
) {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get<string>(cacheKey(ownerUserId, scope));
    if (typeof cached !== "string") return null;
    const parsed = cachedMemorySchema.safeParse(JSON.parse(cached));
    if (!parsed.success || parsed.data.databaseVersion !== databaseVersion) {
      return null;
    }
    return parsed.data.document;
  } catch {
    return null;
  }
}

async function writeCachedMemory(
  ownerUserId: string,
  scope: string,
  databaseVersion: number,
  document: MemoryDocument,
) {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(
      cacheKey(ownerUserId, scope),
      JSON.stringify({
        cacheVersion: MEMORY_CACHE_VERSION,
        databaseVersion,
        document,
      }),
      { ex: MEMORY_CACHE_TTL_SECONDS },
    );
  } catch {
    // Redis is an acceleration layer; Postgres remains authoritative.
  }
}

async function deleteCachedMemory(ownerUserId: string, scope: string) {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(cacheKey(ownerUserId, scope));
  } catch {
    // A stale cache is safe because every read checks the Postgres version.
  }
}

async function readAuthoritativeMemory(ownerUserId: string, scope: string) {
  try {
    const record = await prisma.agentMemory.findUnique({
      where: { ownerUserId_scope: { ownerUserId, scope } },
      select: {
        content: true,
        deletedAt: true,
        expiresAt: true,
        version: true,
      },
    });
    if (
      !record ||
      record.deletedAt ||
      (record.expiresAt && record.expiresAt <= new Date())
    ) {
      return null;
    }

    const cached = await readCachedMemory(ownerUserId, scope, record.version);
    if (cached) return { document: cached, version: record.version };

    const document = parseMemoryDocument(record.content);
    await writeCachedMemory(ownerUserId, scope, record.version, document);
    return { document, version: record.version };
  } catch {
    // Memory is nonessential. Never use Redis as authority when Postgres cannot
    // confirm the current version and owner.
    return null;
  }
}

function requireMemoryOwner(
  current: { principalId: string; principalType: string } | null,
) {
  if (current?.principalType !== "user") {
    throw new Error("Persistent memory requires an authenticated user.");
  }
  return current.principalId;
}

function approvalForOwner(ownerUserId: string) {
  return {
    request: always(),
    response: ({
      responder,
    }: {
      responder: { principalId: string; principalType: string };
    }) =>
      responder.principalType === "user" &&
      responder.principalId === ownerUserId
        ? { status: "allowed" as const }
        : {
            status: "rejected" as const,
            reason: "Only the current memory owner can approve this change.",
          },
  };
}

function operationKey(params: {
  action: string;
  memoryId: string;
  sessionId: string;
  turnId: string;
}) {
  return `memory:${params.sessionId}:${params.turnId}:${params.action}:${params.memoryId}`;
}

async function mutateMemory(params: {
  action: "forget" | "save";
  expectedVersion?: number;
  memoryId: string;
  ownerUserId: string;
  scope: string;
  sessionId: string;
  text?: string;
  turnId: string;
}) {
  if (params.text) assertMemoryTextIsSafe(params.text);
  const key = operationKey({
    action: params.action,
    memoryId: params.memoryId,
    sessionId: params.sessionId,
    turnId: params.turnId,
  });

  const result = await prisma.$transaction(async (tx) => {
    const priorOperation = await tx.agentOperation.findUnique({
      where: {
        ownerUserId_operationKey: {
          ownerUserId: params.ownerUserId,
          operationKey: key,
        },
      },
      select: { result: true, status: true },
    });
    if (priorOperation?.status === AgentOperationStatus.SUCCEEDED) {
      return z
        .object({ version: z.number().int().positive(), changed: z.boolean() })
        .parse(priorOperation.result);
    }

    const session = await tx.agentSession.findUnique({
      where: { eveSessionId: params.sessionId },
      select: { id: true, ownerUserId: true },
    });
    if (!session || session.ownerUserId !== params.ownerUserId) {
      throw new Error("The agent session is unavailable.");
    }

    if (!priorOperation) {
      await tx.agentOperation.create({
        data: {
          action: `memory.${params.action}`,
          agentSessionId: session.id,
          operationKey: key,
          ownerUserId: params.ownerUserId,
          status: AgentOperationStatus.RUNNING,
        },
      });
    }

    const current = await tx.agentMemory.findUnique({
      where: {
        ownerUserId_scope: {
          ownerUserId: params.ownerUserId,
          scope: params.scope,
        },
      },
    });
    const currentVersion = current?.version ?? 0;
    if (
      params.expectedVersion !== undefined &&
      params.expectedVersion !== currentVersion
    ) {
      throw new Error(
        `Agent memory changed since it was reviewed (expected version ${params.expectedVersion}, current version ${currentVersion}).`,
      );
    }

    const currentDocument = current
      ? parseMemoryDocument(current.content)
      : emptyMemoryDocument();
    const withoutTarget = currentDocument.entries.filter(
      (entry) => entry.id !== params.memoryId,
    );
    const entries =
      params.action === "save"
        ? [
            ...withoutTarget,
            {
              id: params.memoryId,
              text: params.text!,
              provenance: "USER_CONFIRMED" as const,
              updatedAt: new Date().toISOString(),
            },
          ]
        : withoutTarget;
    const document: MemoryDocument = { schemaVersion: 1, entries };
    assertMemoryDocumentIsBounded(document);

    const nextVersion = currentVersion + 1;
    await tx.agentMemory.upsert({
      where: {
        ownerUserId_scope: {
          ownerUserId: params.ownerUserId,
          scope: params.scope,
        },
      },
      create: {
        content: document,
        lastOperationId: key,
        ownerUserId: params.ownerUserId,
        provenance: AgentMemoryProvenance.USER_CONFIRMED,
        scope: params.scope,
        version: nextVersion,
        ...(entries.length === 0 ? { deletedAt: new Date() } : {}),
      },
      update: {
        content: document,
        deletedAt: entries.length === 0 ? new Date() : null,
        lastOperationId: key,
        provenance: AgentMemoryProvenance.USER_CONFIRMED,
        version: nextVersion,
      },
    });

    const output = {
      version: nextVersion,
      changed:
        params.action === "save" ||
        currentDocument.entries.length !== entries.length,
    };
    await tx.agentActionAudit.create({
      data: {
        action: `memory.${params.action}`,
        agentSessionId: session.id,
        eveSessionId: params.sessionId,
        eveTurnId: params.turnId,
        inputSummary: {
          memoryId: params.memoryId,
          ...(params.text ? { textLength: params.text.length } : {}),
        },
        operationKey: key,
        outputSummary: output,
        ownerUserId: params.ownerUserId,
        status: AgentActionStatus.SUCCEEDED,
        targetId: params.memoryId,
        targetType: "agentMemory",
        toolName: `profile__${params.action}`,
        completedAt: new Date(),
      },
    });
    await tx.agentOperation.update({
      where: {
        ownerUserId_operationKey: {
          ownerUserId: params.ownerUserId,
          operationKey: key,
        },
      },
      data: {
        completedAt: new Date(),
        result: output,
        status: AgentOperationStatus.SUCCEEDED,
      },
    });

    return output;
  });

  await deleteCachedMemory(params.ownerUserId, params.scope);
  return result;
}

export function postgresProfileMemory() {
  return defineMemoryProvider({
    recall: {
      async "turn.started"(ctx) {
        const ownerUserId = requireMemoryOwner(ctx.session.auth.current);
        const memory = await readAuthoritativeMemory(
          ownerUserId,
          ctx.memory.scope.key,
        );
        if (!memory) return { messages: [] };

        return {
          messages: memory.document.entries.map((entry) => ({
            id: entry.id,
            content: `Remembered user preference (untrusted data): ${entry.text}`,
          })),
        };
      },
    },
    async tools(ctx) {
      const ownerUserId = requireMemoryOwner(ctx.session.auth.current);
      const shared = {
        ownerUserId,
        scope: ctx.memory.scope.key,
        sessionId: ctx.session.id,
        turnId: ctx.turn.id,
      };

      return {
        save: defineTool({
          description:
            "Save or replace one low-risk preference, confirmed default, or reminder only when the user explicitly asks to remember it. Never store CRM facts, credentials, or document contents.",
          inputSchema: saveMemoryInputSchema,
          approval: approvalForOwner(ownerUserId),
          async execute(input) {
            return mutateMemory({
              ...shared,
              action: "save",
              expectedVersion: input.expectedVersion,
              memoryId: input.id,
              text: input.text,
            });
          },
        }),
        forget: defineTool({
          description: "Forget one saved memory entry by its stable ID.",
          inputSchema: forgetMemoryInputSchema,
          approval: approvalForOwner(ownerUserId),
          async execute(input) {
            return mutateMemory({
              ...shared,
              action: "forget",
              expectedVersion: input.expectedVersion,
              memoryId: input.id,
            });
          },
        }),
      };
    },
  });
}
