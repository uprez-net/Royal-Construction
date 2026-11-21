// The WhatsApp bridge's configuration, read from the environment.
//
// Node-safe on purpose — no `server-only`, no Next — because Eve builds the
// same port (agent/lib/offer-operations.ts) and `eve build` loads this module
// with Node's own ESM loader. `.env.example` documents each variable and
// services/whatsapp-bridge/README.md says where each value comes from.

export const MIN_BRIDGE_SECRET_LENGTH = 32;

export type WhatsAppBridgeConfig = {
  /** URL and token both set: project groups are on in this runtime. */
  readonly enabled: boolean;
  /** WHATSAPP_BRIDGE_URL, without a trailing slash. */
  readonly url: string | null;
  readonly apiToken: string | null;
  /** Verifies the events the bridge POSTs to /api/whatsapp-bridge/webhook. */
  readonly webhookSecret: string | null;
  /** Misconfigurations worth showing an admin. Never contains a secret. */
  readonly problems: readonly string[];
};

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

export function readWhatsAppBridgeConfig(
  env: Env = process.env,
): WhatsAppBridgeConfig {
  const problems: string[] = [];
  let url = value(env, "WHATSAPP_BRIDGE_URL");
  const apiToken = value(env, "WHATSAPP_BRIDGE_API_TOKEN");
  const webhookSecret = value(env, "WHATSAPP_BRIDGE_WEBHOOK_SECRET");

  if (url) {
    try {
      const parsed = new URL(url);
      const local =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !local) {
        problems.push(
          "WHATSAPP_BRIDGE_URL must be https: the API token travels with every call.",
        );
        url = null;
      } else {
        url = url.replace(/\/+$/, "");
      }
    } catch {
      problems.push("WHATSAPP_BRIDGE_URL is not a valid URL.");
      url = null;
    }
  }
  if (url && !apiToken) {
    problems.push(
      "WHATSAPP_BRIDGE_API_TOKEN is not set, so the app cannot call the bridge.",
    );
  }
  if (apiToken && !url) {
    problems.push(
      "WHATSAPP_BRIDGE_API_TOKEN is set but WHATSAPP_BRIDGE_URL is not.",
    );
  }
  if (url && apiToken && !webhookSecret) {
    problems.push(
      "WHATSAPP_BRIDGE_WEBHOOK_SECRET is not set; the webhook refuses every event, so no group message reaches the app.",
    );
  }
  for (const [name, secret] of [
    ["WHATSAPP_BRIDGE_API_TOKEN", apiToken],
    ["WHATSAPP_BRIDGE_WEBHOOK_SECRET", webhookSecret],
  ] as const) {
    if (secret && secret.length < MIN_BRIDGE_SECRET_LENGTH) {
      problems.push(
        `${name} is shorter than ${MIN_BRIDGE_SECRET_LENGTH} characters; generate it with openssl rand -hex 32.`,
      );
    }
  }

  return {
    apiToken,
    enabled: Boolean(url && apiToken),
    problems,
    url,
    webhookSecret,
  };
}
