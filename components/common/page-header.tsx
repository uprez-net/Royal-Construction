import type { ReactNode } from "react";

// The one page title a route opens on: the title sits straight on the page
// background, with no card around it, as in docs/design-demo. Skeletons that
// stand in for it reuse PAGE_HEADER_CLASS so the swap does not jump.
export const PAGE_HEADER_CLASS =
  "flex flex-wrap items-end justify-between gap-4";

export function PageHeader({
  title,
  description,
  headingLevel,
  eyebrow,
  badge,
  aside,
  actions,
}: {
  title: string;
  description?: ReactNode;
  /** "h1" on a page route: the header title is the page's only h1. */
  headingLevel: "h1" | "h2";
  eyebrow?: ReactNode;
  badge?: ReactNode;
  /** Supplementary detail, such as counts, beside the actions. */
  aside?: ReactNode;
  actions?: ReactNode;
}) {
  const Heading = headingLevel;

  return (
    <header className={PAGE_HEADER_CLASS}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="font-heading text-[1.625rem] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
            {title}
          </Heading>
          {badge}
        </div>
        {description ? (
          <p className="mt-1 max-w-2xl text-[0.8125rem] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {aside || actions ? (
        <div className="flex w-full flex-wrap items-end gap-x-6 gap-y-3 sm:w-auto">
          {aside}
          {actions ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
