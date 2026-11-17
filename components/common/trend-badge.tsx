export function TrendBadge({
  value,
  isInverse,
}: {
  value: number;
  isInverse?: boolean;
}) {
  const isPositive = isInverse ? value <= 0 : value >= 0;

  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold",
        isPositive
          ? "bg-success-light text-success-ink"
          : "bg-destructive-light text-destructive-ink",
      ].join(" ")}
    >
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}
