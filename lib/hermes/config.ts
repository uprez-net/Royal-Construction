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
//   Royal → Hermes   HERMES_SERVER_MCP_URL, HERMES_SERVER_MCP_TOKEN,
//                    HERMES_SERVER_MCP_TOOL (default "ask")
//     Hermes's own MCP server. On a briefing call, a question the owner asks
//     that the briefing does not cover is passed to that tool. Unset: Mili
//     answers from the briefing only.
//
// docs/hermes-owner-calls.md is the contract.

/** A secret shorter than this is reported and the endpoint stays off. */
export const HERMES_SECRET_MIN_LENGTH = 32;

export const HERMES_DEFAULT_ASK_TOOL = "ask";

export type HermesConfig = {
  /** What Hermes sends to Royal. Null: no caller is ever Hermes. */
  readonly inboundSecret: string | null;
  /** Hermes's MCP server, for Mili's follow-up questions. Null: not connected. */
  readonly server: {
    readonly url: string;
    readonly token: string;
    readonly askTool: string;
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
    // https only; plain http only to localhost, for running Hermes locally.
    if (
      url
      && url.protocol !== "https:"
      && !(url.protocol === "http:" && url.hostname === "localhost")
    ) {
      problems.push(
        "HERMES_SERVER_MCP_URL must be https (or http://localhost for local development): the token and the owner's questions travel on it.",
      );
      url = null;
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
      server = {
        askTool:
          value(env, "HERMES_SERVER_MCP_TOOL") ?? HERMES_DEFAULT_ASK_TOOL,
        token,
        url: url.toString(),
      };
    }
  }
  return { inboundSecret, problems, server };
}
