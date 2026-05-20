"use client";

import { useState, useEffect } from "react";
import {
  ArrowRightCircle,
  Bell,
  CalendarCheck,
  CalendarDays,
  Camera,
  Check,
  FileText,
  Hammer,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  Play,
  X,
} from "lucide-react";
import type { ProjectWithStats } from "@/types/project";
import { currency, dateFormat } from "@/utils/formatters";
import { Button } from "../ui/button";
import { toast } from "sonner";
import Link from "next/link";

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
                  <p
                    className={`text-lg font-bold mt-1 ${
                      spentPercent > 80 ? "text-red-600" : "text-foreground"
                    }`}
                  >
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
                    Customer Phone
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.customer.phone || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Customer Email
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.customer.email || "—"}
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
                      .map(
                        (part) => part.charAt(0) + part.slice(1).toLowerCase(),
                      )
                      .join(" ")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Start Date
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {dateFormat.format(new Date(project.startDate))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Est. Completion
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {dateFormat.format(new Date(project.estimatedEndDate))}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild className="gap-1.5">
                  <Link href={`/projects/${project.id}`}>
                    <ArrowRightCircle className="h-4 w-4" />
                    Open Full Details
                  </Link>
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setActiveTab("milestones");
                  }}
                >
                  <CalendarCheck className="h-4 w-4" />
                  Milestones
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    toast.info(
                      `Calling ${project.customer} at ${project.customer.phone}...`,
                    )
                  }
                >
                  <Phone className="h-4 w-4" />
                  Call Client
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    toast.info(`Opening ${project.location} in Maps...`)
                  }
                >
                  <MapPin className="h-4 w-4" />
                  Directions
                </Button>
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
                  Client since {dateFormat.format(new Date(project.customer.createdAt))} -{" "}
                  {project.buildingType}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Phone
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.customer.phone || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Email
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.customer.email || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Site Address
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {project.location}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Project Value
                  </p>
                  <p className="text-sm font-semibold text-emerald-600 mt-1">
                    {currency.format(Number(project.totalBudget))}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs text-muted-foreground font-medium">
                  Customer Requirements (
                  {(project.requirements as string[]).length})
                </p>
                <div className="flex gap-2 flex-wrap mt-4">
                  {((project.requirements ?? []) as string[]).map(
                    (req, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center rounded-[4px] bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground gap-2"
                      >
                        <Check className="text-green-500 h-3 w-3" />
                        {req}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div className="mb-4 rounded-[10px] border border-teal-600/10 bg-emerald-50 px-[18px] py-[14px]">
                <div className="mb-1.5 flex items-center gap-1 text-xs font-bold text-emerald-700">
                  <Info className="h-3.5 w-3.5" />
                  <span>Portfolio Notes</span>
                </div>

                <p className="m-0 text-[13px] leading-6 text-[var(--text-secondary)]">
                  Client has been provided the BuildPro platform link for
                  requirement submission. All selections from catalogue have
                  been recorded.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => toast.info("Opening email composer...")}
                  className="gap-1.5"
                >
                  <Mail className="h-4 w-4" />
                  Send Email
                </Button>

                <Button
                  variant="outline"
                  onClick={() => toast.info(`Calling ${project.customer}...`)}
                  className="gap-1.5"
                >
                  <Phone className="h-4 w-4" />
                  Call Now
                </Button>

                <Button
                  variant="outline"
                  onClick={() => toast.success("Opening WhatsApp...")}
                  className="gap-1.5"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </Button>

                <Button
                  variant="outline"
                  onClick={() => toast.info("Generating portfolio PDF...")}
                  className="gap-1.5"
                >
                  <FileText className="h-4 w-4" />
                  Export Portfolio
                </Button>
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

              <div className="mt-4">
                {project.milestones.map((m, i) => {
                  const isLast = i === project.milestones.length - 1;

                  const statusConfig = {
                    DONE: {
                      icon: Check,
                      dotClass: "bg-green-500 text-white",
                      titleClass: "text-foreground font-medium",
                    },
                    ACTIVE: {
                      icon: Play,
                      dotClass:
                        "bg-primary text-primary-foreground ring-4 ring-primary/15",
                      titleClass: "text-primary font-bold",
                    },
                    PENDING: {
                      icon: Minus,
                      dotClass: "bg-border text-muted-foreground",
                      titleClass: "text-foreground font-medium",
                    },
                  }[m.status];

                  const StatusIcon = statusConfig.icon;

                  return (
                    <div
                      key={m.id}
                      className={`flex items-start justify-between gap-4 py-4 ${
                        !isLast ? "border-b border-border" : ""
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 gap-3">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${statusConfig.dotClass}`}
                        >
                          <StatusIcon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className={`text-sm ${statusConfig.titleClass}`}>
                            {m.name}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              <span>{dateFormat.format(new Date(m.targetDate))}</span>
                            </div>

                            {m.tradies && m.tradies.length > 0 && (
                              <div className="flex items-center gap-1">
                                <Hammer className="h-3 w-3" />
                                <span>{m.tradies[0].name}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {m.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              toast.info(
                                `Opening photo upload for: ${m.name}...`,
                              );
                            }}
                          >
                            <Camera className="h-3.5 w-3.5" />
                            Upload
                          </Button>
                        )}

                        {m.status === "PENDING" &&
                          m.tradies &&
                          m.tradies.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => {
                                toast.warning(
                                  `Sending 1-week reminder to ${m.tradies[0].name}...`,
                                );
                              }}
                            >
                              <Bell className="h-3.5 w-3.5" />
                              Remind
                            </Button>
                          )}
                      </div>
                    </div>
                  );
                })}
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
      </div>
    </div>
  );
}
