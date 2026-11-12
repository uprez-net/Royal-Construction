import { timingSafeEqual } from "node:crypto";

// The wire between an Eve tool and the app route that expires caches for it.
// Shared by both ends so the path, the credential and the URL rules cannot
// drift. Node-clean: Eve's bundle imports it.

export const AGENT_EFFECTS_PATH = "/api/agent/effects";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The bearer both ends agree on.
 *
 * `AGENT_EFFECTS_SECRET` when set; otherwise `CRON_SECRET`, which every
 * environment already has and which already means "an internal caller of this
 * deployment". Falling back keeps the feature from silently doing nothing on
 * a deployment nobody remembered to configure.
 */
export function agentEffectsSecret(env: Env = process.env): string | null {
  return env.AGENT_EFFECTS_SECRET?.trim() || env.CRON_SECRET?.trim() || null;
}

export function isAuthorizedEffectsRequest(
  authorization: string | null,
  env: Env = process.env,
): boolean {
  const secret = agentEffectsSecret(env);
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Where this deployment's app answers.
 *
 * A preview deployment talks to itself (`VERCEL_URL`), never to production's
 * public URL: expiring production's caches from a preview would be harmless,
 * but re-indexing production's context from preview ids would not.
 */
export function agentEffectsUrl(env: Env = process.env): string | null {
  const explicit = env.AGENT_EFFECTS_URL?.trim();
  if (explicit) return explicit;
  const origin =
    env.VERCEL_ENV === "preview" && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin) return null;
  try {
    return new URL(AGENT_EFFECTS_PATH, new URL(origin).origin).toString();
  } catch {
    return null;
  }
}
