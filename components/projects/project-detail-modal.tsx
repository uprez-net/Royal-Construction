"use client";

import { useState } from "react";
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
  project: ProjectWithStats | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = "overview" | "customer" | "milestones" | "financials" | "team";

const TABS: { id: TabType; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "customer", label: "Customer" },
  { id: "milestones", label: "Milestones" },
  { id: "financials", label: "Financials" },
  { id: "team", label: "Team" },
];

export function ProjectDetailModal({
  project,
  isOpen,
  onClose,
}: ProjectDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  if(!project) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[70vh] max-w-[60vw] overflow-y-auto">
        {/* Header */}
        <DialogHeader className="border-b border-border bg-white px-6 py-4">
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-xl font-bold text-foreground">
                {project.name}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                {project.location} • {project.customer.name}
              </DialogDescription>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-t border-border/40 mt-4 -mx-6 px-6 pt-3">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-teal-600 text-teal-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="overflow-y-auto no-scrollbar max-h-[calc(90vh-180px)] px-6 py-4 ">
          {activeTab === "overview" && (
            <OverviewTab project={project} setActiveTab={setActiveTab} onClose={onClose} />
          )}

          {activeTab === "customer" && <CustomerTab project={project} />}

          {activeTab === "milestones" && <MilestoneTab project={project} />}

          {activeTab === "financials" && <FinancialTab project={project} />}

          {activeTab === "team" && <TeamTab project={project} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
