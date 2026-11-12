import {
  AgentActionStatus,
  AgentOperationStatus,
  Prisma,
} from "@prisma/client";
import type { ToolContext } from "eve/tools";
import type { ZodType } from "zod";
import prisma from "@/lib/prisma";
import { authorizeAgentSession } from "@/lib/domain/access/agent-sessions";
import {
  mutationRefs,
  publishMutationEffects,
} from "@/agent/lib/mutation-effects";

export class AgentOperationConflictError extends Error {
  readonly code = "agent_operation_conflict";

  constructor() {
    super(
      "This action was already attempted and its outcome must be reviewed before trying again.",
    );
    this.name = "AgentOperationConflictError";
  }
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function keyFor(ctx: ToolContext, action: string) {
  return `agent:${ctx.session.id}:${ctx.callId}:${action}`;
}

type TransactionClient = Prisma.TransactionClient;

/**
 * Runs a side effect once per durable Eve tool call and records a sanitized
 * application audit. A prior ambiguous/failed attempt is never retried
 * automatically; the operator must inspect current state and make a new call.
 */
export async function runAuditedAgentOperation<T>(params: {
  action: string;
  ctx: ToolContext;
  execute: (tx?: TransactionClient) => Promise<T>;
  inputSummary: Prisma.InputJsonValue;
  outputSchema: ZodType<T>;
  ownerUserId: string;
  targetId?: string;
  targetType?: string;
  targetIdFromOutput?: (output: T) => string | undefined;
  authorize?: (tx: TransactionClient) => Promise<void>;
  /** External side effects cannot run while holding a database transaction. */
  transactional?: boolean;
}): Promise<T> {
  const operationKey = keyFor(params.ctx, params.action);

  type PreparedOperation =
    | { replay: T }
    | { replay: null; operationId: string; auditId: string };

  async function prepare(tx: TransactionClient): Promise<PreparedOperation> {
    // Re-checked inside the transaction even though the channel already
    // authenticated: the channel check ran before this transaction opened, and
    // the audit row this writes claims the operation was owner-scoped.
    // lib/domain/access/agent-sessions.ts owns the rule.
    const session = await authorizeAgentSession(
      params.ctx.session.id,
      params.ownerUserId,
      tx,
    );
    await params.authorize?.(tx);

    const existing = await tx.agentOperation.findUnique({
      where: {
        ownerUserId_operationKey: {
          ownerUserId: params.ownerUserId,
          operationKey,
        },
      },
      select: { result: true, status: true },
    });
    if (existing?.status === AgentOperationStatus.SUCCEEDED) {
      return {
        replay: params.outputSchema.parse(existing.result),
      };
    }
    if (existing) throw new AgentOperationConflictError();

    const operation = await tx.agentOperation.create({
      data: {
        action: params.action,
        agentSessionId: session.agentSessionId,
        operationKey,
        ownerUserId: params.ownerUserId,
        status: AgentOperationStatus.RUNNING,
      },
      select: { id: true },
    });
    const audit = await tx.agentActionAudit.create({
      data: {
        action: params.action,
        agentSessionId: session.agentSessionId,
        approvalOutcome: "approved",
        eveCallId: params.ctx.callId,
        eveSessionId: params.ctx.session.id,
        eveTurnId: params.ctx.session.turn.id,
        inputSummary: toInputJson(params.inputSummary),
        operationKey,
        ownerUserId: params.ownerUserId,
        status: AgentActionStatus.RUNNING,
        targetId: params.targetId,
        targetType: params.targetType,
        toolName: params.ctx.toolName,
      },
      select: { id: true },
    });

    return { auditId: audit.id, operationId: operation.id, replay: null };
  }

  async function finalizeSuccess(
    tx: TransactionClient,
    prepared: { operationId: string; auditId: string },
    output: T,
  ) {
    const outputRecord =
      typeof output === "object" && output !== null && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : null;
    await Promise.all([
      tx.agentOperation.update({
        where: { id: prepared.operationId },
        data: {
          completedAt: new Date(),
          result: toInputJson(output),
          status: AgentOperationStatus.SUCCEEDED,
        },
      }),
      tx.agentActionAudit.update({
        where: { id: prepared.auditId },
        data: {
          completedAt: new Date(),
          outputSummary: toInputJson({
            kind:
              typeof outputRecord?.kind === "string"
                ? outputRecord.kind
                : "completed",
          }),
          ...(params.targetIdFromOutput
            ? { targetId: params.targetIdFromOutput(output) }
            : {}),
          status: AgentActionStatus.SUCCEEDED,
        },
      }),
    ]);
  }

  async function finalizeFailure(
    tx: TransactionClient,
    prepared: { operationId: string; auditId: string },
  ) {
    await Promise.all([
      tx.agentOperation.update({
        where: { id: prepared.operationId },
        data: {
          completedAt: new Date(),
          failureReason:
            "Tool execution failed; inspect current state before retrying.",
          status: AgentOperationStatus.FAILED,
        },
      }),
      tx.agentActionAudit.update({
        where: { id: prepared.auditId },
        data: {
          completedAt: new Date(),
          failureReason:
            "Tool execution failed; details omitted from the audit record.",
          status: AgentActionStatus.FAILED,
        },
      }),
    ]);
  }

  const prepared = await prisma.$transaction((tx) => prepare(tx));
  if (!("operationId" in prepared)) return prepared.replay;

  // Once the write has committed, the app's screens for what it touched are
  // stale. One call for every agent write; see agent/lib/mutation-effects.ts.
  const committed = async (output: T) => {
    await publishMutationEffects(
      mutationRefs({
        inputSummary: params.inputSummary,
        output,
        targetId:
          params.targetIdFromOutput?.(output) ?? params.targetId,
        targetType: params.targetType,
      }),
    );
    return output;
  };

  if (params.transactional === false) {
    let output: T;
    try {
      output = params.outputSchema.parse(await params.execute());
    } catch (error) {
      await prisma.$transaction((tx) => finalizeFailure(tx, prepared));
      throw error;
    }
    await prisma.$transaction((tx) => finalizeSuccess(tx, prepared, output));
    return committed(output);
  }

  let output: T;
  try {
    output = await prisma.$transaction(
      async (tx) => {
        await params.authorize?.(tx);
        const output = params.outputSchema.parse(await params.execute(tx));
        await finalizeSuccess(tx, prepared, output);
        return output;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // A ceiling, not a wait: an operation that rewrites a project's whole
        // schedule (starting its first milestone) needs more than the default
        // five seconds on a slow connection.
        timeout: 30_000,
      },
    );
  } catch (error) {
    await prisma.$transaction((tx) => finalizeFailure(tx, prepared));
    throw error;
  }
  return committed(output);
}
