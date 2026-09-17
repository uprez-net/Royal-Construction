/** Accept application paths while rejecting protocol-relative destinations. */
export function isInternalHref(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}
