import path from "node:path";

// The bridge's configuration, read once from the environment at start-up.
//
// Every secret here is generated for this deployment (see README.md, "Tokens")
// and shared with the Royal app's environment under the names in brackets:
//
//   BRIDGE_API_TOKEN      (WHATSAPP_BRIDGE_API_TOKEN)      app → bridge
//   BRIDGE_WEBHOOK_SECRET (WHATSAPP_BRIDGE_WEBHOOK_SECRET) bridge → app
//
// A missing or short API token refuses to start: an unauthenticated bridge
// would let anyone on the internet post into a client's group.

export type BridgeConfig = {
  readonly port: number;
  readonly host: string;
  readonly apiToken: string;
  /** The app's `/api/whatsapp-bridge/webhook`. Null: events are queued, not sent. */
  readonly appWebhookUrl: string | null;
  readonly webhookSecret: string | null;
  /** Baileys auth state, mappings, the event outbox and media. A volume. */
  readonly dataDir: string;
  /** Downloaded group files are kept this long for the app to fetch. */
  readonly mediaRetentionDays: number;
  /** A file larger than this is announced but not downloaded. */
  readonly mediaMaxBytes: number;
  readonly logLevel: string;
};

export const MIN_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = value(env, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readConfig(env: Env = process.env): BridgeConfig {
  const apiToken = value(env, "BRIDGE_API_TOKEN");
  if (!apiToken || apiToken.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BRIDGE_API_TOKEN must be set to at least ${MIN_SECRET_LENGTH} characters (openssl rand -hex 32).`,
    );
  }
  const webhookSecret = value(env, "BRIDGE_WEBHOOK_SECRET");
  if (webhookSecret && webhookSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BRIDGE_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  const appWebhookUrl = value(env, "APP_WEBHOOK_URL");
  if (appWebhookUrl) {
    const url = new URL(appWebhookUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("APP_WEBHOOK_URL must be https (or localhost).");
    }
    if (!webhookSecret) {
      throw new Error(
        "BRIDGE_WEBHOOK_SECRET is required when APP_WEBHOOK_URL is set: the app refuses unsigned events.",
      );
    }
  }

  return {
    apiToken,
    appWebhookUrl,
    dataDir: path.resolve(value(env, "DATA_DIR") ?? "./data"),
    host: value(env, "HOST") ?? "0.0.0.0",
    logLevel: value(env, "LOG_LEVEL") ?? "info",
    mediaMaxBytes: positiveInt(env, "MEDIA_MAX_BYTES", 100 * 1024 * 1024),
    mediaRetentionDays: positiveInt(env, "MEDIA_RETENTION_DAYS", 14),
    port: positiveInt(env, "PORT", 8080),
    webhookSecret,
  };
}
