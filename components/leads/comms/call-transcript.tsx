// What a caller and Mili said, folded away until someone opens it.

export function CallTranscript({ transcript }: { transcript: string | null }) {
  if (!transcript) return null;
  const lines = transcript.split("\n").filter(Boolean);
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        Transcript ({lines.length} {lines.length === 1 ? "line" : "lines"})
      </summary>
      <div className="mt-1.5 space-y-1 rounded-md bg-muted/50 p-2.5">
        {lines.map((line, index) => {
          const split = line.indexOf(": ");
          const speaker = split > 0 ? line.slice(0, split) : null;
          const text = split > 0 ? line.slice(split + 2) : line;
          return (
            <p key={index} className="leading-relaxed text-foreground">
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
