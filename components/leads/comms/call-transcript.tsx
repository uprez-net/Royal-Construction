// What was said on a call, folded away until someone opens it.
//
// Two sources: Mili's live transcript ("Caller: …" / "Mili: …" lines), and
// the speech-to-text of a stored recording or voicemail, which is plain prose
// with no speakers. `speakers` says which this is, so a recording that happens
// to contain "Note: …" is not split into a speaker called "Note".

export function CallTranscript({
  transcript,
  label = "Transcript",
  speakers = true,
  defaultOpen = false,
}: {
  transcript: string | null;
  label?: string;
  speakers?: boolean;
  defaultOpen?: boolean;
}) {
  if (!transcript) return null;
  const lines = transcript.split("\n").filter(Boolean);
  const count = speakers
    ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}`
    : `${transcript.split(/\s+/).filter(Boolean).length} words`;
  return (
    <details className="group text-xs" open={defaultOpen}>
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        {label} ({count})
      </summary>
      <div className="mt-1.5 space-y-1 rounded-md bg-muted/50 p-2.5">
        {lines.map((line, index) => {
          const split = speakers ? line.indexOf(": ") : -1;
          const speaker = split > 0 ? line.slice(0, split) : null;
          const text = split > 0 ? line.slice(split + 2) : line;
          return (
            <p
              key={index}
              className="whitespace-pre-wrap break-words leading-relaxed text-foreground"
            >
              {speaker ? (
                <span className="font-medium text-muted-foreground">
                  {speaker}:{" "}
                </span>
              ) : null}
              {text}
            </p>
          );
        })}
      </div>
    </details>
  );
}
