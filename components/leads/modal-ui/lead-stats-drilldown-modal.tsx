"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { fetchLeads } from "@/lib/leads/leads-service";
import { Lead, LeadStage } from "@/lib/leads/types";
import { formatFollowup } from "@/lib/leads/lead-helpers";

interface LeadStatsDrilldownModalProps {
  title: string;
  stage?: LeadStage[];
  filterTiming?: string;
  onClose: () => void;
}

export function LeadStatsDrilldownModal({ title, stage, filterTiming, onClose }: LeadStatsDrilldownModalProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLeads({ page: 1, limit: 25, status: stage, filterTiming })
      .then((result) => {
        if (!cancelled) setLeads(result.items);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, filterTiming]);

  return (
    <ModalShell open onClose={onClose} title={title} maxWidthClass="max-w-[820px]">
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading leads...</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Lead</span>
            <span>Stage</span>
            <span>Follow-up</span>
            <span>Assigned</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {leads.map((lead) => (
              <div key={lead.id} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
                <div>
                  <div className="font-medium text-foreground">{lead.name}</div>
                  <div className="text-xs text-muted-foreground">{lead.email}</div>
                </div>
                <div>{lead.stage}</div>
                <div>{lead.followupDate ? formatFollowup(lead.followupDate, lead.followupTime) : lead.meetingDate ? `${lead.meetingDate} ${lead.meetingTime ?? ""}` : "-"}</div>
                <div>{lead.assignedUser?.name || "Unassigned"}</div>
              </div>
            ))}
            {leads.length === 0 && <div className="px-4 py-6 text-sm text-muted-foreground">No leads found.</div>}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
