import { ProjectWithStats } from "@/types/project";
import { dateFormat } from "@/utils/formatters";
import { Button } from "../ui/button";
import Link from "next/link";
import { ArrowRightCircle, CalendarCheck, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";

type TabType = "overview" | "customer" | "milestones" | "financials" | "team";

interface ProjectOverviewTabProps {
  project: ProjectWithStats;
  setActiveTab: (tab: TabType) => void;
  onClose: () => void;
}

export function OverviewTab({
  project,
  setActiveTab,
  onClose,
}: ProjectOverviewTabProps) {
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  const spentPercent = Math.round((spent / budget) * 100);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground font-medium">Budget</p>
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
          <p className="text-xs text-muted-foreground font-medium">Remaining</p>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground font-medium">Customer</p>
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
          <p className="text-xs text-muted-foreground font-medium">Location</p>
          <p className="text-sm font-semibold text-foreground mt-1">
            {project.location}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <p className="text-sm font-semibold text-foreground mt-1">
            {project.status
              .split("_")
              .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
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
        <Button asChild className="gap-1.5" onClick={onClose}>
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
          onClick={() => toast.info(`Opening ${project.location} in Maps...`)}
        >
          <MapPin className="h-4 w-4" />
          Directions
        </Button>
      </div>
    </div>
  );
}
