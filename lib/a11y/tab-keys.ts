/**
 * The tab that an arrow or Home/End key moves to, or null for any other key
 * (leave it alone). Arrows wrap, as the WAI-ARIA tabs pattern asks. The
 * tablist is horizontal, so Up/Down are accepted too, as the other tab strips
 * in this app do.
 */
export function nextTabIndex(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return index >= last ? 0 : index + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
