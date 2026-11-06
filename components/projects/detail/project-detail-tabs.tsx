"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { ProjectDetail } from "@/types/project";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  selectProjectDetailUiState,
  setProjectDetailTab,
} from "@/lib/store/slices/projectsSlice";

import { ProjectMilestonesTab } from "./project-milestones-tab";
import { ProjectOverviewTab } from "./project-overview-tab";
import { ProjectPaymentsTab } from "./project-payments-tab";
import { ProjectFinancialsTab } from "./financials-tab/project-financials-tab";
import { ProjectVariationsTab } from "./project-variations-tab";
import { ProjectDocumentsTab } from "./project-documents-tab";
import {
  ProjectTabNavigation,
  isVisibleProjectDetailTab,
  projectTabPanelId,
  projectTabTriggerId,
  type VisibleProjectDetailTabKey,
} from "./project-tab-navigation";
import { ProjectTradiesTab } from "./project-tradies-tab";
import { ProjectHistoryTabs } from "./project-history-tabs";
import { ProjectCommunicationTabs } from "./project-communication-tabs";
import { ProjectComplianceTab } from "./compliance-tab/project-compliance-tab";
import { Role } from "@prisma/client";
import { UploadHintScope } from "@/components/common/upload-hints";

/**
 * What an upload made inside each tab is filed under: the step of its origin
 * trail, and the tag the tab implies. Overview implies nothing on its own; its
 * upload controls name what they are for.
 */
const TAB_UPLOAD_HINTS: Record<
  VisibleProjectDetailTabKey,
  { trail: string; tags: string[] }
> = {
  overview: { trail: "Overview", tags: [] },
  milestones: { trail: "Milestones", tags: ["Milestone"] },
  payments: { trail: "Payments", tags: ["Payments"] },
  financials: { trail: "Financials", tags: ["Financials"] },
  variations: { trail: "Variations", tags: ["Variation"] },
  tradies: { trail: "Tradies", tags: ["Tradies"] },
  docs: { trail: "Documents", tags: ["Project document"] },
  history: { trail: "History", tags: [] },
  communications: { trail: "Communications", tags: ["Communication"] },
  compliance: { trail: "Compliance", tags: ["Compliance"] },
};

export function ProjectDetailTabs({
  project,
  role,
}: {
  project: ProjectDetail;
  role: Role;
}) {
  const isAdmin = role === "ADMIN";
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("activeTab");

  const selector = useMemo(
    () => selectProjectDetailUiState(project.id),
    [project.id],
  );
  const detailUi = useAppSelector(selector);

  // The store may hold a tab that is no longer navigable (see
  // VISIBLE_PROJECT_DETAIL_TABS); fall back rather than render nothing.
  const activeTab: VisibleProjectDetailTabKey = isVisibleProjectDetailTab(
    detailUi.activeTab,
  )
    ? detailUi.activeTab
    : "overview";

  // URL → store. Runs on mount for deep links and again on back/forward.
  // Only when the URL itself moves: a click updates the store first, and the
  // URL catching up a render later must not snap the tab back.
  const seenUrlTab = useRef<string | null>(null);
  useEffect(() => {
    if (urlTab === seenUrlTab.current) return;
    seenUrlTab.current = urlTab;
    if (urlTab && isVisibleProjectDetailTab(urlTab) && urlTab !== activeTab) {
      dispatch(setProjectDetailTab({ projectId: project.id, tab: urlTab }));
    }
  }, [activeTab, dispatch, project.id, urlTab]);

  // Store → URL, so a tab can be deep-linked, shared and reached with the
  // browser's back button. replaceState rather than router.replace: every tab
  // renders from data already on the page, and router.replace re-renders the
  // whole server page on each click.
  const handleTabChange = useCallback(
    (tab: VisibleProjectDetailTabKey) => {
      dispatch(setProjectDetailTab({ projectId: project.id, tab }));

      const params = new URLSearchParams(window.location.search);
      params.set("activeTab", tab);
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [dispatch, pathname, project.id],
  );

  return (
    <section className="space-y-4">
      <ProjectTabNavigation
        project={project}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isAdmin={isAdmin}
      />

      <div
        role="tabpanel"
        id={projectTabPanelId(activeTab)}
        aria-labelledby={projectTabTriggerId(activeTab)}
        tabIndex={0}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <UploadHintScope
          trail={TAB_UPLOAD_HINTS[activeTab]?.trail}
          tags={TAB_UPLOAD_HINTS[activeTab]?.tags}
        >
          {activeTab === "overview" ? (
            <ProjectOverviewTab project={project} isAdmin={isAdmin} />
          ) : null}
          {activeTab === "milestones" ? (
            <ProjectMilestonesTab project={project} isAdmin={isAdmin} />
          ) : null}
          {activeTab === "payments" && isAdmin ? (
            <ProjectPaymentsTab project={project} />
          ) : null}
          {activeTab === "financials" && isAdmin ? (
            <ProjectFinancialsTab project={project} />
          ) : null}
          {activeTab === "variations" && isAdmin ? (
            <ProjectVariationsTab project={project} />
          ) : null}
          {activeTab === "tradies" ? (
            <ProjectTradiesTab project={project} />
          ) : null}
          {activeTab === "docs" ? (
            <ProjectDocumentsTab project={project} isAdmin={isAdmin} />
          ) : null}
          {activeTab === "history" ? (
            <ProjectHistoryTabs project={project} />
          ) : null}
          {activeTab === "communications" ? (
            <ProjectCommunicationTabs project={project} />
          ) : null}
          {activeTab === "compliance" ? (
            <ProjectComplianceTab project={project} isAdmin={isAdmin} />
          ) : null}
        </UploadHintScope>
      </div>
    </section>
  );
}
