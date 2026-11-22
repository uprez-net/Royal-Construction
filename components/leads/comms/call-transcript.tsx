import {
  isRoyalSpeaker,
  transcriptTurns,
} from "@/lib/domain/comms/calls/transcript-lines";

// What was said on a call, folded away until someone opens it.
//
// Mili's live transcript and a recording's speaker split are stored as one
// "Speaker: text" line per turn; a recording that could not be split, or a
// voicemail, is plain prose. Which it is comes from the lines themselves
// (transcript-lines.ts): only when every line starts with a known speaker is
// it shown by speaker, so prose that says "Note: …" is not split into a
// speaker called "Note".

export function CallTranscript({
  transcript,
  label = "Transcript",
  defaultOpen = false,
}: {
  transcript: string | null;
  label?: string;
  defaultOpen?: boolean;
}) {
  if (!transcript) return null;
  const turns = transcriptTurns(transcript);
  const count = turns
    ? `${turns.length} ${turns.length === 1 ? "line" : "lines"}`
    : `${transcript.split(/\s+/).filter(Boolean).length} words`;
  return (
    <details className="group text-xs" open={defaultOpen}>
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        {label} ({count})
      </summary>
      <div className="mt-1.5 space-y-1.5 rounded-md bg-muted/50 p-2.5">
        {turns ? (
          turns.map((turn, index) => (
            <p
              key={index}
              className="whitespace-pre-wrap break-words leading-relaxed text-foreground"
            >
              <span
                className={
                  isRoyalSpeaker(turn.speaker)
                    ? "font-semibold text-primary"
                    : "font-semibold text-muted-foreground"
                }
              >
                {turn.speaker}:{" "}
              </span>
              {turn.text}
            </p>
          ))
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
            {transcript}
          </p>
        )}
      </div>
    </details>
  );
}
