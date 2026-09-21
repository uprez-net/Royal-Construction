function normalizeResource(resource: string | undefined): string {
  const withoutOrigin = (resource ?? "")
    .trim()
    .replace(/^https?:\/\/graph\.microsoft\.com\/v1\.0(?:\/|$)/i, "")
    .split(/[?#]/, 1)[0]
    .replace(/^\/+|\/+$/g, "");

  try {
    return decodeURIComponent(withoutOrigin).toLowerCase();
  } catch {
    // A malformed escape should not make the webhook handler throw. The
    // undecoded value can still be compared safely below.
    return withoutOrigin.toLowerCase();
  }
}

function mailboxIdentity(
  resource: string,
  senderUpn: string | undefined,
): string | null {
  const usersMatch = resource.match(
    /(?:^|\/)users(?:\/([^/]+)|\(([^)]+)\))(?:\/|$)/i,
  );
  if (usersMatch) {
    return (usersMatch[1] ?? usersMatch[2]).replace(/^['"]|['"]$/g, "");
  }

  if (resource === "me" || resource.startsWith("me/")) {
    return senderUpn?.trim().toLowerCase() || null;
  }

  return null;
}

function isMessageResource(resource: string): boolean {
  return /(?:^|\/)messages(?:\/|\(|$)/i.test(resource);
}

/**
 * Graph may encode the UPN in one resource and leave it unencoded in the
 * notification, or omit the subscribed Inbox folder from the notification
 * resource. Compare the collection first, then fall back to the mailbox
 * identity while still requiring a message resource.
 */
export function graphResourceBelongsToMailbox(
  resource: string | undefined,
  subscriptionResource: string | undefined,
  senderUpn?: string,
): boolean {
  const messageResource = normalizeResource(resource);
  const mailboxResource = normalizeResource(subscriptionResource);

  if (!messageResource || !mailboxResource) {
    return false;
  }

  if (
    messageResource === mailboxResource ||
    messageResource.startsWith(`${mailboxResource}/`)
  ) {
    return true;
  }

  if (!isMessageResource(messageResource)) {
    return false;
  }

  const expectedMailbox = mailboxIdentity(mailboxResource, senderUpn);
  const actualMailbox = mailboxIdentity(messageResource, senderUpn);

  if (!expectedMailbox || !actualMailbox) {
    return false;
  }

  if (expectedMailbox === actualMailbox) {
    return true;
  }

  // Microsoft Graph commonly creates the subscription with a UPN but sends
  // the notification resource with the mailbox's opaque directory object ID:
  // `/users/{upn}/messages` -> `Users('{object-id}')/messages('{id}')`.
  // The distinct, secret clientState has already selected this mailbox, so a
  // message resource whose identity is opaque cannot be rejected as a foreign
  // mailbox merely because its ID cannot be derived from the UPN locally.
  return expectedMailbox.includes("@") && !actualMailbox.includes("@");
}
