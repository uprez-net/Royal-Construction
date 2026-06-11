import { timeFormat } from "@/utils/formatters";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Activity } from "lucide-react";

interface FollowUpItem {
  id: string;
  customerName: string;
  projectName: string;
  description: string;
  dueAt: Date;
  status: "positive" | "neutral" | "negative";
}

interface DashboardFollowUpsProps {
  pendingFollowUpCount: number;
  followUpTone?: "positive" | "neutral" | "negative";
  followUpItems: FollowUpItem[];
}

const statusConfig: Record<
  "positive" | "neutral" | "negative",
  { bg: string; text: string; ring: string }
> = {
  positive: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    ring: "ring-emerald-500",
  },
  neutral: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-500",
  },
  negative: { bg: "bg-red-100", text: "text-red-700", ring: "ring-red-500" },
};

export function DashboardFollowUps({
  pendingFollowUpCount,
  followUpTone = "neutral",
  followUpItems,
}: DashboardFollowUpsProps) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between border-b border-border/60 pb-4">
        <h4 className="uppercase font-bold text-muted-foreground">
          Follow-ups Due Today
        </h4>
        <Badge
          className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${(statusConfig[followUpTone] ?? statusConfig.neutral).bg} ${(statusConfig[followUpTone] ?? statusConfig.neutral).text}`}
        >
          {pendingFollowUpCount} Pending
        </Badge>
      </CardHeader>
      <CardContent>
        {followUpItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 mt-16">
            <div className="flex size-12 items-center justify-center">
              <Activity className="size-5 text-muted-foreground" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No follow-ups available
              </p>

              <p className="text-xs text-muted-foreground">
                Your follow-ups will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="relative pl-7 before:absolute before:left-1.25 before:top-2 before:bottom-2 before:w-0.5 before:bg-border before:rounded-full">
            {followUpItems.map((item) => (
              <article key={item.id} className="relative pb-5 last:pb-0">
                <div
                  className={`absolute left-[-27.5px] top-1 size-2.5 rounded-full border-2 border-white ring-2 ring-offset-background z-10 ${(statusConfig[item.status] ?? statusConfig.neutral).bg} ${(statusConfig[item.status] ?? statusConfig.neutral).ring}`}
                />
                <p className="text-[13px] font-bold text-slate-900">
                  <span className="font-semibold">{item.customerName}</span> -{" "}
                  <span className="text-sm text-muted-foreground">
                    {item.projectName}
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground max-w-50 truncate">
                  {item.description}
                </p>
                <p
                  className={`mt-1.5 text-[11px] font-medium ${(statusConfig[item.status] ?? statusConfig.neutral).text}`}
                >
                  {timeFormat.format(new Date(item.dueAt))}
                </p>
                <Badge
                  className={`absolute right-4 top-4 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${(statusConfig[followUpTone] ?? statusConfig.neutral).bg} ${(statusConfig[followUpTone] ?? statusConfig.neutral).text}`}
                >
                  {pendingFollowUpCount} Pending
                </Badge>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
