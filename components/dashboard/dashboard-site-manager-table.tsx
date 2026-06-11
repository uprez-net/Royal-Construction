import { Users } from "lucide-react";
import { DataTable } from "../common/data-table";
import { RatingStars } from "../common/rating-stars";
import { UserCell } from "../common/user-table-cell";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader } from "../ui/card";
import { useRouter } from "next/navigation";

interface SiteManagerPerformance {
  id: string;
  avatarUrl?: string;
  name: string;
  projectsCount: number;
  workerHoursPerWeek: number;
  milestonesCompleted: number;
  milestonesTotal: number;
  rating: number; // 1-5 scale
}

interface DashboardSiteManagerTableProps {
  siteManagers: SiteManagerPerformance[];
}

export function DashboardSiteManagerTable({
  siteManagers,
}: DashboardSiteManagerTableProps) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader className="flex items-center justify-between border-b border-border/60 pb-4">
        <h4 className="uppercase font-bold text-muted-foreground">
          Site Manager Performance
        </h4>

        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/team")}
        >
          Manage
        </Button>
      </CardHeader>
      <CardContent>
        <DataTable
          headers={[
            "Manager",
            "Projects",
            "Worker Hrs/Week",
            "Milestones",
            "Rating",
          ]}
          rows={siteManagers.map((manager) => [
            <UserCell
              key={manager.id}
              name={manager.name}
              avatarUrl={manager.avatarUrl}
            />,
            manager.projectsCount.toString(),
            manager.workerHoursPerWeek.toString(),
            `${manager.milestonesCompleted}/${manager.milestonesTotal}`,
            <RatingStars key={manager.id} rating={manager.rating} />,
          ])}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <Users className="size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No site managers data available
                </p>

                <p className="text-xs text-muted-foreground">
                  Your site managers data will appear here.
                </p>
              </div>
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}
