import type { ProjectDetail } from "@/types/project";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Image, FileText, Download } from "lucide-react";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { projectBudgetBurndownMock, projectOverviewMock } from "@/lib/mock-data";

import { currency, dataTimeFormat, dateFormat } from "../../../utils/formatters";

function DetailItem({ label, value, valueClass = "text-slate-900" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-[13px] font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  const totalBudget = Number(project.totalBudget);
  const activityLog = project.activityLogs || [];
  const spent = Number(project.spent);

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_2fr]">
      <div className="space-y-4">
        <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Project Details</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="grid gap-3 grid-cols-2">
                 <DetailItem label="Contract Value" value={currency.format(totalBudget)} valueClass="text-teal-600" />
                 <DetailItem label="Including Variations" value={projectOverviewMock.contractWithVariations} valueClass="text-[#E8730C]" />
              </div>
              <DetailItem label="Start Date" value={dateFormat.format(project.startDate)} />
              <DetailItem label="Expected Completion" value={dateFormat.format(project.estimatedEndDate)} />
              <DetailItem label="Site Manager" value={project.siteManager?.name ?? "Unassigned"} />
              <DetailItem label="Architect" value={projectOverviewMock.architect} />
              <DetailItem label="Building Type" value={projectOverviewMock.buildingType} />
              <DetailItem label="Lot Size" value={projectOverviewMock.lotSize} />
              <DetailItem label="Council" value={projectOverviewMock.council} />
              <DetailItem label="Certifier" value={projectOverviewMock.certifier} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-8 rounded-lg px-2.5 text-[11.5px] font-semibold text-slate-700">
                <Eye className="mr-1 size-3.5" /> Client Portfolio
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-lg px-2.5 text-[11.5px] font-semibold text-slate-700">
                <Image className="mr-1 size-3.5" /> Drawings
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-lg px-2.5 text-[11.5px] font-semibold text-green-700 border-green-200 bg-green-50 hover:bg-green-100 hover:text-green-800">
                <FileText className="mr-1 size-3.5" /> DA Approval
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <LineChartCard
          title="Budget Burn-Down"
          subtitle="Planned spend vs actual spend across project duration"
          data={projectBudgetBurndownMock}
          xKey="month"
          yAxisFormatter={(value) => `$${value}K`}
          series={[
            { key: "contract", label: "Contract", color: "var(--muted-foreground)", dashed: true },
            { key: "planned", label: "Planned Spend", color: "var(--chart-1)" },
            { key: "actual", label: "Actual Spend", color: "var(--chart-5)" },
          ]}
          action={
             <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-[11.5px] font-semibold">
                <Download className="mr-1 size-3.5" /> Export
             </Button>
          }
        />

        <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 pt-5">
            <div className="relative pl-7 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border before:rounded-full">
              {activityLog.map((item) => (
                <article key={item.id} className="relative pb-5 last:pb-0">
                  <div className={`absolute -left-[27.5px] top-1 size-[10px] rounded-full border-2 border-white ring-2 ring-offset-background z-10 bg-green-600 ring-green-600`} />
                  <p className="text-[13px] font-bold text-slate-900">{item.type}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground max-w-2xl">{item.message}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground font-medium">
                    {item.author?.name ?? "System"} • {dataTimeFormat.format(new Date(item.createdAt))}
                  </p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
