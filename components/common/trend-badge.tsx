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
          ? "bg-emerald-100 text-emerald-700"
          : "bg-red-100 text-red-700",
      ].join(" ")}
    >
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}