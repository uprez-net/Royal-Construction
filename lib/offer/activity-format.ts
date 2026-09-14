// When a negotiation-activity entry happened. The year is left off for this
// year's dates to keep the timestamps short, and shown for any other: an offer's
// sends and replies can sit on a lead for months, and "10 Jun" alone reads as
// this June when it may have been last year's.
export function formatActivityWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear()
      ? { year: "numeric" as const }
      : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The DocuSign webhook's status-event notes lead with a machine prefix and the
// envelope id, which is how a redelivery finds the event it already wrote (see
// lib/docusign/completion-classifier.ts). What is stored never changes; this is
// only how the timeline reads it. Any other note passes through unchanged.
const WEBHOOK_NOTE_TEXT: Readonly<Record<string, string>> = {
  DOCUSIGN_COMPLETED: "Signed in DocuSign",
  UNEXPECTED_COMPLETION:
    "Signed after it was withdrawn — kept aside, not filed as the signed copy",
  UNEXPECTED_DECLINE: "Declined after it was withdrawn",
};

const WEBHOOK_NOTE =
  /^(DOCUSIGN_COMPLETED|UNEXPECTED_COMPLETION|UNEXPECTED_DECLINE) ([^\s:]+)(?::|\s|$)/;

export type ActivityNoteText = {
  readonly text: string;
  // Secondary text; null for a note that names no envelope.
  readonly envelopeId: string | null;
};

export function formatActivityNote(note: string): ActivityNoteText {
  const match = WEBHOOK_NOTE.exec(note);
  if (!match) {
    return { text: note, envelopeId: null };
  }
  return { text: WEBHOOK_NOTE_TEXT[match[1]], envelopeId: match[2] };
}
