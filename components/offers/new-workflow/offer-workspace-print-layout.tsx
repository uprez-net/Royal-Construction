import type { ReactNode } from "react";
import { COMPANY_LINE } from "@/lib/offer/workspace-print-template";

type PrintPageProps = {
  readonly breakAfter?: boolean;
  readonly children: ReactNode;
  readonly footerText: string;
};

type PrintSectionProps = {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
};

type LabelValueProps = {
  readonly emphasis?: boolean;
  readonly label: string;
  readonly value: string;
};

export function PrintPage({
  breakAfter = true,
  children,
  footerText,
}: PrintPageProps) {
  return (
    <section
      className={
        breakAfter
          ? "mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white px-[18mm] py-[13mm] print:break-after-page"
          : "mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white px-[18mm] py-[13mm]"
      }
    >
      {children}
      <p className="mt-auto whitespace-nowrap border-t border-royal-gold pt-2 font-mono text-[8px] text-muted-foreground">
        {footerText}
      </p>
    </section>
  );
}

export function ProposalMasthead() {
  return (
    <p className="border-b border-royal-gold pb-2 text-xs font-semibold text-sidebar">
      {COMPANY_LINE}
    </p>
  );
}

export function PrintSection({ children, eyebrow, title }: PrintSectionProps) {
  return (
    <section className="mt-8">
      <p className="font-mono text-xs font-semibold uppercase tracking-wide text-royal-gold-dark">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-heading text-3xl font-semibold text-sidebar">
        {title}
      </h1>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function CoverRow({
  emphasis = false,
  label,
  value,
}: LabelValueProps) {
  return (
    <>
      <dt
        className={
          emphasis
            ? "bg-royal-gold px-3 py-3 font-semibold text-white"
            : "bg-sidebar px-3 py-3 font-semibold text-white"
        }
      >
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "bg-sidebar px-4 py-3 font-semibold text-white"
            : "bg-muted/70 px-4 py-3"
        }
      >
        {value}
      </dd>
    </>
  );
}

export function PrintBulletList({
  items,
  title,
}: {
  readonly items: readonly string[];
  readonly title: string;
}) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-sidebar">
        {title}
      </h2>
      <ul className="mt-4 space-y-3 text-sm leading-6">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 bg-royal-gold"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SignatureBlock({
  label,
  name,
}: {
  readonly label: string;
  readonly name: string;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-sidebar">
        {label}
      </h2>
      <p>Signature: _______________________________</p>
      <p>{name}</p>
      <p>Date: ___________________________________</p>
    </section>
  );
}
