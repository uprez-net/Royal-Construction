import type {
  WhatsAppBusinessNumber,
  WhatsAppChannel,
} from "@/lib/domain/ports/whatsapp";
import { waIdToE164 } from "@/lib/domain/leads/whatsapp/phone";

// WhatsApp Business configuration, read from the environment (issue #333).
//
// Node-safe on purpose — no `server-only`, no Next. Eve constructs the same
// port the App does (agent/lib/lead-whatsapp-operations.ts), and `eve build`
// loads this module with Node's own ESM loader.
//
// Secrets stay in the deployment's environment and inside the adapter. What
// the rest of the app sees is `WhatsAppChannel`: which numbers exist and
// whether this runtime can send. `.env.example` documents every variable, and
// docs/whatsapp-runbook.md says where each value comes from in Meta.

export const DEFAULT_WHATSAPP_GRAPH_API_VERSION = "v23.0";

/**
 * Meta's own ceiling is 100 MB (documents); photos are 5 MB and video and
 * voice notes 16 MB. A file over the limit is recorded but not copied.
 */
export const DEFAULT_WHATSAPP_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export type WhatsAppConfig = {
  /** WHATSAPP_ENABLED === "true". Anything else leaves the channel off. */
  readonly enabled: boolean;
  readonly channel: WhatsAppChannel | null;
  readonly accessToken: string | null;
  readonly appSecret: string | null;
  readonly verifyToken: string | null;
  readonly businessAccountId: string | null;
  readonly apiVersion: string;
  /** Largest inbound file copied into Blob storage. */
  readonly mediaMaxBytes: number;
  /** Misconfigurations worth a log line, never containing a secret. */
  readonly problems: readonly string[];
};

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

/**
 * Parse WHATSAPP_PHONE_NUMBERS.
 *
 * `<phone_number_id>=<E.164 display number>=<label>`, comma-separated:
 *
 *   WHATSAPP_PHONE_NUMBERS="109876543210987=+61280001234=Office,…"
 *
 * A malformed entry is dropped and reported rather than half-used: routing an
 * inbound message to the wrong number, or sending from one, is worse than not
 * offering it.
 */
export function parseWhatsAppPhoneNumbers(raw: string | null): {
  numbers: WhatsAppBusinessNumber[];
  problems: string[];
} {
  const numbers: WhatsAppBusinessNumber[] = [];
  const problems: string[] = [];
  if (!raw) return { numbers, problems };

  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry, index) => {
      const [id, display, ...labelParts] = entry
        .split("=")
        .map((part) => part.trim());
      const label = labelParts.join("=").trim();
      const e164 = waIdToE164(display);
      if (!id || !/^\d+$/.test(id)) {
        problems.push(
          `WHATSAPP_PHONE_NUMBERS entry ${index + 1} has no numeric phone_number_id.`,
        );
        return;
      }
      if (!e164) {
        problems.push(
          `WHATSAPP_PHONE_NUMBERS entry ${index + 1} (${id}) has no valid E.164 display number.`,
        );
        return;
      }
      if (numbers.some((number) => number.phoneNumberId === id)) {
        problems.push(
          `WHATSAPP_PHONE_NUMBERS lists phone_number_id ${id} more than once.`,
        );
        return;
      }
      numbers.push({
        displayNumber: e164,
        label: label || e164,
        phoneNumberId: id,
      });
    });
  return { numbers, problems };
}

export function readWhatsAppConfig(env: Env = process.env): WhatsAppConfig {
  const enabled = env.WHATSAPP_ENABLED?.trim() === "true";
  const apiVersion =
    value(env, "WHATSAPP_GRAPH_API_VERSION")
    ?? DEFAULT_WHATSAPP_GRAPH_API_VERSION;
  const accessToken = value(env, "WHATSAPP_ACCESS_TOKEN");
  const appSecret = value(env, "WHATSAPP_APP_SECRET");
  const verifyToken = value(env, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  const businessAccountId = value(env, "WHATSAPP_BUSINESS_ACCOUNT_ID");
  const requestedMax = Number(value(env, "WHATSAPP_MEDIA_MAX_BYTES") ?? "");
  const mediaMaxBytes =
    Number.isInteger(requestedMax) && requestedMax > 0
      ? requestedMax
      : DEFAULT_WHATSAPP_MEDIA_MAX_BYTES;

  if (!enabled) {
    return {
      accessToken: null,
      apiVersion,
      appSecret: null,
      businessAccountId: null,
      channel: null,
      enabled: false,
      mediaMaxBytes,
      problems: [],
      verifyToken: null,
    };
  }

  const problems: string[] = [];
  const parsed = parseWhatsAppPhoneNumbers(
    value(env, "WHATSAPP_PHONE_NUMBERS"),
  );
  problems.push(...parsed.problems);
  if (parsed.numbers.length === 0) {
    problems.push(
      "WHATSAPP_PHONE_NUMBERS configures no usable business number.",
    );
  }

  const requestedDefault = value(env, "WHATSAPP_DEFAULT_PHONE_NUMBER_ID");
  const defaultNumber = requestedDefault
    ? parsed.numbers.find((number) => number.phoneNumberId === requestedDefault)
    : parsed.numbers[0];
  if (requestedDefault && !defaultNumber) {
    problems.push(
      "WHATSAPP_DEFAULT_PHONE_NUMBER_ID is not one of WHATSAPP_PHONE_NUMBERS; using the first configured number.",
    );
  }

  if (!accessToken)
    problems.push("WHATSAPP_ACCESS_TOKEN is not set; sending is unavailable.");
  if (!appSecret)
    problems.push(
      "WHATSAPP_APP_SECRET is not set; the webhook rejects every delivery.",
    );
  if (!verifyToken)
    problems.push(
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set; webhook verification fails.",
    );

  const templates = value(env, "WHATSAPP_ENABLED_TEMPLATES");
  const groupsEnabled = env.WHATSAPP_GROUPS_ENABLED?.trim() === "true";
  const callingEnabled = env.WHATSAPP_CALLING_ENABLED?.trim() === "true";

  return {
    accessToken,
    apiVersion,
    appSecret,
    businessAccountId,
    channel:
      parsed.numbers.length === 0
        ? null
        : {
            defaultPhoneNumberId: (defaultNumber ?? parsed.numbers[0])
              .phoneNumberId,
            enabledTemplateNames: templates
              ? templates
                  .split(",")
                  .map((name) => name.trim())
                  .filter(Boolean)
              : null,
            callingEnabled,
            groupsEnabled,
            numbers: parsed.numbers,
            sendingAvailable: Boolean(accessToken),
          },
    enabled,
    mediaMaxBytes,
    problems,
    verifyToken,
  };
}

/** The non-secret channel for reads, or null when WhatsApp is off. */
export function whatsappChannelFromEnv(
  env: Env = process.env,
): WhatsAppChannel | null {
  return readWhatsAppConfig(env).channel;
}
