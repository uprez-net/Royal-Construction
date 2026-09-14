"use client";

import { cn } from "@/lib/utils";
import { ADMIN_OFFER_TABS, type AdminOfferTabs } from "./offer-content-tabs";

interface OfferContentHeaderProps {
  activeTab: AdminOfferTabs;
  onTabChange: (tab: AdminOfferTabs) => void;
  dirtyTabs: Readonly<Record<AdminOfferTabs, boolean>>;
}

export function OfferContentHeader({
  activeTab,
  onTabChange,
  dirtyTabs,
}: OfferContentHeaderProps) {
  return (
    <nav
      aria-label="Offer pre-fill sections"
      className="max-w-full overflow-x-auto rounded-lg border border-border/70 bg-white/95 px-4 py-3 shadow-sm"
    >
      <ol className="flex min-w-190">
        {ADMIN_OFFER_TABS.map((tab, index) => {
          const isCurrent = tab.id === activeTab;
          const isDirty = dirtyTabs[tab.id];

          return (
            <li
              key={tab.id}
              className="relative flex flex-1 flex-col items-center"
            >
              {/* The visible label names the button, so the node is hidden:
                  its index number would otherwise be read into the name. */}
              <button
                type="button"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => onTabChange(tab.id)}
                className="group flex w-full cursor-pointer flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
              >
                <div
                  aria-hidden="true"
                  className="relative flex h-9 w-full items-center justify-center"
                >
                  <span
                    className={cn(
                      "relative flex size-8 items-center justify-center rounded-full bg-background font-mono text-xs font-medium transition-shadow",
                      isCurrent
                        ? "border-2 border-royal-gold shadow-[0_0_0_6px_var(--royal-gold-light)]"
                        : "border border-royal-gold/50 text-foreground group-hover:border-royal-gold group-hover:shadow-[0_0_0_5px_var(--royal-gold-light)]",
                    )}
                  >
                    {isCurrent ? (
                      <>
                        <span className="absolute size-5 rounded-full bg-royal-gold/35 motion-safe:animate-ping" />
                        <span className="relative size-2.5 rounded-full bg-royal-gold" />
                      </>
                    ) : (
                      index + 1
                    )}
                    {isDirty ? (
                      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warning-ink ring-2 ring-background" />
                    ) : null}
                  </span>
                </div>
                <span
                  className={cn(
                    "mt-2 text-center text-sm text-foreground transition-colors group-hover:text-royal-gold-dark",
                    isCurrent ? "font-semibold" : "font-medium",
                  )}
                >
                  {tab.label}
                  {isDirty ? (
                    <span className="sr-only">, unsaved changes</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
