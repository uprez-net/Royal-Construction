import { ProjectWithStats } from "@/types/project";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { dateFormat } from "@/utils/formatters";
import {
  Bell,
  CalendarDays,
  Camera,
  Check,
  Hammer,
  Minus,
  Play,
} from "lucide-react";

interface MilestoneTabProps {
  project: ProjectWithStats;
}

export function MilestoneTab({ project }: MilestoneTabProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {project.completedMilestoneCount} of {project.milestoneCount} milestones
        completed
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
                      toast.info(`Opening photo upload for: ${m.name}...`);
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
  );
}
