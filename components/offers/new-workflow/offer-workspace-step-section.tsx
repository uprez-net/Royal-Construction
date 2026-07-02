import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type StepHeaderProps = {
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly active: boolean;
};

function StepHeader({ index, phase, title, active }: StepHeaderProps) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold",
          active
            ? "bg-royal-gold text-white"
            : "border border-dashed border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {index}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.08em]",
            active ? "text-royal-gold-dark" : "text-muted-foreground",
          )}
        >
          {phase} phase
        </p>
        <h2 className="font-heading text-lg font-semibold leading-tight text-foreground">
          {title}
        </h2>
      </div>
    </div>
  );
}

// A labeled, anchored group of cards for one Offer-phase step. The stepper's
// node target points at this section's id.
export function OfferStepSection({
  id,
  index,
  phase,
  title,
  children,
}: {
  readonly id: string;
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-52">
      <StepHeader active index={index} phase={phase} title={title} />
      <div className="space-y-5">{children}</div>
    </section>
  );
}

// A later-phase step (Tender / Contract / Project) that stays locked until the
// Offer status reaches it. See @/lib/offer/workflow (isOfferPhaseUnlocked).
export function OfferPhaseGate({
  id,
  index,
  phase,
  title,
  unlocked,
  unlockHint,
  children,
}: {
  readonly id: string;
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly unlocked: boolean;
  readonly unlockHint: string;
  readonly children?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-52">
      <StepHeader active={unlocked} index={index} phase={phase} title={title} />
      {unlocked ? (
        <div className="space-y-5">
          {children ?? (
            <div className="rounded-lg border border-border/70 bg-white/95 px-4 py-6 text-sm text-muted-foreground shadow-sm">
              This phase&apos;s tools arrive with the DocuSign build.
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{unlockHint}</span>
        </div>
      )}
    </section>
  );
}
