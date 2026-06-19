"use client";


import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  CalendarCheck,
  Package,
  CreditCard,
  Camera,
  Wrench,
  QrCode,
  FileText,
  ArrowLeftRight,
  History,
  Mail,
} from "lucide-react";
import { ProjectDetail } from "@/types/project";
import { useMemo } from "react";
import { ProjectDetailTabKey } from "@/utils/validators/projects";

const TabIcons: Record<ProjectDetailTabKey, React.ElementType> = {
  overview: LayoutGrid,
  milestones: CalendarCheck,
  materials: Package,
  payments: CreditCard,
  updates: Camera,
  tradies: Wrench,
  workers: QrCode,
  history: History,
  docs: FileText,
  variations: ArrowLeftRight,
  communications: Mail,
};

const generateProjectDetailTabs = (
  project: ProjectDetail,
): {
  key: ProjectDetailTabKey;
  label: string;
  badge?: string;
  badgeTone?: "primary" | "warning" | "danger" | "neutral";
}[] => {
  const pendingMilestones = project.milestones.filter(
    (m) => m.status !== "DONE",
  ).length;

  // const tradieAlerts = project.tradieSchedules.filter(
  //   (schedule) =>
  //     schedule.status === "PENDING" ||
  //     schedule.status === "PENDING_RESPONSE" ||
  //     schedule.status === "NO_RESPONSE" ||
  //     schedule.status === "DECLINED",
  // ).length;

  // const siteUpdates = project.siteUpdates.length;
  // const variations = project.variations.length;

  const tabs: {
    key: ProjectDetailTabKey;
    label: string;
    badge?: string;
    badgeTone?: "primary" | "warning" | "danger" | "neutral";
  }[] = [
    { key: "overview", label: "Overview" },
    {
      key: "milestones",
      label: "Milestones",
      badge: pendingMilestones.toString(),
      badgeTone: "warning",
    },
    // { key: "materials", label: "Materials" },
    { key: "payments", label: "Payments" },
    // {
    //   key: "updates",
    //   label: "Site Updates",
    //   badge: siteUpdates.toString(),
    //   badgeTone: "primary",
    // },
    // {
    //   key: "tradies",
    //   label: "Tradies",
    //   badge: tradieAlerts.toString(),
    //   badgeTone:
    //     tradieAlerts > 4 ? "danger" : tradieAlerts > 2 ? "warning" : "neutral",
    // },
    // { key: "workers", label: "Workers & QR" },
    { key: "docs", label: "Documents" },
    { key: "history", label: "History" },
    { key: "communications", label: "Communications" },
    // {
    //   key: "variations",
    //   label: "Variations",
    //   badge: variations.toString(),
    //   badgeTone:
    //     variations > 4 ? "danger" : variations > 2 ? "warning" : "neutral",
    // },
  ];

  return tabs;
};

export function ProjectTabNavigation({
  project,
  activeTab,
  onTabChange,
}: {
  project: ProjectDetail;
  activeTab: ProjectDetailTabKey;
  onTabChange: (tab: ProjectDetailTabKey) => void;
}) {
  const projectDetailTabs = useMemo(
    () => generateProjectDetailTabs(project),
    [project],
  );

  return (
    <nav className="hide-scrollbar flex gap-0 overflow-x-auto border-b-2 border-border/60 mb-5">
      {projectDetailTabs.map((tab) => {
        const Icon = TabIcons[tab.key];
        return (
          <button
            key={`${tab.key}-${tab.label}-${tab.badge}`}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "relative inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-[18px] py-[11px] text-[12.5px] font-medium text-muted-foreground transition-all hover:text-teal-600 focus:outline-none",
              activeTab === tab.key &&
                "border-teal-600 font-bold text-teal-600",
            )}
          >
            <Icon className="size-4" />
            <span>{tab.label}</span>
            {tab.badge ? (
              <span
                className={cn(
                  "ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[10px] font-bold leading-none",
                  tab.badgeTone === "warning" && "bg-amber-100 text-[#D97706]",
                  tab.badgeTone === "danger" && "bg-red-100 text-red-600",
                  tab.badgeTone === "primary" && "bg-teal-600/15 text-teal-600",
                  tab.badgeTone === "neutral" && "bg-slate-100 text-slate-700",
                )}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
