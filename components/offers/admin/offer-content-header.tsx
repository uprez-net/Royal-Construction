"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type AdminOfferTabs =
  | "job-setup"
  | "cost-schedule"
  | "offer-scope"
  | "HBFC-claim"
  | "offer-inclusions"
  | "offer-content";

const TABS: readonly { id: AdminOfferTabs; label: string }[] = [
  { id: "job-setup", label: "Job Setup" },
  { id: "cost-schedule", label: "Cost Schedule" },
  { id: "offer-scope", label: "Scope" },
  { id: "offer-inclusions", label: "Inclusions" },
  { id: "offer-content", label: "Offer Document" },
  { id: "HBFC-claim", label: "HBFC Claim" },
];

interface OfferContentHeaderProps {
  activeTab: AdminOfferTabs;
  onTabChange: (tab: AdminOfferTabs) => void;
}

export function OfferContentHeader({
  activeTab,
  onTabChange,
}: OfferContentHeaderProps) {
  const currentIndex = TABS.findIndex((t) => t.id === activeTab);

  return (
    <nav
      aria-label="Offer workflow stages"
      className="max-w-full overflow-x-auto rounded-lg border border-border/70 bg-white/95 px-4 py-3 shadow-sm"
    >
      {/* Phase band — single "Admin" phase spanning all steps */}
      <ol aria-hidden="true" className="flex min-w-190">
        <li className="min-w-0 basis-0 px-1" style={{ flexGrow: TABS.length }}>
          <div className="border-b-2 border-royal-gold/70 pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-royal-gold-dark">
            Admin
          </div>
        </li>
      </ol>

      {/* Node rail */}
      <ol className="flex min-w-190 pt-3">
        {TABS.map((tab, index) => {
          const isFirst = index === 0;
          const isLast = index === TABS.length - 1;
          const isCurrent = index === currentIndex;
          const isComplete = index < currentIndex;
          const isAvailable = !isCurrent && !isComplete;
          const connectorClass = "bg-royal-gold/60";

          const stepContent = (
            <>
              <div className="relative flex h-9 w-full items-center justify-center">
                {!isFirst ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2",
                      connectorClass,
                    )}
                  />
                ) : null}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2",
                      connectorClass,
                    )}
                  />
                ) : null}
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "relative z-10 flex size-8 items-center justify-center rounded-full font-mono text-xs font-medium transition-shadow",
                    isComplete
                      ? "border-2 border-royal-gold bg-royal-gold text-white"
                      : "bg-background",
                    isCurrent
                      ? "border-2 border-royal-gold text-royal-gold-dark shadow-[0_0_0_6px_var(--royal-gold-light)]"
                      : isAvailable
                        ? "border border-royal-gold/50 text-foreground group-hover:border-royal-gold group-hover:shadow-[0_0_0_5px_var(--royal-gold-light)]"
                        : "",
                  )}
                >
                  {isComplete ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : isCurrent ? (
                    <>
                      <span
                        className="absolute size-5 rounded-full bg-royal-gold/35 motion-safe:animate-ping"
                        aria-hidden="true"
                      />
                      <span
                        className="relative size-2.5 rounded-full bg-royal-gold"
                        aria-hidden="true"
                      />
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
              </div>
              <span
                className={cn(
                  "mt-2 text-center text-sm transition-colors group-hover:text-royal-gold-dark",
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {tab.label}
              </span>
            </>
          );

          return (
            <li
              key={tab.id}
              className="relative flex flex-1 flex-col items-center"
            >
              <button
                type="button"
                aria-label={`Jump to ${tab.label}`}
                onClick={() => onTabChange(tab.id)}
                className="group flex w-full cursor-pointer flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
              >
                {stepContent}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
