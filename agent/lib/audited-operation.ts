import {
  AgentActionStatus,
  AgentOperationStatus,
  Prisma,
} from "@prisma/client";
import type { ToolContext } from "eve/tools";
import type { ZodType } from "zod";
import prisma from "@/lib/prisma";

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

/**
 * Runs a side effect once per durable Eve tool call and records a sanitized
 * application audit. A prior ambiguous/failed attempt is never retried
 * automatically; the operator must inspect current state and make a new call.
 */
export async function runAuditedAgentOperation<T>(params: {
  action: string;
  ctx: ToolContext;
  execute: () => Promise<T>;
  inputSummary: Prisma.InputJsonValue;
  outputSchema: ZodType<T>;
  ownerUserId: string;
  targetId?: string;
  targetType?: string;
}): Promise<T> {
  const operationKey = keyFor(params.ctx, params.action);

  const prepared = await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({
      where: { eveSessionId: params.ctx.session.id },
      select: { id: true, ownerUserId: true },
    });
    if (!session || session.ownerUserId !== params.ownerUserId) {
      throw new Error("The agent session is unavailable.");
    }

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
        agentSessionId: session.id,
        operationKey,
        ownerUserId: params.ownerUserId,
        status: AgentOperationStatus.RUNNING,
      },
      select: { id: true },
    });
    const audit = await tx.agentActionAudit.create({
      data: {
        action: params.action,
        agentSessionId: session.id,
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
  });

  if (!("operationId" in prepared)) return prepared.replay;

  try {
    const output = params.outputSchema.parse(await params.execute());
    const outputRecord =
      typeof output === "object" && output !== null && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : null;
    await prisma.$transaction([
      prisma.agentOperation.update({
        where: { id: prepared.operationId },
        data: {
          completedAt: new Date(),
          result: toInputJson(output),
          status: AgentOperationStatus.SUCCEEDED,
        },
      }),
      prisma.agentActionAudit.update({
        where: { id: prepared.auditId },
        data: {
          completedAt: new Date(),
          outputSummary: toInputJson({
            kind: typeof outputRecord?.kind === "string" ? outputRecord.kind : "completed",
          }),
          status: AgentActionStatus.SUCCEEDED,
        },
      }),
    ]);
    return output;
  } catch (error) {
    await prisma.$transaction([
      prisma.agentOperation.update({
        where: { id: prepared.operationId },
        data: {
          completedAt: new Date(),
          failureReason: "Tool execution failed; inspect current state before retrying.",
          status: AgentOperationStatus.FAILED,
        },
      }),
      prisma.agentActionAudit.update({
        where: { id: prepared.auditId },
        data: {
          completedAt: new Date(),
          failureReason: "Tool execution failed; details omitted from the audit record.",
          status: AgentActionStatus.FAILED,
        },
      }),
    ]);
    throw error;
  }
}
