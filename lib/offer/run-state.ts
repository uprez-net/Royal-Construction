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

