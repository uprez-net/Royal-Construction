import {
  Download,
  Printer,
  ArrowRightCircle,
  CalendarRange,
  RadioTower,
  Users,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/common/status-pill";
import { workerAttendanceMock } from "@/lib/mock-data";
import { currency } from "@/utils/formatters";
import { ProjectDetail } from "@/types/project";
import { DataTable } from "@/components/common/data-table";

interface ProjectWorkersTabProps {
  project: ProjectDetail;
}

export function ProjectWorkersTab({ project }: ProjectWorkersTabProps) {
  const newProject = project.milestones.length === 0;
  const summary = newProject
    ? {
        checkedIn: 0,
        checkedOut: 0,
        stillOnSite: 0,
        totalHours: 0,
        dailyLabourEstimate: 0,
      }
    : workerAttendanceMock.summary;
  const workers = newProject ? [] : workerAttendanceMock.workers;

  return (
    <section className="grid gap-4 lg:grid-cols-[0.95fr_1.4fr]">
      <div className="space-y-4">
        <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl text-center">
          <CardHeader className="border-b border-border/60 pb-4 flex justify-center">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground text-center">
              Site QR Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            <div className="mx-auto grid size-[180px] place-items-center rounded-2xl border-2 border-dashed border-border/80 bg-white p-5">
              <svg
                viewBox="0 0 200 200"
                width="100%"
                height="100%"
                className="block mx-auto"
              >
                <rect
                  x="10"
                  y="10"
                  width="50"
                  height="50"
                  rx="4"
                  fill="#0F172A"
                />
                <rect
                  x="16"
                  y="16"
                  width="38"
                  height="38"
                  rx="2"
                  fill="white"
                />
                <rect
                  x="22"
                  y="22"
                  width="26"
                  height="26"
                  rx="2"
                  fill="#0F172A"
                />
                <rect
                  x="140"
                  y="10"
                  width="50"
                  height="50"
                  rx="4"
                  fill="#0F172A"
                />
                <rect
                  x="146"
                  y="16"
                  width="38"
                  height="38"
                  rx="2"
                  fill="white"
                />
                <rect
                  x="152"
                  y="22"
                  width="26"
                  height="26"
                  rx="2"
                  fill="#0F172A"
                />
                <rect
                  x="10"
                  y="140"
                  width="50"
                  height="50"
                  rx="4"
                  fill="#0F172A"
                />
                <rect
                  x="16"
                  y="146"
                  width="38"
                  height="38"
                  rx="2"
                  fill="white"
                />
                <rect
                  x="22"
                  y="152"
                  width="26"
                  height="26"
                  rx="2"
                  fill="#0F172A"
                />
                <rect x="70" y="10" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="10" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="10" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="10" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="26" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="26" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="42" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="42" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="42" width="8" height="8" fill="#0F172A" />
                <rect x="10" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="26" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="42" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="156" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="70" width="8" height="8" fill="#0F172A" />
                <rect x="10" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="42" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="86" width="8" height="8" fill="#0F172A" />
                <rect x="10" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="26" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="156" y="102" width="8" height="8" fill="#0F172A" />
                <rect x="26" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="42" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="118" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="156" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="140" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="156" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="156" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="156" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="156" width="8" height="8" fill="#0F172A" />
                <rect x="70" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="86" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="102" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="118" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="140" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="156" y="182" width="8" height="8" fill="#0F172A" />
                <rect x="182" y="182" width="8" height="8" fill="#0F172A" />
              </svg>
            </div>
            <div className="text-[11px] text-muted-foreground mb-1">
              <b>ID:</b> {workerAttendanceMock.qrId}
            </div>
            <div className="text-[11px] text-muted-foreground mb-1">
              <b>Site:</b> {workerAttendanceMock.qrSiteLabel}
            </div>
            <div className="text-[11px] text-muted-foreground mb-3">
              <b>Created:</b> {workerAttendanceMock.qrCreatedOn}
            </div>
            <div className="flex gap-1.5 justify-center mt-3">
              <Button
                size="sm"
                className="h-[30px] rounded-md bg-teal-600 px-[10px] text-[11.5px] font-semibold text-white hover:bg-teal-700"
              >
                <Download className="mr-1 size-3.5" /> Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-[30px] rounded-md px-[10px] text-[11.5px] font-semibold"
              >
                <Printer className="mr-1 size-3.5" /> Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-[30px] rounded-md px-[10px] text-[11.5px] font-semibold border-amber-200 text-[#D97706] hover:bg-amber-50"
              >
                <ArrowRightCircle className="mr-1 size-3.5" /> Regenerate
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Today&apos;s Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-4 px-4 pb-4">
            <SummaryTile
              label="Checked In"
              value={summary.checkedIn}
              colorClass="text-teal-600"
            />
            <SummaryTile
              label="Checked Out"
              value={summary.checkedOut}
              colorClass="text-green-600"
            />
            <SummaryTile
              label="Still On Site"
              value={summary.stillOnSite}
              colorClass="text-[#D97706]"
            />
            <SummaryTile
              label="Total Hours"
              value={summary.totalHours}
              colorClass="text-blue-600"
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Worker Attendance & GPS Tracking
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-lg px-[14px] text-[12.5px] font-semibold"
              >
                <Download className="mr-1 size-4" /> Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-lg px-[14px] text-[12.5px] font-semibold"
              >
                <CalendarRange className="mr-1 size-4" /> Weekly
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0 px-0 pb-5">
          <div className="overflow-x-auto">
            <DataTable
              headers={[
                "Worker",
                "Trade",
                "GPS",
                "Check-In",
                "Check-Out",
                "Hours",
                "Billing",
                "Status",
              ]}
              rows={workers.map((worker) => [
                <span
                  key={`${worker.id}-name`}
                  className="font-semibold text-slate-900"
                >
                  {worker.name}
                </span>,

                <span key={`${worker.id}-trade`}>{worker.trade}</span>,

                <span
                  key={`${worker.id}-gps`}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700"
                >
                  <RadioTower
                    className={`size-3.5 ${
                      worker.gpsActive ? "text-green-600" : "text-slate-400"
                    }`}
                  />

                  {worker.gpsActive ? "Active" : "Offline"}
                </span>,

                <span key={`${worker.id}-checkin`}>{worker.checkIn}</span>,

                <span key={`${worker.id}-checkout`}>{worker.checkOut}</span>,

                <span key={`${worker.id}-hours`}>
                  {worker.hours.toFixed(1)}h
                </span>,

                <span key={`${worker.id}-billing`}>
                  {currency.format(worker.hours * worker.hourlyRate)}
                </span>,

                <StatusPill
                  key={`${worker.id}-status`}
                  tone={worker.status === "On Site" ? "warning" : "success"}
                >
                  {worker.status}
                </StatusPill>,
              ])}
              onRowClick={(rowIndex) => {
                const worker = workers[rowIndex];

                // handle worker click
                console.log(worker);
              }}
              emptyState={
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="flex size-12 items-center justify-center">
                    <Users className="size-5 text-muted-foreground" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      No Worker Data available yet.
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Your Workers details will appear here.
                    </p>
                  </div>
                </div>
              }
            />
          </div>
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-[13px]">
              <b>Total Worker Hours Today:</b>{" "}
              <span className="ml-1 text-[13px] font-extrabold text-teal-600">
                {summary.totalHours.toFixed(1)} hrs
              </span>
            </div>
            <div className="text-[13px]">
              <b>Est. Daily Labour Cost:</b>{" "}
              <span className="ml-1 text-[13px] font-extrabold text-[#E8730C]">
                {currency.format(summary.dailyLabourEstimate)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number;
  colorClass: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className={`text-[20px] font-extrabold leading-tight ${colorClass}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
