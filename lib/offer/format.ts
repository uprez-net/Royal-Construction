// Percent formatting shared by the step rail's margin digest and the summary
// strip's margin chip. One definition, because the two sit on screen together:
// rounding differently made them read "18% margin" beside "At target · 17.5%".
export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}
