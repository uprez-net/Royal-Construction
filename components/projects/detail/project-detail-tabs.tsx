"use client";

import { useMemo } from "react";

import type { ProjectDetail } from "@/types/project";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  selectProjectDetailUiState,
  setProjectDetailTab,
} from "@/lib/store/slices/projectsSlice";

import { ProjectMaterialsTab } from "./project-materials-tab";
import { ProjectMilestonesTab } from "./project-milestones-tab";
import { ProjectOverviewTab } from "./project-overview-tab";
import { ProjectPaymentsTab } from "./project-payments-tab";
import { ProjectQuotesTab } from "./project-quotes-tab";
import { ProjectTabNavigation } from "./project-tab-navigation";
import { ProjectVariationsTab } from "./project-variations-tab";
import { ProjectWorkersTab } from "./project-workers-tab";
import { ProjectSiteUpdatesTab } from "./project-site-updates-tab";
import { ProjectTradiesTab } from "./project-tradies-tab";

export function ProjectDetailTabs({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const selector = useMemo(
    () => selectProjectDetailUiState(project.id),
    [project.id],
  );
  const detailUi = useAppSelector(selector);

  return (
    <section className="space-y-4">
      <ProjectTabNavigation
        project={project}
        activeTab={detailUi.activeTab}
        onTabChange={(tab) =>
          dispatch(setProjectDetailTab({ projectId: project.id, tab }))
        }
      />

      {detailUi.activeTab === "overview" ? (
        <ProjectOverviewTab project={project} />
      ) : null}
      {detailUi.activeTab === "milestones" ? (
        <ProjectMilestonesTab project={project} />
      ) : null}
      {detailUi.activeTab === "materials" ? (
        <ProjectMaterialsTab project={project} />
      ) : null}
      {detailUi.activeTab === "payments" ? (
        <ProjectPaymentsTab project={project} />
      ) : null}
      {detailUi.activeTab === "updates" ? (
        <ProjectSiteUpdatesTab project={project} />
      ) : null}
      {detailUi.activeTab === "tradies" ? (
        <ProjectTradiesTab project={project} />
      ) : null}
      {detailUi.activeTab === "workers" ? (
        <ProjectWorkersTab project={project} />
      ) : null}
      {detailUi.activeTab === "quotes" ? (
        <ProjectQuotesTab project={project} />
      ) : null}
      {detailUi.activeTab === "variations" ? (
        <ProjectVariationsTab project={project} />
      ) : null}
    </section>
  );
}
