import { CardDescription, CardTitle } from "@/components/ui/card";
import type { ReactNode } from "react";

type OfferCardHeadingProps = {
  readonly description: string;
  readonly icon: ReactNode;
  readonly singleLineDescription?: boolean;
  readonly title: string;
  readonly titleId?: string;
};

export function OfferCardHeading({
  description,
  icon,
  singleLineDescription = false,
  title,
  titleId,
}: OfferCardHeadingProps) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-royal-gold-light text-royal-gold">
        {icon}
      </span>
      <div className="min-w-0">
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription
          className={
            singleLineDescription
              ? "mt-1 max-w-none lg:whitespace-nowrap"
              : "mt-1 max-w-2xl"
          }
        >
          {description}
        </CardDescription>
      </div>
    </div>
  );
}

type OfferSummaryBadgeProps = {
  readonly label: string;
  readonly value: number;
};

export function OfferSummaryBadge({ label, value }: OfferSummaryBadgeProps) {
  return (
    <span className="rounded-md border border-border bg-background px-2 py-1">
      <span className="font-mono font-semibold text-foreground">{value}</span>{" "}
      {label}
    </span>
  );
}
