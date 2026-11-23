// Reading an inbound call's transcript and saying which of the caller's
// projects it was about, as a capability the domain is handed rather than a
// model it imports (lib/model.ts reaches the AI gateway, which a command must
// not). The app's adapter is lib/comms/project-call-matcher.ts.
//
// The port only ever chooses among the candidates it is given. The command
// (lib/domain/comms/calls/project-matching.ts) builds that list from the
// caller's number alone and drops any answer that is not on it, so a model
// that names some other project files the call nowhere.

export type ProjectCallCandidate = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly status: string;
  /** How the caller is connected to it: "owner", "site manager", "tradie (Plumber)". */
  readonly callerRoles: readonly string[];
};

export type ProjectCallMatchInput = {
  /** Mili's transcript and any recording's, "Speaker: text" per line. */
  readonly transcript: string;
  /** The names the caller's number is on file under. */
  readonly callerNames: readonly string[];
  readonly candidates: readonly ProjectCallCandidate[];
};

export type ProjectCallMatchAnswer = {
  /** One of the candidates' ids, or null when it is about none of them. */
  readonly projectId: string | null;
  /** One sentence the office reads: why this project, or why none. */
  readonly reason: string;
};

/** Throws when the model could not be asked; the command counts the attempt. */
export type ProjectCallMatcherPort = (
  input: ProjectCallMatchInput,
) => Promise<ProjectCallMatchAnswer>;
