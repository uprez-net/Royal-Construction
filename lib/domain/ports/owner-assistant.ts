/**
 * The owner's own assistant — Hermes, on its own server — reached from a
 * briefing call when the owner asks Mili something her briefing does not
 * cover ("what time is that meeting again?", "who else is coming?").
 *
 * A port because the transport (Hermes's API server, a bearer token) is an
 * adapter's business (lib/hermes). The contract: one question in, one
 * plain-text answer out, or a throw. An empty answer is a throw too: Mili is
 * told she could not check, never that there is nothing to say.
 */
export type OwnerAssistantPort = {
  readonly ask: (request: OwnerAssistantQuestion) => Promise<string>;
  /**
   * Pass Hermes what an owner call left for it once the call has ended
   * (calls/owner-call-handoff.ts). Resolves to Hermes's reply once it has
   * taken it; throws when it did not. Hermes acts on it through its own tools
   * on Royal's MCP channel, not through this reply.
   */
  readonly handOff: (handoff: OwnerAssistantHandoff) => Promise<string>;
};

export type OwnerAssistantHandoff = {
  /** Royal's OwnerCallHandoff.id: Hermes names it back on every tool call. */
  readonly handoffId: string;
  /** Royal's Call.id, for Hermes's logs. */
  readonly callId: string | null;
  /** Hermes's own id for the task the call was about, when it gave one. */
  readonly reference: string | null;
  /** What Hermes is asked to do with it: Royal's rules, as text. */
  readonly instructions: string;
  /** The call and what the owner asked for on it: data, not instructions. */
  readonly body: string;
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
