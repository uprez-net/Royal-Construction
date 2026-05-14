"use client";

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { ProjectWithStats } from "@/types/project";

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

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleEscape);
        document.body.style.overflow = "unset";
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  const spentPercent = Math.round((spent / budget) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="border-b border-border bg-white px-6 py-4">
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {project.name}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {project.location} • {project.customer.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
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
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-180px)] px-6 py-4">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground font-medium">
                    Budget
                  </p>
                  <p className="text-lg font-bold text-foreground mt-1">
                    ${Math.round(budget / 1000)}K
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground font-medium">
                    Spent ({spentPercent}%)
                  </p>
                  <p className={`text-lg font-bold mt-1 ${
                    spentPercent > 80 ? "text-red-600" : "text-foreground"
                  }`}>
                    ${Math.round(spent / 1000)}K
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground font-medium">
                    Remaining
                  </p>
                  <p className="text-lg font-bold text-emerald-600 mt-1">
                    ${Math.round((budget - spent) / 1000)}K
                  </p>
                </div>
              </div>

              {/* Progress */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">
                    Overall Progress
                  </p>
                  <p className="text-sm font-bold text-teal-600">
                    {project.progressPercent}%
                  </p>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-teal-500 transition-all"
                    style={{ width: `${project.progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {project.completedMilestoneCount} of {project.milestoneCount}{" "}
                  milestones completed
                </p>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Customer
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.customer.name}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Site Manager
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.siteManager?.name || "Unassigned"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Location
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.location}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Status
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.status
                      .split("_")
                      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
                      .join(" ")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "customer" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-semibold text-foreground mb-2">
                  {project.customer.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Client since project start
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Email
                  </p>
                  <p className="text-sm text-foreground mt-1">
                    {project.customer.email || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Phone
                  </p>
                  <p className="text-sm text-foreground mt-1">
                    {project.customer.phone || "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "milestones" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {project.completedMilestoneCount} of {project.milestoneCount}{" "}
                milestones completed
              </p>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-teal-500"
                  style={{
                    width: `${(project.completedMilestoneCount / project.milestoneCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === "financials" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-emerald-50 p-4 border border-emerald-200">
                  <p className="text-xs text-emerald-700 font-medium">
                    Total Budget
                  </p>
                  <p className="text-lg font-bold text-emerald-900 mt-1">
                    ${Math.round(budget / 1000)}K
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 p-4 border border-amber-200">
                  <p className="text-xs text-amber-700 font-medium">
                    Actual Spend
                  </p>
                  <p className="text-lg font-bold text-amber-900 mt-1">
                    ${Math.round(spent / 1000)}K
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "team" && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-semibold text-foreground mb-1">
                  Site Manager
                </p>
                <p className="text-sm text-foreground">
                  {project.siteManager?.name || "Unassigned"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Responsible for milestone coordination and site updates
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-muted/30 px-6 py-3 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Close
          </button>
          <a
            href={`/projects/${project.id}`}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
          >
            Open Full Details
          </a>
        </div>
      </div>
    </div>
  );
}
