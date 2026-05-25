import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Send, Download, Receipt, Search, Files } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";

import { currency, dataTimeFormat, formatFileSize } from "@/utils/formatters";
import { ProjectDetail } from "@/types/project";
import { DataTable } from "@/components/common/data-table";
import { Input } from "@/components/ui/input";
import { useState } from "react";

function getQuoteTypeTone(type: string) {
  if (type === "Initial") return "purple" as const;
  if (type === "Variation") return "primary" as const;
  return "neutral" as const;
}

interface ProjectQuotesTabProps {
  project: ProjectDetail;
}

export function ProjectQuotesTab({ project }: ProjectQuotesTabProps) {
  const files = project.files;
  const [query, setQuery] = useState("");

  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Project Documents
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-[220px] transition-all focus-within:w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[13px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents..."
                className="pl-[32px] h-9 text-[12.5px] rounded-lg bg-white"
                aria-label="Search documents"
              />
            </div>
            <Button
              size="sm"
              className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
            >
              <Plus className="mr-1 size-4" />
              Upload Document
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-0">
        <div className="overflow-x-auto">
          <DataTable
            headers={[
              "Document #",
              "Name",
              "Size",
              "Type",
              "Milestone",
              "Uploaded At",
              <div key="action" className="text-right">
                Action
              </div>,
            ]}
            rows={files.map((file, index) => [
              <span
                key={`${file.id}-number`}
                className="font-semibold text-slate-900"
              >
                {index + 1}
              </span>,
              <span key={`${file.id}-name`}>{file.filename}</span>,
              <StatusPill key={`${file.id}-type`} tone={"primary"}>
                {file.fileType}
              </StatusPill>,
              <span key={`${file.id}-size`}>
                {formatFileSize(file.filesize)}
              </span>,
              <span key={`${file.id}-milestone`}>
                {file.milestoneId
                  ? project.milestones.find((m) => m.id === file.milestoneId)
                      ?.name
                  : "—"}
              </span>,
              <span key={`${file.id}-uploadedAt`}>
                {dataTimeFormat.format(new Date(file.createdAt))}
              </span>,

              <div
                key={`${file.id}-actions`}
                className="flex justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Eye className="size-3.5" />
                </button>

                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Send className="size-3.5" />
                </button>

                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Download className="size-3.5" />
                </button>
              </div>,
            ])}
            onRowClick={(rowIndex) => {
              const file = files[rowIndex];

              // handle file click
              console.log(file);
            }}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Files className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No Document available yet.
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Project related documents will appear here.
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
