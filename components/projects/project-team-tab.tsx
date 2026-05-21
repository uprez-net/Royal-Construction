import {
  BadgeCheck,
  Clock3,
  MessageSquare,
  Phone,
  Plus,
  QrCode,
  MapPin,
  TrendingUp,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { DataTable } from "../common/data-table";

type Worker = {
  name: string;
  role: string;
  hours: number;
};

type Project = {
  location: string;
  stage: string;
  manager: string;
  workers: Worker[];
};

export function TeamTab({ project }: { project: Project }) {
  const totalHours = project.workers.reduce(
    (sum, worker) => sum + worker.hours,
    0,
  );

  const workerRows = project.workers.map((worker) => {
    const initials = worker.name
      .split(" ")
      .map((name) => name[0])
      .join("");

    return [
      <div key={`${worker.name}-worker`} className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">
          {initials}
        </div>

        <span className="font-medium text-foreground">{worker.name}</span>
      </div>,

      <span key={`${worker.name}-role`} className="text-muted-foreground">
        {worker.role}
      </span>,

      <span
        key={`${worker.name}-hours`}
        className="font-semibold text-foreground"
      >
        {worker.hours} hrs
      </span>,

      <Badge
        key={`${worker.name}-status`}
        variant="secondary"
        className="gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-emerald-700 dark:text-emerald-400"
      >
        <MapPin className="h-3 w-3" />
        Checked In
      </Badge>,

      <Button
        key={`${worker.name}-action`}
        variant="outline"
        size="sm"
        className="h-8"
        onClick={(event) => {
          event.stopPropagation();

          toast.info(`Opening attendance for ${worker.name}...`);
        }}
      >
        <Clock3 className="mr-2 h-4 w-4" />
        History
      </Button>,
    ];
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {project.workers.length} workers assigned
          </p>

          <p className="text-xs text-muted-foreground">
            GPS-tracked via site QR code
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.info(`Generating QR code for ${project.location}...`)
            }
          >
            <QrCode className="mr-2 h-4 w-4" />
            Regenerate QR
          </Button>

          <Button
            size="sm"
            onClick={() => toast.info("Opening worker assignment...")}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Worker
          </Button>
        </div>
      </div>

      {/* QR Info */}
      <Card className="border-teal-500/15 bg-teal-500/5">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/10">
            <QrCode className="h-6 w-6 text-teal-600" />
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              Site QR Code — {project.location}
            </h3>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Workers scan on arrival for GPS-verified attendance. Total this
              week:{" "}
              <span className="font-semibold text-foreground">
                {totalHours} hrs
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Workers Table */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="overflow-x-auto no-scrollbar">
          <DataTable
            headers={["Worker", "Role", "Hours/Week", "Status", "Actions"]}
            rows={workerRows}
            onRowClick={(rowIndex) => {
              const worker = project.workers[rowIndex];

              toast.info(`Viewing ${worker.name}'s details...`);
            }}
            emptyState={
              <Card className="rounded-2xl border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                    <Users className="h-7 w-7 text-muted-foreground" />
                  </div>

                  <h3 className="text-sm font-semibold text-foreground">
                    No workers assigned yet
                  </h3>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Project is currently in {project.stage}.
                  </p>
                </CardContent>
              </Card>
            }
          />
        </div>
      </div>
      {/* Site Manager */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck className="h-4 w-4 text-primary" />
            Site Manager: {project.manager}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Responsible for milestone photo uploads, tradie coordination, and
            daily site updates.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(`Messaging ${project.manager}...`)}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Message
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(`Calling ${project.manager}...`)}
            >
              <Phone className="mr-2 h-4 w-4" />
              Call
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Viewing performance...")}
            >
              <TrendingUp className="mr-2 h-4 w-4" />
              Performance
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
