// How a call transcript is split into who said what, for display.
//
// Mili's live transcript and a recording's speaker split (transcripts.ts) are
// both stored as one "Speaker: text" line per turn. A recording that could not
// be split is plain prose. Telling them apart by the labels alone means no
// column marks which is which: a transcript is shown by speaker only when
// every line starts with one of these labels, so prose that happens to say
// "Note: …" is never split into a speaker called "Note".
//
// No imports: a client component reads this.

/** The labels a stored transcript's turns may carry. */
export const TRANSCRIPT_SPEAKER_LABELS = [
  "Mili",
  "Royal",
  "Caller",
  "Contact",
] as const;

export type TranscriptSpeakerLabel = (typeof TRANSCRIPT_SPEAKER_LABELS)[number];

export type TranscriptTurn = {
  readonly speaker: TranscriptSpeakerLabel;
  readonly text: string;
};

/** Royal's side of the call (Mili or someone on the team). */
export function isRoyalSpeaker(speaker: TranscriptSpeakerLabel): boolean {
  return speaker === "Mili" || speaker === "Royal";
}

/** The transcript's turns, or null when it is not one labelled line per turn. */
export function transcriptTurns(
  transcript: string | null,
): TranscriptTurn[] | null {
  if (!transcript) return null;
  const lines = transcript.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const turns: TranscriptTurn[] = [];
  for (const line of lines) {
    const split = line.indexOf(": ");
    const speaker = split > 0 ? line.slice(0, split) : "";
    if (!(TRANSCRIPT_SPEAKER_LABELS as readonly string[]).includes(speaker)) {
      return null;
    }
    turns.push({
      speaker: speaker as TranscriptSpeakerLabel,
      text: line.slice(split + 2),
    });
  }
  return turns;
}
