/**
 * The owner's own assistant — Hermes, on its own server — reached from a
 * briefing call when the owner asks Mili something her briefing does not
 * cover ("what time is that meeting again?", "who else is coming?").
 *
 * A port because the transport (Hermes's MCP server, a bearer token) is an
 * adapter's business (lib/hermes). The contract: one question in, one
 * plain-text answer out, or a throw. An empty answer is a throw too: Mili is
 * told she could not check, never that there is nothing to say.
 */
export type OwnerAssistantPort = {
  readonly ask: (request: OwnerAssistantQuestion) => Promise<string>;
};

export type OwnerAssistantQuestion = {
  /** What the owner asked, in the words the call desk heard. */
  readonly question: string;
  /**
   * What the call is about, so Hermes can answer without guessing which of
   * its tasks this is: the subject, agenda and its own reference.
   */
  readonly context: string;
  /** Hermes's own id for the task or event, when it gave one. */
  readonly reference: string | null;
  /** Royal's Call.id, for Hermes's logs. */
  readonly callId: string;
};
