// Whether a numeric field's text already stands for the committed value, in
// which case it must not be overwritten from the store. A partial entry commits
// something the text does not spell out: "." commits NaN, "5." commits 5. The
// old check only accepted "" for NaN, so typing a leading "." was wiped on the
// next render. Only a value the text does not represent resyncs the field.
export function isRawCurrent(raw: string, value: number): boolean {
  return Number.isFinite(value)
    ? parseFloat(raw) === value
    : !Number.isFinite(parseFloat(raw));
}
