// Hermes: the owner's personal assistant, on its own server. Two directions,
// each with its own secret, both read from the environment. Node-clean (no
// Next, no `server-only`) so the voice-agent route and a test build the same.
//
//   Hermes → Royal   HERMES_MCP_SECRET
//     Sent by Hermes in the X-Hermes-Secret header on the operations agent's
//     MCP channel (/eve/v1/mcp), beside its Clerk token. It marks Hermes's
//     session (agent/lib/mcp-auth-policy.ts), and only such a session is
//     offered the owner-call tools (agent/tools/owner_calls.ts). Unset: no
//     caller is Hermes.
//
//   Royal → Hermes   HERMES_SERVER_MCP_URL, HERMES_SERVER_MCP_TOKEN
//     Hermes's API server (its base URL; /v1/chat/completions is added) and
//     that server's API key. On a briefing call, a question the owner asks
//     that the briefing does not cover is sent there as a chat completion.
//     Unset: Mili answers from the briefing only.
//     The names still say MCP because that is how they are set in Vercel;
//     the server is not an MCP server. Keep the names.
//
// docs/hermes-owner-calls.md is the contract.

/** A secret shorter than this is reported and the endpoint stays off. */
export const HERMES_SECRET_MIN_LENGTH = 32;

export type HermesConfig = {
  /** What Hermes sends to Royal. Null: no caller is ever Hermes. */
  readonly inboundSecret: string | null;
  /** Hermes's API server, for Mili's follow-up questions. Null: not connected. */
  readonly server: {
    readonly url: string;
    readonly token: string;
  } | null;
  /** Misconfigurations worth a log line, never containing a secret. */
  readonly problems: readonly string[];
};

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

export function readHermesConfig(env: Env = process.env): HermesConfig {
  const problems: string[] = [];

  let inboundSecret = value(env, "HERMES_MCP_SECRET");
  if (inboundSecret && inboundSecret.length < HERMES_SECRET_MIN_LENGTH) {
    problems.push(
      `HERMES_MCP_SECRET must be at least ${HERMES_SECRET_MIN_LENGTH} random characters; Hermes can't place owner calls until it is.`,
    );
    inboundSecret = null;
  }

  const rawUrl = value(env, "HERMES_SERVER_MCP_URL");
  const token = value(env, "HERMES_SERVER_MCP_TOKEN");
  let server: HermesConfig["server"] = null;
  if (rawUrl) {
    let url: URL | null = null;
    try {
      url = new URL(rawUrl);
    } catch {
      problems.push("HERMES_SERVER_MCP_URL is not a URL.");
    }
    // https or http. Plain http is allowed because Hermes has no domain yet and
    // answers on its server's IP; it still connects, but the admin panel says
    // the token and the owner's questions are travelling unencrypted.
    if (url && url.protocol !== "https:" && url.protocol !== "http:") {
      problems.push("HERMES_SERVER_MCP_URL must be an https or http URL.");
      url = null;
    }
    if (
      url
      && url.protocol === "http:"
      && url.hostname !== "localhost"
      && token
    ) {
      problems.push(
        "HERMES_SERVER_MCP_URL is plain http, so Hermes's key and the owner's questions travel unencrypted. Switch it to https once Hermes has a domain.",
      );
    }
    if (url && (url.username || url.password)) {
      problems.push(
        "HERMES_SERVER_MCP_URL must not carry a username or password; put the credential in HERMES_SERVER_MCP_TOKEN.",
      );
      url = null;
    }
    if (url && !token) {
      problems.push(
        "HERMES_SERVER_MCP_TOKEN is not set, so Mili can't ask Hermes anything.",
      );
    }
    if (url && token) {
      server = { token, url: url.toString() };
    }
  }
  return { inboundSecret, problems, server };
}
