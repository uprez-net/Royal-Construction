"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { normalizeTypes } from "@/lib/leads/lead-helpers";
import { fetchAllLeads } from "@/lib/leads/leads-service";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { Download, Plus, RotateCw } from "lucide-react";
import { useTransition } from "react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";

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
  const [isPending, startTransition] = useTransition();

  const handleExport = async () => {
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
  };

  return (
    <Card className="overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
      <CardContent className="relative p-6">
        <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
        <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              Sat Sri Akal, {name}!
            </h2>
            <p className="text-sm text-slate-600">
              {newLeadsCount} new leads this month, {newProjectsCount} active
              projects across NSW. {followUpsCount} follow-ups due.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => dispatch(openModal({ type: "createLead" }))}>
              <Plus className="mr-2 size-4" />
              Add Lead
            </Button>

            <Button
              variant="outline"
              onClick={() => startTransition(handleExport)}
              disabled={isPending}
            >
              {isPending ? (
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
            >
              <RotateCw className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
