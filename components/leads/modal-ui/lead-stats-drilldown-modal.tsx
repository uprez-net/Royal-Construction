"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { fetchLeads } from "@/lib/leads/leads-service";
import { Lead, LeadStage } from "@/lib/leads/types";
import { formatFollowup } from "@/lib/leads/lead-helpers";
import { FetchError } from "@/utils/fetch";

interface LeadStatsDrilldownModalProps {
  title: string;
  stage?: LeadStage[];
  upcomingFollowUps?: boolean;
  pendingFollowUps?: boolean;
  pendingMeetings?: boolean;
  upcomingMeetings?: boolean;
  onClose: () => void;
}

export function LeadStatsDrilldownModal({
  title,
  stage,
  upcomingFollowUps,
  pendingFollowUps,
  pendingMeetings,
  upcomingMeetings,
  onClose,
}: LeadStatsDrilldownModalProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const timeout = setTimeout(() => {
      setLoading(true);
      setError(null);

      fetchLeads({ page: 1, limit: 25, status: stage, upcomingFollowUps, pendingFollowUps, pendingMeetings, upcomingMeetings })
        .then((result) => {
          if (!cancelled) {
            setLeads(result.items);
          }
        })
        .catch((err: unknown) => {
          // A failed load used to be an unhandled rejection that left the
          // modal saying "No leads found." as if the stage were empty. Same
          // wording rule as the lead picker: FetchError carries the API's
          // message, anything else is the browser's network text.
          if (!cancelled) {
            setLeads([]);
            setError(err instanceof FetchError ? err.message : "Failed to fetch leads");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [stage, upcomingFollowUps, pendingFollowUps, pendingMeetings, upcomingMeetings]);

  return (
    <ModalShell
      open
      onClose={onClose}
      title={title}
      maxWidthClass="max-w-[820px]"
    >
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading leads...</div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive-light px-4 py-3 text-sm"
        >
          <p className="font-medium text-destructive-ink">{error}</p>
          <p className="mt-1 text-muted-foreground">
            Close this and open it again to retry.
          </p>
        </div>
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
              <div
                key={lead.id}
                className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
              >
                <div>
                  <div className="font-medium text-foreground">{lead.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {lead.email}
                  </div>
                </div>
                <div>{lead.stage}</div>
                <div>
                  {lead.followupDate
                    ? formatFollowup(lead.followupDate, lead.followupTime)
                    : lead.meetingDate
                      ? `${lead.meetingDate} ${lead.meetingTime ?? ""}`
                      : "-"}
                </div>
                <div>{lead.assignedUser?.name || "Unassigned"}</div>
              </div>
            ))}
            {leads.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No leads found.
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
