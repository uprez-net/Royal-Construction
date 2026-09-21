// The date a re-rendered offer revision prints as prepared: its most recent
// send, the copy the customer received, not today. The revision viewer used the
// creation date, so a revision re-sent weeks later printed a date the customer
// never saw. A revision never sent falls back to when it was drawn up.
export function revisionPreparedDate(revision: {
  readonly lastSentAt: string | null;
  readonly createdAt: string;
}): Date {
  return new Date(revision.lastSentAt ?? revision.createdAt);
}
