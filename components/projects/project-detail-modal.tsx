"use client";

import { useCallback, useId, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectWithStats } from "@/types/project";
import { TeamTab } from "./project-team-tab";
import { CustomerTab } from "./project-customer-tab";
import { MilestoneTab } from "./project-milestone-tab";
import { OverviewTab } from "./project-overview-tab";
import { FinancialTab } from "./project-financial-tab";

interface ProjectDetailModalProps {
  isAdmin: boolean;
  project: ProjectWithStats | null;
  isOpen: boolean;
  onClose: () => void;
}

export type TabType =
  | "overview"
  | "customer"
  | "milestones"
  | "financials"
  | "team";

const TABS: { id: TabType; label: string; requiresAdmin?: boolean }[] = [
  { id: "overview", label: "Overview" },
  { id: "customer", label: "Customer" },
  { id: "milestones", label: "Milestones" },
  { id: "financials", label: "Financials", requiresAdmin: true },
  { id: "team", label: "Team" },
];

export function ProjectDetailModal({
  isAdmin,
  project,
  isOpen,
  onClose,
}: ProjectDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  // Stable per-instance prefix so tab ids never collide with another dialog's.
  const idPrefix = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabId = (id: TabType) => `${idPrefix}-tab-${id}`;
  const panelId = (id: TabType) => `${idPrefix}-panel-${id}`;

  // Arrow/Home/End move focus and selection between tabs, per the WAI-ARIA
  // tabs pattern. Roving tabIndex keeps the tablist a single tab stop.
  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const lastIndex = TABS.length - 1;
      let nextIndex: number | null = null;

      if (event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
      else if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = lastIndex;

      if (nextIndex === null) return;

      event.preventDefault();
      const next = TABS[nextIndex];
      setActiveTab(next.id);
      tabRefs.current[next.id]?.focus();
    },
    [],
  );

  if (!project) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Radix owns the focus trap, Escape handling, scroll lock, focus
          restoration to the trigger, and aria-labelledby/-describedby wiring
          from DialogTitle/DialogDescription. Nothing here re-implements it.
          The grid rows make the body the single scroll region — the dialog
          shell itself does not scroll, so there is no nested-scroll trap. */}
      <DialogContent className="grid max-h-[85vh] w-full max-w-[calc(100%-1.5rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[90vw] lg:max-h-[80vh] lg:max-w-[60vw]">
        <DialogHeader className="border-b border-border bg-card px-6 pt-5 pr-14 text-left">
          <DialogTitle className="font-heading text-xl font-semibold text-foreground">
            {project.name}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {project.location} • {project.customer.name}
          </DialogDescription>

          <div
            role="tablist"
            aria-label="Project sections"
            className="no-scrollbar -mx-6 mt-4 flex gap-0 overflow-x-auto border-t border-border/40 px-6 pt-3"
          >
            {TABS.map((tab, index) => {
              const isActive = activeTab === tab.id;

              if(tab.requiresAdmin && !isAdmin) {
                return null;
              }

              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabRefs.current[tab.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(tab.id)}
                  aria-selected={isActive}
                  aria-controls={panelId(tab.id)}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div
          role="tabpanel"
          id={panelId(activeTab)}
          aria-labelledby={tabId(activeTab)}
          tabIndex={0}
          className="no-scrollbar overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {activeTab === "overview" && (
            <OverviewTab
              isAdmin={isAdmin}
              project={project}
              setActiveTab={setActiveTab}
              onClose={onClose}
            />
          )}

          {activeTab === "customer" && <CustomerTab project={project} isAdmin={isAdmin} />}

          {activeTab === "milestones" && <MilestoneTab project={project} />}

          {activeTab === "financials" && <FinancialTab project={project} />}

          {activeTab === "team" && <TeamTab project={project} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
