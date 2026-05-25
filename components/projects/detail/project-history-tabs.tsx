import { ProjectDetail } from "@/types/project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/common/data-table";
import { History, Plus, Search } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { dataTimeFormat } from "@/utils/formatters";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProjectHistoryTabsProps {
  project: ProjectDetail;
}

const toLabel = (value: string) =>
  value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const typeOptions = [
  { label: "All types", value: "__all__" },
  { label: "Leads", value: "lead" },
  { label: "Quotes", value: "quote" },
  { label: "Milestones", value: "milestone" },
  { label: "Payments", value: "payment" },
  { label: "Site updates", value: "site_update" },
  { label: "Tradies", value: "tradie" },
  { label: "Workers", value: "worker" },
  { label: "Variations", value: "variation" },
  { label: "Communications", value: "communication" },
] as const;

export function ProjectHistoryTabs({ project }: ProjectHistoryTabsProps) {
  const history = project.activityLogs.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Project History
          </CardTitle>

          <div className="flex gap-2 items-baseline">
            <Select
              value={typeFilter || "__all__"}
              onValueChange={(value) => {
                setTypeFilter(value === "__all__" ? "" : value);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value || "all"} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-[220px] transition-all focus-within:w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[13px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search history..."
                className="pl-[32px] h-9 text-[12.5px] rounded-lg bg-white"
                aria-label="Search history"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-0">
        <div className="overflow-x-auto">
          <DataTable
            headers={["History #", "Type", "Date", "Description", "Author"]}
            rows={history.map((history, index) => [
              <span
                key={`${history.id}-number`}
                className="font-semibold text-slate-900"
              >
                {index + 1}
              </span>,

              <StatusPill key={`${history.id}-type`} tone={"neutral"}>
                {toLabel(history.type)}
              </StatusPill>,

              <span key={`${history.id}-date`}>
                {dataTimeFormat.format(new Date(history.createdAt))}
              </span>,

              <span
                key={`${history.id}-description`}
                className="text-slate-700"
              >
                {history.message}
              </span>,

              <span key={`${history.id}-author`} className="text-slate-700">
                {history.author?.name || "System"}
              </span>,
            ])}
            onRowClick={(rowIndex) => {
              const historyRow = history[rowIndex];

              // handle quote click
              console.log(historyRow);
            }}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <History className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No History available yet.
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Project history will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
