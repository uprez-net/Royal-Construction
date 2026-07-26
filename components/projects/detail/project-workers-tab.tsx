import { QrCode } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDetail } from "@/types/project";

interface ProjectWorkersTabProps {
  project: ProjectDetail;
}

export function ProjectWorkersTab({ project }: ProjectWorkersTabProps) {
  // Trade bookings are the only worker-side data the project actually carries;
  // there is no attendance, check-in or QR record on the model.
  const bookingCount = project.tradieSchedules.length;

  return (
    <section className="space-y-4">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Worker attendance
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
              <QrCode
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </div>

            <p className="text-base font-semibold text-foreground">
              Site QR check-in is not enabled for this project
            </p>

            <p className="text-sm text-muted-foreground">
              With it enabled, this tab would list each worker on site with
              their check-in and check-out time, hours worked and the labour
              cost those hours come to. No check-in has been recorded against
              this project, and no site QR code has been issued for it.
            </p>

            <p className="text-sm text-muted-foreground">
              {bookingCount === 0
                ? "Trades booked to work on this project are listed on the Tradies tab."
                : `The ${bookingCount} trade ${bookingCount === 1 ? "booking" : "bookings"} on this project are listed on the Tradies tab.`}
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
