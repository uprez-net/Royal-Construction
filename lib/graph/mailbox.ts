/**
 * The mailboxes this app sends from and ingests into.
 *
 * A website form notification is relayed by our own mailbox to itself, so on a
 * genuine enquiry the envelope sender is frequently us rather than the client.
 * These addresses must never become a lead's identity. `Lead.email` is what the
 * inbound gate in `app/api/graph/notifications/route.ts` matches on, so a single
 * lead holding our own address matches every later message and silently ends
 * automatic lead capture.
 */

/**
 * Used wherever BUSINESS_EMAIL is unset. Already the de facto default: the
 * email-trail call site has hardcoded the same literal since the trail existed.
 */
export const DEFAULT_BUSINESS_EMAIL = 'info@royalconstructions.com.au';

function normalize(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Every address that belongs to us rather than to a client.
 *
 * Read from the environment on each call rather than cached at module load:
 * the extraction path runs in long-lived serverless instances, and a config
 * change should not need a redeploy to take effect.
 */
export function ownMailboxes(): string[] {
  const configured = [
    process.env.BUSINESS_EMAIL,
    process.env.GRAPH_SENDER_UPN,
    process.env.BUSINESS_ADMIN_EMAIL,
    process.env.GRAPH_ADMIN_SENDER_UPN,
    // Comma-separated. The CC copy of our own outbound lands back in the
    // inbox looking exactly like an inbound enquiry.
    ...(process.env.MAIL_ID_CC ?? '').split(','),
    ...(process.env.GRAPH_ADMIN_MAIL_CC ?? '').split(','),
    DEFAULT_BUSINESS_EMAIL,
  ];

  return Array.from(new Set(configured.map(normalize).filter(Boolean)));
}

/** True when the address is one of ours. */
export function isOwnMailbox(email: string | null | undefined): boolean {
  const candidate = normalize(email);
  if (!candidate) {
    return false;
  }

  return ownMailboxes().includes(candidate);
}

/**
 * The address to record for a lead, given what the envelope said and what the
 * model read out of the body.
 *
 * The envelope sender is the better signal for a direct enquiry: the mail
 * system verified it, and a client who writes in from their own address is
 * reachable there. It is the wrong signal for a website form, where the sender
 * is our own relay and the client's address is in the body. Preferring the
 * envelope except when it is ours keeps the first case working and fixes the
 * second.
 *
 * Returns '' rather than one of our addresses when neither source yields a
 * usable third-party address, so an unattributable lead is merely incomplete
 * instead of poisoning the inbound gate.
 */
export function resolveLeadEmail(
  envelopeFrom: string | null | undefined,
  extractedEmail: string | null | undefined,
): string {
  const sender = normalize(envelopeFrom);
  const extracted = normalize(extractedEmail);

  const preferred = isOwnMailbox(sender) ? extracted : sender || extracted;

  return isOwnMailbox(preferred) ? '' : preferred;
}
