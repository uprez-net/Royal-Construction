// Which deployment a notification belongs to, and who may receive it there.
//
// Production and staging share one Novu application, so without this a
// notification raised on staging lands in the same inbox as production's.
// Pure, with no server imports: the browser derives its inbox from the same
// rule the server sends by.

export const PRODUCTION_ORIGIN = "https://royal-construction-chi.vercel.app";
export const STAGING_ORIGIN = "https://royal-stage.vercel.app";

const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).hostname;

export type NotificationEnvironment = "production" | "staging" | "development";

/**
 * Developer and test accounts that production never notifies. Every send to
 * them was a Novu event nobody needed; staging still notifies them, because
 * there they are the people testing.
 */
export const PRODUCTION_MUTED_EMAILS: readonly string[] = [
  "citizen_techies_member+clerk_test@example.com",
  "syed.abdul@uprez.net",
  "khushisingh2104@gmail.com",
  "mannansyed660@gmail.com",
  "hassanfarhat986@gmail.com",
];

/**
 * Where this server runs. `APP_ENV=staging` is what the staging deployment
 * sets (it also drives the sandbox banner), and is checked first because a
 * staging project can report `VERCEL_ENV=production` for its own domain.
 */
export function notificationEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): NotificationEnvironment {
  if (env.APP_ENV === "staging") return "staging";
  if (env.VERCEL_ENV === "production") return "production";
  return "development";
}

/** The origin a server's notifications belong to. */
export function serverNotificationOrigin(
  env: Readonly<Record<string, string | undefined>>,
): string {
  switch (notificationEnvironment(env)) {
    case "production":
      return PRODUCTION_ORIGIN;
    case "staging":
      return STAGING_ORIGIN;
    case "development": {
      // A branch preview is reached on its branch alias; local dev on its
      // own machine. Only the host matters (see notificationSubscriberId).
      const preview = env.VERCEL_BRANCH_URL ?? env.VERCEL_URL;
      return preview
        ? `https://${preview}`
        : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost");
    }
  }
}

/**
 * The Novu subscriber a person's inbox is on, for one origin.
 *
 * Production keeps the bare Clerk id, so its existing inbox and history stay
 * where they are; every other origin gets its own subscriber, prefixed with
 * its host. The inbox a browser opens is the one for the origin it is on, so
 * staging's notifications can only ever be read on staging and production's
 * on production. Only the host counts: local dev on port 3000 and on 3001 is
 * one inbox.
 */
export function notificationSubscriberId(
  clerkId: string,
  origin: string,
): string {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    host = origin;
  }
  return host === PRODUCTION_HOST ? clerkId : `${host}:${clerkId}`;
}

export type NotificationRecipient = {
  readonly clerkId: string;
  readonly email: string;
};

/**
 * Who actually gets a notification in this environment.
 *
 * - Production: everyone it was meant for, less the muted test accounts.
 * - Staging and development: only the person whose action raised it, so
 *   testing never fans out to the whole team (or to Novu's bill). Nothing is
 *   sent when nobody is signed in: a cron or a webhook on staging notifies
 *   no one.
 */
export function selectNotificationRecipients(input: {
  readonly environment: NotificationEnvironment;
  readonly recipients: readonly NotificationRecipient[];
  readonly requester: NotificationRecipient | null;
}): NotificationRecipient[] {
  if (input.environment !== "production") {
    return input.requester ? [input.requester] : [];
  }
  const muted = new Set(
    PRODUCTION_MUTED_EMAILS.map((email) => email.toLowerCase()),
  );
  return input.recipients.filter(
    (recipient) => !muted.has(recipient.email.trim().toLowerCase()),
  );
}
