"use client";

import { useCallback, useRef } from "react";
import { CalendarClock, FileText, LayoutGrid, StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";
import { MobileFilterSelect } from "@/components/common/mobile-filter-select";

export const LEAD_DETAIL_TABS = [
  "overview",
  "scheduledWork",
  "documents",
  "notes",
] as const;

export type LeadDetailTabKey = (typeof LEAD_DETAIL_TABS)[number];

export function isLeadDetailTab(value: string): value is LeadDetailTabKey {
  return (LEAD_DETAIL_TABS as readonly string[]).includes(value);
}

export const leadTabTriggerId = (key: LeadDetailTabKey) => `lead-tab-${key}`;
export const leadTabPanelId = (key: LeadDetailTabKey) => `lead-tabpanel-${key}`;

const TAB_ICONS: Record<LeadDetailTabKey, React.ElementType> = {
  overview: LayoutGrid,
  scheduledWork: CalendarClock,
  documents: FileText,
  notes: StickyNote,
};

const TAB_LABELS: Record<LeadDetailTabKey, string> = {
  overview: "Overview",
  scheduledWork: "Tasks",
  documents: "Uploaded Documents",
  notes: "Notes",
};

/**
 * Same badge contract as the project tabs: the count and the sentence that
 * explains it are one value, so a bare number can never reach a screen reader
 * with nothing describing it.
 */
type TabBadge = {
  count: string;
  description: string;
};

export function LeadTabNavigation({
  activeTab,
  onTabChange,
  badges,
}: {
  activeTab: LeadDetailTabKey;
  onTabChange: (tab: LeadDetailTabKey) => void;
  badges?: Partial<Record<LeadDetailTabKey, TabBadge>>;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusTab = useCallback(
    (tab: LeadDetailTabKey) => {
      onTabChange(tab);
      tabRefs.current[tab]?.focus();
    },
    [onTabChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = LEAD_DETAIL_TABS.indexOf(activeTab);
      if (currentIndex === -1) return;

      const last = LEAD_DETAIL_TABS.length - 1;
      let nextIndex: number | null = null;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex === last ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex === 0 ? last : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = last;
          break;
        default:
          return;
      }

      event.preventDefault();
      focusTab(LEAD_DETAIL_TABS[nextIndex]);
    },
    [activeTab, focusTab],
  );

  return (
    <>
      <MobileFilterSelect
        label="Lead section"
        value={activeTab}
        options={LEAD_DETAIL_TABS.map((key) => ({
          value: key,
          label: `${TAB_LABELS[key]}${badges?.[key] ? ` (${badges[key]?.count})` : ""}`,
        }))}
        onChange={(value) => {
          if (isLeadDetailTab(value)) onTabChange(value);
        }}
      />
      <div
        role="tablist"
        aria-label="Lead sections"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="mb-5 hidden flex-wrap gap-x-1 border-b-2 border-border/60 md:flex"
      >
        {LEAD_DETAIL_TABS.map((key) => {
          const Icon = TAB_ICONS[key];
          const isActive = activeTab === key;
          const badge = badges?.[key];

          return (
            <button
              key={key}
              ref={(node) => {
                tabRefs.current[key] = node;
              }}
              type="button"
              role="tab"
              id={leadTabTriggerId(key)}
              aria-selected={isActive}
              aria-controls={leadTabPanelId(key)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(key)}
              className={cn(
                "relative -mb-0.5 inline-flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:whitespace-nowrap sm:px-4",
                isActive && "border-primary font-semibold text-primary",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{TAB_LABELS[key]}</span>
              {badge ? (
                <>
                  <span
                    aria-hidden="true"
                    className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium leading-none text-muted-foreground"
                  >
                    {badge.count}
                  </span>
                  <span className="sr-only">{badge.description}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
