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
