import { availableWhatsAppTemplates } from "@/lib/domain/leads/whatsapp/templates";
import { projectWhatsAppGroupAvailability } from "@/lib/domain/projects/whatsapp/groups";

import { readWhatsAppConfig, type WhatsAppConfig } from "./config";

// What Admin › WhatsApp shows: how this deployment is configured, and what
// Meta says about the account right now. Read-only, and it never returns a
// secret — only whether each one is set.

export const WHATSAPP_WEBHOOK_PATH = "/api/whatsapp/webhook";

/** The webhook fields the Meta app must subscribe for each feature. */
export const WHATSAPP_WEBHOOK_FIELDS = {
  groups: [
    "group_lifecycle_update",
    "group_participants_update",
    "group_settings_update",
    "group_status_update",
  ],
  messages: ["messages"],
} as const;

export type WhatsAppFeature = {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly detail: string;
};

export type WhatsAppAdminConfig = {
  readonly enabled: boolean;
  readonly numbers: readonly {
    readonly label: string;
    readonly displayNumber: string;
    readonly phoneNumberId: string;
    readonly isDefault: boolean;
  }[];
  readonly businessAccountId: string | null;
  readonly apiVersion: string;
  readonly secrets: {
    readonly accessToken: boolean;
    readonly appSecret: boolean;
    readonly verifyToken: boolean;
  };
  readonly webhook: {
    /** Null when NEXT_PUBLIC_APP_URL is not set, so the host is unknown. */
    readonly callbackUrl: string | null;
    readonly path: string;
    readonly fields: readonly string[];
  };
  readonly features: readonly WhatsAppFeature[];
  readonly templates: readonly string[];
  readonly problems: readonly string[];
};

export function whatsappAdminConfig(
  config: WhatsAppConfig = readWhatsAppConfig(),
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): WhatsAppAdminConfig {
  const channel = config.channel;
  const groups = projectWhatsAppGroupAvailability(channel);
  const base = appUrl?.trim().replace(/\/$/, "") || null;
  const mb = Math.floor(config.mediaMaxBytes / 1_048_576);
  const sending = Boolean(channel?.sendingAvailable);

  return {
    apiVersion: config.apiVersion,
    businessAccountId: config.businessAccountId,
    enabled: config.enabled,
    features: [
      {
        detail: sending
          ? "Message a lead from the leads list or the lead page; replies land on the lead."
          : "Needs WHATSAPP_ACCESS_TOKEN to send.",
        enabled: config.enabled && sending,
        key: "lead-messaging",
        label: "Lead conversations",
      },
      {
        detail:
          "Approved templates for outreach outside the 24-hour reply window.",
        enabled:
          config.enabled && availableWhatsAppTemplates(channel).length > 0,
        key: "templates",
        label: "Template messages",
      },
      {
        detail: `Photos, videos, voice notes and documents are copied to Blob storage (up to ${mb} MB each).`,
        enabled: config.enabled && Boolean(config.accessToken),
        key: "media",
        label: "Media attachments",
      },
      {
        detail: groups.available
          ? "Each new project gets a WhatsApp group; ongoing projects can create or link one."
          : (groups.reason ?? "Off."),
        enabled: groups.available,
        key: "groups",
        label: "Project groups",
      },
    ],
    numbers: (channel?.numbers ?? []).map((number) => ({
      displayNumber: number.displayNumber,
      isDefault: number.phoneNumberId === channel?.defaultPhoneNumberId,
      label: number.label,
      phoneNumberId: number.phoneNumberId,
    })),
    problems: config.problems,
    secrets: {
      accessToken: Boolean(config.accessToken),
      appSecret: Boolean(config.appSecret),
      verifyToken: Boolean(config.verifyToken),
    },
    templates: availableWhatsAppTemplates(channel).map(
      (template) => template.name,
    ),
    webhook: {
      callbackUrl: base ? `${base}${WHATSAPP_WEBHOOK_PATH}` : null,
      fields: [
        ...WHATSAPP_WEBHOOK_FIELDS.messages,
        ...(channel?.groupsEnabled ? WHATSAPP_WEBHOOK_FIELDS.groups : []),
      ],
      path: WHATSAPP_WEBHOOK_PATH,
    },
  };
}

export type WhatsAppNumberHealth = {
  readonly phoneNumberId: string;
  readonly ok: boolean;
  readonly error: string | null;
  readonly verifiedName: string | null;
  readonly displayPhoneNumber: string | null;
  readonly qualityRating: string | null;
  readonly messagingLimitTier: string | null;
  readonly nameStatus: string | null;
  readonly platformType: string | null;
  /** True when Meta reports an Official Business Account — groups need it. */
  readonly officialBusinessAccount: boolean | null;
};

export type WhatsAppMetaHealth = {
  readonly checkedAt: Date;
  readonly numbers: readonly WhatsAppNumberHealth[];
  /** Apps subscribed to the WhatsApp Business Account's webhooks. */
  readonly subscribedApps: readonly string[] | null;
  readonly subscribedAppsError: string | null;
};

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function graphGet(
  config: WhatsAppConfig,
  path: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: Json } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(
      `https://graph.facebook.com/${config.apiVersion}/${path}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Json & {
      error?: { message?: string; code?: number };
    };
    if (!response.ok) {
      return {
        error: `Meta answered ${response.status}${body.error?.code ? ` (code ${body.error.code})` : ""}: ${body.error?.message ?? "no detail"}`,
        ok: false,
      };
    }
    return { body, ok: true };
  } catch {
    return { error: "Meta could not be reached from this server.", ok: false };
  }
}

/**
 * Ask Meta about each configured number and the webhook subscription.
 * Null when there is no token to ask with.
 */
export async function checkWhatsAppWithMeta(
  config: WhatsAppConfig = readWhatsAppConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppMetaHealth | null> {
  if (!config.enabled || !config.accessToken || !config.channel) return null;

  const numbers = await Promise.all(
    config.channel.numbers.map(
      async (number): Promise<WhatsAppNumberHealth> => {
        const result = await graphGet(
          config,
          `${encodeURIComponent(number.phoneNumberId)}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,name_status,platform_type,is_official_business_account`,
          fetchImpl,
        );
        if (!result.ok) {
          return {
            displayPhoneNumber: null,
            error: result.error,
            messagingLimitTier: null,
            nameStatus: null,
            officialBusinessAccount: null,
            ok: false,
            phoneNumberId: number.phoneNumberId,
            platformType: null,
            qualityRating: null,
            verifiedName: null,
          };
        }
        const body = result.body;
        return {
          displayPhoneNumber: str(body.display_phone_number),
          error: null,
          messagingLimitTier: str(body.messaging_limit_tier),
          nameStatus: str(body.name_status),
          officialBusinessAccount:
            typeof body.is_official_business_account === "boolean"
              ? body.is_official_business_account
              : null,
          ok: true,
          phoneNumberId: number.phoneNumberId,
          platformType: str(body.platform_type),
          qualityRating: str(body.quality_rating),
          verifiedName: str(body.verified_name),
        };
      },
    ),
  );

  let subscribedApps: string[] | null = null;
  let subscribedAppsError: string | null = null;
  if (config.businessAccountId) {
    const result = await graphGet(
      config,
      `${encodeURIComponent(config.businessAccountId)}/subscribed_apps`,
      fetchImpl,
    );
    if (result.ok) {
      const data = Array.isArray(result.body.data) ? result.body.data : [];
      subscribedApps = data
        .map((row) => {
          const app = (row as Json).whatsapp_business_api_data as
            | Json
            | undefined;
          return str(app?.name) ?? str(app?.id);
        })
        .filter((name): name is string => Boolean(name));
    } else {
      subscribedAppsError = result.error;
    }
  } else {
    subscribedAppsError =
      "WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so the subscription can't be checked.";
  }

  return {
    checkedAt: new Date(),
    numbers,
    subscribedApps,
    subscribedAppsError,
  };
}
