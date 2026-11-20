import { Users } from "lucide-react";
import { DataTable } from "../common/data-table";
import { UserCell } from "../common/user-table-cell";

import { Button } from "../ui/button";
import {
  TableCard,
  TOOLBAR_BUTTON_CLASS,
} from "@/components/common/list-toolbar";
import { useRouter } from "next/navigation";

export interface SiteManagerPerformance {
  id: string;
  avatarUrl?: string;
  name: string;
  projectsCount: number;
  milestonesCompleted: number;
  milestonesTotal: number;
}

interface DashboardSiteManagerTableProps {
  siteManagers: SiteManagerPerformance[];
  /** The Manage button opens team admin, which is not for everyone. */
  canManage?: boolean;
}

export function DashboardSiteManagerTable({
  siteManagers,
  canManage = true,
}: DashboardSiteManagerTableProps) {
  const router = useRouter();
  return (
    <TableCard
      header={
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-[1.0625rem] leading-[1.3] font-semibold tracking-[-0.01em] text-foreground">
            Site Manager Performance
          </h2>

          {canManage && (
            <Button
              variant="outline"
              className={TOOLBAR_BUTTON_CLASS}
              onClick={() => router.push("/team")}
            >
              Manage
            </Button>
          )}
        </div>
      }
    >
      <div className="p-4 md:p-0">
        <DataTable
          flush
          mobileLayout="cards"
          mobileColumns={1}
          headers={["Manager", "Projects", "Milestones"]}
          rows={siteManagers.map((manager) => [
            <UserCell
              key={manager.id}
              name={manager.name}
              avatarUrl={manager.avatarUrl}
            />,
            manager.projectsCount.toString(),
            `${manager.milestonesCompleted}/${manager.milestonesTotal}`,
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
      </div>
    </TableCard>
  );
}
