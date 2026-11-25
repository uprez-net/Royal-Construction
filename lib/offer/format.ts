// Percent formatting shared by the step rail's markup digest and the summary
// strip's markup chip. One definition, because the two sit on screen together:
// rounding differently made them read "18% markup" beside "At target · 17.5%".
export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

// Two fixed decimals, for the Pricing step's build-up and profitability rows:
// "16.67%" gross margin, not "16.7%", so the row reconciles with the dollars
// beside it. The rail and strip keep formatPercent's shorter form.
export function formatPercentFixed(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
