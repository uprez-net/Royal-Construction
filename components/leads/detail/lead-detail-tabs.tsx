"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Lead } from "@/lib/leads/types";
import { fetchOpenTasks, type LeadTaskRow } from "@/lib/leads/task-service";
import { useAppSelector } from "@/lib/store/hooks";

import { LeadDocumentsTab } from "./lead-documents-tab";
import { LeadNotesTab } from "./lead-notes-tab";
import { LeadOverviewTab } from "./lead-overview-tab";
import { LeadScheduledWorkTab } from "./lead-scheduled-work-tab";
import {
  LEAD_DETAIL_TABS,
  LeadTabNavigation,
  isLeadDetailTab,
  leadTabPanelId,
  leadTabTriggerId,
  type LeadDetailTabKey,
} from "./lead-tab-navigation";
import { useWebMcpTool } from "@/hooks/use-webmcp-tool";
import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import { leadSurfaceTools } from "@/lib/tools/surfaces";

/** Module-level so the declaration the registration hook hashes stays stable. */
const leadTabToolSchema = {
  type: "object",
  properties: {
    tab: {
      type: "string",
      enum: [...LEAD_DETAIL_TABS],
      description: "The tab to open.",
    },
  },
  required: ["tab"],
  additionalProperties: false,
} as const;

export function LeadDetailTabs({
  lead,
  availableUsers,
  onLeadUpdate,
  onFilesUploaded,
}: {
  lead: Lead;
  availableUsers: { id: string; name: string }[];
  onLeadUpdate: (lead: Lead) => void;
  onFilesUploaded: (files: Lead["uploadedFiles"]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("activeTab");
  // `searchParams` is a fresh object on every navigation; the serialized string
  // is what handleTabChange actually needs, and it keeps the callback stable.
  const searchParamsString = searchParams.toString();

  // State drives the panel so a tab switch paints immediately; the URL is
  // written behind it. Reading the URL only as the seed keeps a click off the
  // server round-trip that `router.replace` starts.
  const [activeTab, setActiveTab] = useState<LeadDetailTabKey>(() =>
    urlTab && isLeadDetailTab(urlTab) ? urlTab : "overview",
  );

  // URL → state for back/forward, adjusted during render rather than in an
  // effect so the correct panel renders in the same pass instead of flashing
  // the previous one. https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastUrlTab, setLastUrlTab] = useState(urlTab);
  if (urlTab !== lastUrlTab) {
    setLastUrlTab(urlTab);
    if (urlTab && isLeadDetailTab(urlTab)) setActiveTab(urlTab);
  }

  // Open tasks live here so the tab badge and the Scheduled work panel share
  // one list. The lead payload from the list query carries none.
  const [openTasks, setOpenTasks] = useState<LeadTaskRow[]>([]);
  const tasksVersion = useAppSelector((state) => state.ui.leadTasksVersion);
  useEffect(() => {
    const controller = new AbortController();
    // Scoped to this lead, not filtered from the org-wide list. That filter
    // ran against the 200 soonest-due tasks in the business, so a lead whose
    // work sorted past the cap showed an empty Tasks tab over real bookings.
    fetchOpenTasks({ leadIds: [lead.id], signal: controller.signal })
      .then(setOpenTasks)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Could not load tasks for this lead", err);
      });
    return () => controller.abort();
  }, [lead.id, tasksVersion]);

  // State → URL, so a tab can be deep-linked, shared and reached with the
  // browser's back button.
  const handleTabChange = useCallback(
    (tab: LeadDetailTabKey) => {
      setActiveTab(tab);

      const params = new URLSearchParams(searchParamsString);
      params.set("activeTab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  /* ── WebMCP: move between this lead's tabs ──
     Only the open tab's panel is mounted, so each tab's tools appear and
     disappear with it. Goes through handleTabChange so the URL follows the
     state, the way it does for a click. */
  useWebMcpTool({
    name: "navigate_to_lead_tab",
    title: "Switch lead tab",
    description:
      "Opens one of the tabs on the lead currently in view. Each tab registers its own tools while it is open, so switching is how you reach them \u2014 the result says which ones this tab carries.",
    inputSchema: leadTabToolSchema as unknown as Record<string, unknown>,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const tab = String(input.tab ?? "");
      if (!isLeadDetailTab(tab)) {
        return webMcpError(
          `Unknown lead tab "${tab}". Available: ${LEAD_DETAIL_TABS.join(", ")}.`,
        );
      }

      handleTabChange(tab);

      return webMcpJson({
        tab,
        leadId: lead.id,
        toolsNowAvailable: leadSurfaceTools(tab),
      });
    },
  });

  return (
    <section className="space-y-4">
      <LeadTabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        badges={{
          scheduledWork:
            openTasks.length > 0
              ? {
                  count: String(openTasks.length),
                  description: `${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}`,
                }
              : undefined,
          documents:
            lead.uploadedFiles.length > 0
              ? {
                  count: String(lead.uploadedFiles.length),
                  description: `${lead.uploadedFiles.length} documents uploaded`,
                }
              : undefined,
          notes:
            lead.history.length > 0
              ? {
                  count: String(lead.history.length),
                  description: `${lead.history.length} activity entries recorded`,
                }
              : undefined,
        }}
      />

      <div
        role="tabpanel"
        id={leadTabPanelId(activeTab)}
        aria-labelledby={leadTabTriggerId(activeTab)}
        tabIndex={0}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {activeTab === "overview" ? (
          <LeadOverviewTab
            lead={lead}
            availableUsers={availableUsers}
            onLeadUpdate={onLeadUpdate}
          />
        ) : null}
        {activeTab === "scheduledWork" ? (
          <LeadScheduledWorkTab
            lead={lead}
            openTasks={openTasks}
            onTasksChange={setOpenTasks}
            onLeadUpdate={onLeadUpdate}
          />
        ) : null}
        {activeTab === "documents" ? (
          <LeadDocumentsTab lead={lead} onFilesUploaded={onFilesUploaded} />
        ) : null}
        {activeTab === "notes" ? (
          <LeadNotesTab
            lead={lead}
            availableUsers={availableUsers}
            onLeadUpdate={onLeadUpdate}
          />
        ) : null}
      </div>
    </section>
  );
}
