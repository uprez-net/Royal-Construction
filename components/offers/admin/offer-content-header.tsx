"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ADMIN_OFFER_TABS,
  adminPanelId,
  adminTabId,
  type AdminOfferTabs,
} from "./offer-content-tabs";

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
  // Selection follows focus, as the tabs pattern expects: the arrows change
  // the open tab, and focus moves with it. Without moving focus, roving
  // tabIndex would strand the keyboard on a tab that is no longer selected.
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const movedByKeyboard = useRef(false);

  useEffect(() => {
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
    activeTabRef.current?.focus();
  }, [activeTab]);

  function onTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const last = ADMIN_OFFER_TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    movedByKeyboard.current = true;
    onTabChange(ADMIN_OFFER_TABS[next].id);
  }

  return (
    <nav
      aria-label="Offer pre-fill sections"
      className="max-w-full overflow-x-auto rounded-lg border border-border/70 bg-white/95 px-4 py-3 shadow-sm"
    >
      <ol
        role="tablist"
        aria-orientation="horizontal"
        className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 md:flex md:min-w-190 md:gap-0"
      >
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
                role="tab"
                id={adminTabId(tab.id)}
                aria-selected={isCurrent}
                // Only the open tab claims a panel. One panel is rendered at
                // a time, so pointing every tab at its own id would leave five
                // of six referencing elements that are not in the document.
                aria-controls={isCurrent ? adminPanelId(tab.id) : undefined}
                // Roving tabIndex: Tab reaches the strip once and lands on the
                // open tab; the arrows move between tabs from there.
                tabIndex={isCurrent ? 0 : -1}
                ref={isCurrent ? activeTabRef : undefined}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                onClick={() => onTabChange(tab.id)}
                className="group flex w-full cursor-pointer flex-col items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-gold-ink"
              >
                <div
                  aria-hidden="true"
                  className="relative flex h-9 w-full items-center justify-center"
                >
                  <span
                    className={cn(
                      "relative flex size-8 items-center justify-center rounded-full bg-background font-mono text-xs font-medium transition-shadow",
                      isCurrent
                        ? "border-2 border-royal-gold-ink shadow-[0_0_0_6px_var(--royal-gold-light)]"
                        : "border border-royal-gold/50 text-foreground group-hover:border-royal-gold group-hover:shadow-[0_0_0_5px_var(--royal-gold-light)]",
                    )}
                  >
                    {isCurrent ? (
                      <>
                        <span className="absolute size-5 rounded-full bg-royal-gold/35 motion-safe:animate-ping" />
                        <span className="relative size-2.5 rounded-full bg-royal-gold-ink" />
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
                    "mt-2 text-center text-sm text-foreground transition-colors group-hover:text-royal-gold-ink",
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
