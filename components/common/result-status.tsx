/**
 * What a screen reader hears when a list changes size. `null` means the count
 * is not known yet (nothing has loaded), which must say nothing rather than
 * "No leads found".
 *
 * `shown` is for a paged list: "Showing 10 of 42 leads".
 */
export function resultStatusText({
  count,
  noun,
  shown,
}: {
  count: number | null;
  noun: string;
  shown?: number;
}): string {
  if (count === null) return "";
  if (count === 0) return `No ${noun}s found`;
  const nouns = `${noun}${count === 1 ? "" : "s"}`;
  return shown === undefined
    ? `${count} ${nouns}`
    : `Showing ${shown} of ${count} ${nouns}`;
}

/**
 * A polite live region for a list's size (#441). Search and filter results
 * change on screen with no other signal, so without this a screen-reader user
 * types a query and hears nothing.
 *
 * Always rendered. A live region inserted in the same render as its text is
 * often not announced, so the element has to exist before the text changes;
 * callers must not wrap this in a condition.
 *
 * `hideWhenEmpty` keeps the line off screen when there is nothing to count (the
 * list's own empty state is the visible message) while still announcing it.
 */
export function ResultStatus({
  count,
  noun,
  shown,
  className,
  hideWhenEmpty = false,
}: {
  count: number | null;
  noun: string;
  shown?: number;
  className?: string;
  hideWhenEmpty?: boolean;
}) {
  const text = resultStatusText({ count, noun, shown });
  const visible = text !== "" && !(hideWhenEmpty && count === 0);
  return (
    <p
      role="status"
      aria-atomic="true"
      className={visible ? className : "sr-only"}
    >
      {text}
    </p>
  );
}
