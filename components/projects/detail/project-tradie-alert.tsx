import { ProjectDetail, TradieScheduleListItem } from "@/types/project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Wrench } from "lucide-react";
import { useMemo } from "react";
import { dateFormat } from "@/utils/formatters";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { selectTradieAlerts } from "@/lib/projects/project-warnings";

export function ProjectTradieAlert({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const tradieAlerts = useMemo(
    () => selectTradieAlerts(project.tradieSchedules),
    [project.tradieSchedules],
  );

  const handleSendReminder = (tradieReminder: TradieScheduleListItem) => {
    dispatch(
      openModal({
        type: "tradieReminder",
        payload: { schedule: tradieReminder },
      }),
    );
  };

  // Empty chrome was eating a full card slot between budget cards and tabs on
  // every quiet project. Alerts only earn the surface when there is something
  // to act on; the "none" case is silence, not a placeholder panel.
  if (tradieAlerts.length === 0) {
    return null;
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle
          as="h2"
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-warning-ink" aria-hidden="true" />
          Upcoming alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {tradieAlerts.slice(0, 4).map((schedule) => (
          <article
            key={schedule.id}
            className="flex items-center gap-3 rounded-[10px] border border-border/70 bg-card p-3.5"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-warning-light text-warning-ink">
              <Wrench className="size-5" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {schedule.tradie.trade} • {schedule.tradie.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ABN{" "}
                <span className="font-mono tabular-nums">
                  {schedule.tradie.abn}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Needed for {schedule.milestone?.name ?? "general works"} on{" "}
                <span className="font-mono tabular-nums">
                  {dateFormat.format(new Date(schedule.scheduledDate))}
                </span>
              </p>
            </div>

            <div className="ml-auto">
              <Button
                variant="outline"
                size="icon"
                className="size-9"
                aria-label={`Send reminder to ${schedule.tradie.name}`}
                onClick={() =>
                  handleSendReminder({
                    id: schedule.id,
                    tradieId: schedule.tradieId,
                    milestoneId: schedule.milestoneId ?? undefined,
                    scheduledDate: new Date(
                      schedule.scheduledDate,
                    ).toISOString(),
                    status: schedule.status,
                    abn: schedule.tradie.abn,
                    tradieName: schedule.tradie.name,
                    lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
                    tradeType: schedule.tradie.trade,
                    projectId: schedule.projectId,
                    projectName: project.name,
                    taskLabel: `${project.milestones.find((m) => m.id === schedule.milestoneId)?.name ?? "General"} - ${schedule.tradie.trade}`,
                    durationDays: schedule.durationDays,
                    updatedAt: new Date(schedule.updatedAt).toISOString(),
                    contact: {
                      email: schedule.tradie.email,
                      phone: schedule.tradie.phone,
                      additionalEmails: schedule.tradie.additionalEmails,
                    },
                    siteManager: {
                      name: project.siteManager?.name ?? "Site Manager",
                      email:
                        project.siteManager?.email ?? "Site Manager Email",
                      phone:
                        project.siteManager?.phone ?? "Site Manager Phone",
                    },
                    isFavourite: schedule.tradie.isFavourite,
                    note: schedule.tradie.note,
                    requiresQuote: schedule.requiresQuote,
                    quotedPrice: schedule.quotedPrice ?? undefined,
                  } satisfies TradieScheduleListItem)
                }
              >
                <Bell className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
