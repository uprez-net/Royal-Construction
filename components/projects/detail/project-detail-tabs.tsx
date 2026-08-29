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
import { ProjectQuotesTab } from "./project-quotes-tab";
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
import { Role } from "@prisma/client";
import { useWebMcpTool } from "@/hooks/use-webmcp-tool";
import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import { NAVIGABLE_PROJECT_TABS, projectSurfaceTools } from "@/lib/tools/surfaces";

/**
 * Module-level so the tool's inputSchema is referentially stable. The
 * registration hook keys on a JSON serialisation of the declaration, so a
 * schema rebuilt each render would re-register the tool on every keystroke
 * anywhere in the tree.
 */
const projectTabToolSchema = {
  type: "object",
  properties: {
    tab: {
      type: "string",
      enum: [...NAVIGABLE_PROJECT_TABS],
      description: "The tab to open.",
    },
  },
  required: ["tab"],
  additionalProperties: false,
} as const;

export function ProjectDetailTabs({ project, role }: { project: ProjectDetail; role: Role }) {
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

  /* ── WebMCP: move between this project's tabs ──
     Only the open tab's panel is mounted, so a tab's tools genuinely come and
     go with it. Without this an agent could reach the milestone tools only if
     the user happened to already be on the milestone tab.

     It goes through handleTabChange rather than dispatching setProjectDetailTab
     directly: the store is what renders, but the URL is what a deep link and
     the back button read, and moving one without the other leaves the two
     disagreeing. */
  useWebMcpTool({
    name: "navigate_to_project_tab",
    title: "Switch project tab",
    description:
      "Opens one of the tabs on the project currently in view. Each tab registers its own tools while it is open, so switching is how you reach them \u2014 the result says which ones this tab carries.",
    inputSchema: projectTabToolSchema as unknown as Record<string, unknown>,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const tab = String(input.tab ?? "");
      // Widened on purpose: TypeScript infers a narrowing predicate for the
      // filter that builds NAVIGABLE_PROJECT_TABS, so its element type already
      // excludes "payments" and includes() would reject the very value being
      // tested for.
      const navigable: readonly string[] = NAVIGABLE_PROJECT_TABS;
      if (!isVisibleProjectDetailTab(tab) || !navigable.includes(tab)) {
        return webMcpError(
          `Unknown project tab "${tab}". Available: ${NAVIGABLE_PROJECT_TABS.join(", ")}.`,
        );
      }

      handleTabChange(tab);

      return webMcpJson({
        tab,
        projectId: project.id,
        // The panel mounts after this returns, so these are the tools that
        // *will* be there. Re-read your tool list before relying on it.
        toolsNowAvailable: projectSurfaceTools(tab),
      });
    },
  });

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
        {activeTab === "tradies" ? (
          <ProjectTradiesTab project={project} />
        ) : null}
        {activeTab === "docs" ? <ProjectQuotesTab project={project} isAdmin={isAdmin} /> : null}
        {activeTab === "history" ? (
          <ProjectHistoryTabs project={project} />
        ) : null}
        {activeTab === "communications" ? (
          <ProjectCommunicationTabs project={project} />
        ) : null}
      </div>
    </section>
  );
}
