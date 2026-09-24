// Inferring a project's type, description and budget from a lead, as a
// capability the domain is handed rather than a model the domain imports.
//
// `lib/agent/projectCreationAgent.ts` opens with `import "server-only"` and
// pulls the AI gateway, so a domain command that imported it would be
// unreachable from Eve, from a cron and from a test runner — and
// `tests/architecture/domain-boundary.test.ts` would fail on it.
//
// Nothing infers when the wizard already extracted the tender and contract:
// this is the fallback for a lead converted with no documents, and the whole
// port is optional for exactly that reason.

export type InferredProjectSpecs = {
  readonly projectDescription: string;
  readonly projectType: string;
  readonly projectBudget: number;
};

/**
 * Infer specs for a lead being converted, or answer `null`.
 *
 * `null` is a normal answer, not a failure: the command falls back to empty
 * strings and a zero budget, exactly as the previous implementation did when
 * the generation returned nothing. A caller that cannot run a model at all
 * passes {@link unavailableProjectInference}.
 */
export type ProjectInferencePort = (input: {
  readonly leadId: number;
}) => Promise<InferredProjectSpecs | null>;

/**
 * An inference port for a channel that cannot run one.
 *
 * Named rather than an inline `async () => null` so it reads as a deliberate
 * choice at the call site and greps as one.
 */
export const unavailableProjectInference: ProjectInferencePort = async () =>
  null;
