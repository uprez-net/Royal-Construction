import { notificationEnvironment } from "@/lib/notification/environment";
import { reportError } from "@/lib/observability/report-error";

/**
 * Domains that can never be a real person's inbox (RFC 2606 and 6761). In
 * September and October, mail with placeholder names left the building to
 * addresses like these because no send checked its recipients (#591).
 */
const RESERVED_DOMAINS = [
  "example.com",
  "example.net",
  "example.org",
  "localhost",
];
const RESERVED_TLDS = ["example", "invalid", "localhost", "test"];

type Recipients = string | readonly string[] | undefined;

/** The reserved-domain addresses among the recipients, as given. */
export function reservedRecipients(...lists: Recipients[]): string[] {
  return lists
    .flatMap((list) => (typeof list === "string" ? [list] : (list ?? [])))
    .filter((address) => {
      const domain = address
        .trim()
        .replace(/>$/, "")
        .split("@")
        .pop()
        ?.toLowerCase();
      if (!domain) return false;
      return (
        RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
        || RESERVED_TLDS.some((tld) => domain.endsWith(`.${tld}`))
      );
    });
}

/**
 * Refuses a send addressed to a reserved test domain, in production only.
 * Staging and local development send to such addresses on purpose.
 *
 * Reported as well as thrown: a caller that catches and carries on would
 * otherwise swallow the one signal that a real email did not go.
 */
export function assertDeliverableRecipients(
  recipients: { to?: Recipients; cc?: Recipients; bcc?: Recipients },
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (notificationEnvironment(env) !== "production") return;

  const reserved = reservedRecipients(
    recipients.to,
    recipients.cc,
    recipients.bcc,
  );
  if (reserved.length === 0) return;

  // The addresses stay out of the message: it is reported, and they are data.
  const error = new Error(
    `Send refused: ${reserved.length} recipient(s) are on a reserved test domain. Nothing was sent.`,
  );
  reportError(error, { source: "graph.recipient-guard" });
  throw error;
}
