/** Accept application paths while rejecting protocol-relative destinations. */
const INTERNAL_BASE_URL = new URL("https://internal.invalid");

export function isInternalHref(value: string): boolean {
  try {
    const resolved = new URL(value, INTERNAL_BASE_URL);
    return (
      value.startsWith("/") && resolved.origin === INTERNAL_BASE_URL.origin
    );
  } catch {
    return false;
  }
}
