"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { normalizeTypes } from "@/lib/leads/lead-helpers";
import { fetchAllLeads } from "@/lib/leads/leads-service";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { Download, Plus, RotateCw } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DashboardHeaderProps {
  name: string;
  newLeadsCount: number;
  newProjectsCount: number;
  followUpsCount: number;
}

export function DashboardHeader({
  name,
  newLeadsCount,
  newProjectsCount,
  followUpsCount,
}: DashboardHeaderProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const allLeads = await fetchAllLeads();
      const leadHeader = [
        "leadId",
        "name",
        "phone",
        "email",
        "location",
        "SourceDetail",
        "Stage",
        "assigned",
        "budget",
        "notes",
        "FollowupsDate",
        "FollowupTime",
        "type",
        "lostReason",
        "urgent",
      ];
      const leadRows = allLeads.map((l) => {
        const types = normalizeTypes(l.type).filter((t) => t !== "Not Specified");
        return [
          l.id,
          l.name,
          l.phone,
          l.email,
          l.location,
          l.sourceDetail,
          l.stage,
          l.assignedUser?.name || "",
          l.budget,
          l.notes || "",
          l.followupDate || "",
          l.followupTime || "",
          types.join(", "),
          l.lostReason || "",
          l.urgent ? "true" : "false",
        ];
      });
      const historyHeader = ["leadId", "action", "detail", "type", "actionDate"];
      const historyRows = allLeads.flatMap((l) =>
        (l.history ?? []).map((e) => [
          l.id,
          e.action,
          e.detail,
          e.type,
          `${e.date} ${e.time}`.trim(),
        ]),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([leadHeader, ...leadRows]),
        "Lead Data",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([historyHeader, ...historyRows]),
        "History",
      );
      XLSX.writeFile(
        wb,
        `Royal_Constructions_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error) {
      console.error("Failed to export leads:", error);
      toast.error("Failed to export leads");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardContent className="p-4 sm:p-5 lg:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Operations today
              </p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                Sat Sri Akal, {name}!
              </h2>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-left sm:min-w-90 sm:text-right">
              <div>
                <dt className="text-xs text-muted-foreground">Leads</dt>
                <dd className="font-mono text-sm font-semibold text-foreground">
                  {newLeadsCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Projects</dt>
                <dd className="font-mono text-sm font-semibold text-foreground">
                  {newProjectsCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Follow-ups</dt>
                <dd className="font-mono text-sm font-semibold text-foreground">
                  {followUpsCount}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button onClick={() => dispatch(openModal({ type: "createLead" }))}>
              <Plus className="mr-2 size-4" />
              Add Lead
            </Button>

            <Button
              variant="outline"
              onClick={() => void handleExport()}
              disabled={isExporting}
            >
              {isExporting ? (
                <span className="flex items-center">
                  <RotateCw className="mr-2 size-4 animate-spin" /> Exporting...
                </span>
              ) : (
                <span className="flex items-center">
                  <Download className="mr-2 size-4" /> Export Leads
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="items-center justify-center"
              onClick={() => router.refresh()}
              aria-label="Refresh dashboard"
            >
              <RotateCw className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
