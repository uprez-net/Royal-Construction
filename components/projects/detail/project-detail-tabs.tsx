"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

export function ProjectDetailTabs({
  project,
  role,
}: {
  project: ProjectDetail;
  role: Role;
}) {
  const isAdmin = role === "ADMIN";
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("activeTab");
  // `searchParams` is a fresh object on every navigation; the serialized string
  // is what handleTabChange actually needs, and it keeps the callback stable.
  const searchParamsString = searchParams.toString();

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
  // Converges because it only dispatches when the two disagree.
  useEffect(() => {
    if (urlTab && isVisibleProjectDetailTab(urlTab) && urlTab !== activeTab) {
      dispatch(setProjectDetailTab({ projectId: project.id, tab: urlTab }));
    }
  }, [activeTab, dispatch, project.id, urlTab]);

  // Store → URL, so a tab can be deep-linked, shared and reached with the
  // browser's back button.
  const handleTabChange = useCallback(
    (tab: VisibleProjectDetailTabKey) => {
      dispatch(setProjectDetailTab({ projectId: project.id, tab }));

      const params = new URLSearchParams(searchParamsString);
      params.set("activeTab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [dispatch, pathname, project.id, router, searchParamsString],
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
      </div>
    </section>
  );
}
