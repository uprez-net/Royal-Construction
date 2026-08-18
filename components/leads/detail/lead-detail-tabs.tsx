"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Lead } from "@/lib/leads/types";

import { LeadDocumentsTab } from "./lead-documents-tab";
import { LeadNotesTab } from "./lead-notes-tab";
import { LeadOverviewTab } from "./lead-overview-tab";
import {
  LeadTabNavigation,
  isLeadDetailTab,
  leadTabPanelId,
  leadTabTriggerId,
  type LeadDetailTabKey,
} from "./lead-tab-navigation";

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

  return (
    <section className="space-y-4">
      <LeadTabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        badges={{
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
