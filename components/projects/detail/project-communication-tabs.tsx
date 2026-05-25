import { ProjectDetail } from "@/types/project";
import { MessageSquare, Plus, Search, User, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/common/data-table";
import { StatusPill } from "@/components/common/status-pill";
import { dataTimeFormat } from "@/utils/formatters";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ProjectCommunicationTabsProps {
  project: ProjectDetail;
}

interface CommunicationEntry {
  id: string;
  type: "message" | "email" | "call";
  from: string;
  to: string | string[];
  subject: string;
  message: string;
  timestamp: string;
  attachments?: {
    id: string;
    filename: string;
    url: string;
  }[];
}

const toLabel = (value: string) =>
  value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export function ProjectCommunicationTabs({
  project,
}: ProjectCommunicationTabsProps) {
  const communications: CommunicationEntry[] = [];
  const [query, setQuery] = useState("");

  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Project Communications
          </CardTitle>

          <div className="flex gap-2">
            <div className="relative w-full sm:w-[220px] transition-all focus-within:w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[13px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Messages..."
                className="pl-[32px] h-9 text-[12.5px] rounded-lg bg-white"
                aria-label="Search messages"
              />
            </div>
            <Button
              size="sm"
              className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
            >
              <Plus className="mr-1 size-4" />
              Send Message
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-0">
        <div className="overflow-x-auto">
          <DataTable
            headers={[
              "Message #",
              "Type",
              "Date",
              "From",
              "To",
              "Subject",
              "Message",
              "Attachments",
            ]}
            rows={communications.map((comms, index) => [
              <span
                key={`${comms.id}-number`}
                className="font-semibold text-slate-900"
              >
                {index + 1}
              </span>,

              <StatusPill key={`${comms.id}-type`} tone={"primary"}>
                {toLabel(comms.type)}
              </StatusPill>,

              <span key={`${comms.id}-date`}>
                {dataTimeFormat.format(new Date(comms.timestamp))}
              </span>,

              <span key={`${comms.id}-from`} className="text-slate-700">
                <User className="size-4 mr-1 inline-block text-muted-foreground" />
                {comms.from}
              </span>,

              <span key={`${comms.id}-to`} className="text-slate-700">
                {Array.isArray(comms.to) ? (
                  <>
                    <Users className="size-4 mr-1 inline-block text-muted-foreground" />
                    {comms.to.map((r) => (
                      <Badge key={r} variant="outline" className="mr-1">
                        {r}
                      </Badge>
                    ))}
                  </>
                ) : (
                  <>
                    <User className="size-4 mr-1 inline-block text-muted-foreground" />
                    {comms.to}
                  </>
                )}
              </span>,

              <span key={`${comms.id}-subject`} className="text-slate-700">
                {comms.subject}
              </span>,

              <span key={`${comms.id}-message`} className="text-slate-700">
                {comms.message}
              </span>,

              <span key={`${comms.id}-attachments`} className="text-slate-700">
                {comms.attachments?.length || 0}
              </span>,
            ])}
            onRowClick={(rowIndex) => {
              const commsRow = communications[rowIndex];

              // handle quote click
              console.log(commsRow);
            }}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <MessageSquare className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No Communications available yet.
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Project communications will appear here.
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
