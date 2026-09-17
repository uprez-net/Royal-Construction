import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

// The one title card routes open on. Colour comes only from the royal-gold
// tokens, so heroes can no longer drift between teal and gold page by page.
export function PageHeroCard({
  title,
  description,
  headingLevel,
  icon,
  eyebrow,
  badge,
  aside,
  actions,
}: {
  title: string;
  description: string;
  /** "h1" on a page route: the hero title is the page's only h1. */
  headingLevel: "h1" | "h2";
  icon?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  /** Supplementary detail, such as a count. Dropped on phones. */
  aside?: ReactNode;
  actions?: ReactNode;
}) {
  const Heading = headingLevel;

  return (
    <Card className="overflow-hidden border-royal-gold/20 bg-linear-to-br from-royal-gold-light to-card shadow-sm">
      <CardContent className="relative p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-10 size-40 rounded-full bg-royal-gold/10"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-royal-gold/15 text-royal-gold-ink [&_svg]:size-5"
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Heading className="font-heading text-lg font-semibold tracking-tight text-foreground">
                  {title}
                </Heading>
                {badge}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          {aside ? <div className="hidden shrink-0 sm:block">{aside}</div> : null}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
