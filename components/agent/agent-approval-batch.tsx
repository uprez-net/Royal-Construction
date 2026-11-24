"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentInputResponse } from "@/components/agent/agent-approval";
import {
  approvalBatchFor,
  type AgentApprovalBatch,
  type AgentTranscriptData,
} from "@/components/agent/agent-reducer";

type BatchLookup = (requestId: string) => AgentApprovalBatch | null;

const ApprovalBatchContext = createContext<BatchLookup>(() => null);

/**
 * Hands every approval card the step it came from (#616).
 *
 * eve resumes a step only once every approval in it has an answer. On 24 Nov
 * 2026 the office approved one of five milestone changes from one step, the
 * card said "Approved", and none of the five ran. A card needs its siblings to
 * say so, and they are not in its props: each approval renders inside its own
 * tool call, several layers down.
 */
export function AgentApprovalBatchProvider({
  children,
  data,
}: {
  children: ReactNode;
  data: Pick<AgentTranscriptData, "approvalBatches" | "pendingApprovals">;
}) {
  const lookup: BatchLookup = (requestId) => approvalBatchFor(data, requestId);
  return (
    <ApprovalBatchContext.Provider value={lookup}>
      {children}
    </ApprovalBatchContext.Provider>
  );
}

export function useApprovalBatch(requestId: string) {
  return useContext(ApprovalBatchContext)(requestId);
}

/**
 * The step's own controls, shown once, on the first card still waiting.
 *
 * "Approve all" is withheld when any change in the step is an email or a
 * message: those are approved one at a time, after reading the body and (for
 * an email) re-checking its files, and a bulk button would skip both.
 */
export function AgentApprovalBatchControls({
  batch,
  bulkApproveBlocked,
  canRespond,
  onRespond,
}: {
  batch: AgentApprovalBatch;
  bulkApproveBlocked: boolean;
  canRespond: boolean;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<"approve" | "cancel" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const waiting = batch.pending.length;
  const total = batch.requestIds.length;
  const answered = total - waiting;
  const approveIds = batch.pending.map((item) => item.approveOptionId);
  const cancelIds = batch.pending.map((item) => item.cancelOptionId);
  const canApproveAll =
    !bulkApproveBlocked && approveIds.every((id) => id !== null);
  const canCancelAll = cancelIds.every((id) => id !== null);
  const busy = !canRespond || submitting !== null;

  async function respondAll(decision: "approve" | "cancel") {
    if (submitting) return;
    setSubmitting(decision);
    setError(null);
    try {
      await onRespond(
        batch.pending.map((item) => ({
          optionId:
            (decision === "approve"
              ? item.approveOptionId
              : item.cancelOptionId) ?? decision,
          requestId: item.requestId,
        })),
      );
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "The answers could not be sent. Try again.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      aria-label="Changes from the same step"
      className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/80 p-2.5"
      role="group"
    >
      <p className="flex items-start gap-2 text-xs text-foreground">
        <Layers
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
        <span>
          {answered > 0
            ? `${waiting} of these ${total} changes still need an answer. `
            : `These ${total} changes were asked for together. `}
          The agent runs none of them, not even one you approve, until every one
          is answered.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {canApproveAll ? (
          <Button
            disabled={busy}
            onClick={() => void respondAll("approve")}
            size="sm"
            type="button"
          >
            {submitting === "approve" ? "Approving…" : `Approve all ${waiting}`}
          </Button>
        ) : null}
        {canCancelAll ? (
          <Button
            disabled={busy}
            onClick={() => void respondAll("cancel")}
            size="sm"
            type="button"
            variant="outline"
          >
            {submitting === "cancel" ? "Cancelling…" : `Cancel all ${waiting}`}
          </Button>
        ) : null}
      </div>
      {bulkApproveBlocked ? (
        <p className="text-xs text-muted-foreground">
          This step includes an email or a message, so each one is approved on
          its own card.
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
