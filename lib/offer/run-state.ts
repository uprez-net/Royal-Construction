type RunStatusLike = "RUNNING" | "COMPLETED" | "FAILED" | null | undefined;

type OfferRunState = {
  runId: string | null;
  runStatus: RunStatusLike;
};

type ReuseRunDecision = {
  kind: "reuse";
  runId: string;
  message: string;
};

type StartRunDecision = {
  kind: "start";
  clearStaleRun: boolean;
};

export type OfferRunStartDecision = ReuseRunDecision | StartRunDecision;

/**
 * Decide whether to reuse an existing running offer creation workflow or start a new one.
 * @param state - current run state containing runId and runStatus
 * @returns decision object indicating `reuse` or `start` with metadata
 */
export function getOfferRunStartDecision(
  state: OfferRunState,
): OfferRunStartDecision {
  if (state.runId && state.runStatus === "RUNNING") {
    return {
      kind: "reuse",
      runId: state.runId,
      message: "Offer creation workflow already in progress",
    };
  }

  return {
    kind: "start",
    clearStaleRun: Boolean(state.runId),
  };
}

