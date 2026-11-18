"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";

import type { ProjectDetail } from "@/types/project";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  selectProjectDetailUiState,
  setProjectDetailTab,
} from "@/lib/store/slices/projectsSlice";

import { ProjectOverviewTab } from "./project-overview-tab";
import {
  ProjectTabNavigation,
  isVisibleProjectDetailTab,
  projectTabPanelId,
  projectTabTriggerId,
  type VisibleProjectDetailTabKey,
} from "./project-tab-navigation";
import { Role } from "@prisma/client";
import type { UserPrincipal } from "@/lib/domain/principal";
import { canSeeMilestoneNotes } from "@/lib/domain/projects/milestone-note-rules";
import { UploadHintScope } from "@/components/common/upload-hints";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Shown for the moment a tab's code is fetched, the first time it opens. */
function TabLoading() {
  return (
    <PageSkeleton label="Loading tab" className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </PageSkeleton>
  );
}

// Overview is the tab a project opens on, so it ships with the page. Every
// other tab is fetched when it is first opened, or rendered on the server when
// a link opens on it. Together they are most of this page's code (issue #411).
const ProjectMilestonesTab = dynamic(
  () => import("./project-milestones-tab").then((m) => m.ProjectMilestonesTab),
  { loading: TabLoading },
);
const ProjectPaymentsTab = dynamic(
  () => import("./project-payments-tab").then((m) => m.ProjectPaymentsTab),
  { loading: TabLoading },
);
const ProjectFinancialsTab = dynamic(
  () =>
    import("./financials-tab/project-financials-tab").then(
      (m) => m.ProjectFinancialsTab,
    ),
  { loading: TabLoading },
);
const ProjectVariationsTab = dynamic(
  () => import("./project-variations-tab").then((m) => m.ProjectVariationsTab),
  { loading: TabLoading },
);
const ProjectDocumentsTab = dynamic(
  () => import("./project-documents-tab").then((m) => m.ProjectDocumentsTab),
  { loading: TabLoading },
);
const ProjectTradiesTab = dynamic(
  () => import("./project-tradies-tab").then((m) => m.ProjectTradiesTab),
  { loading: TabLoading },
);
const ProjectHistoryTabs = dynamic(
  () => import("./project-history-tabs").then((m) => m.ProjectHistoryTabs),
  { loading: TabLoading },
);
const ProjectCommunicationTabs = dynamic(
  () =>
    import("./project-communication-tabs").then(
      (m) => m.ProjectCommunicationTabs,
    ),
  { loading: TabLoading },
);
const ProjectChecklistsTab = dynamic(
  () =>
    import("./checklists-tab/project-checklists-tab").then(
      (m) => m.ProjectChecklistsTab,
    ),
  { loading: TabLoading },
);
const ProjectComplianceTab = dynamic(
  () =>
    import("./compliance-tab/project-compliance-tab").then(
      (m) => m.ProjectComplianceTab,
    ),
  { loading: TabLoading },
);

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
  checklists: { trail: "Checklists", tags: ["Checklist"] },
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
  viewerId,
}: {
  project: ProjectDetail;
  role: Role;
  viewerId: string;
}) {
  const isAdmin = role === "ADMIN";
  // The viewer as the note rules see them, or null for an account that may
  // not see staff notes at all (a customer).
  const notesViewer = useMemo<UserPrincipal | null>(() => {
    const principal: UserPrincipal = { kind: "user", userId: viewerId, role };
    return canSeeMilestoneNotes(principal) ? principal : null;
  }, [role, viewerId]);
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
  // Each time the page is shown anew the URL decides again. The screen's
  // cleanup resets the stored tab (StrictMode re-runs it in dev, and Next's
  // Activity re-runs effects when a hidden route is shown again), but the ref
  // survives, so without this the deep-linked tab would be lost.
  useEffect(() => {
    seenUrlTab.current = null;
  }, [project.id]);
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

  // "Verify checklist" on a stage opens that stage's checklist here, on the
  // same record the Checklists tab lists.
  const handleOpenChecklist = useCallback(
    (number: number) => {
      dispatch(
        setProjectDetailTab({ projectId: project.id, tab: "checklists" }),
      );
      const params = new URLSearchParams(window.location.search);
      params.set("activeTab", "checklists");
      params.set("checklist", String(number));
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
            <ProjectOverviewTab
              project={project}
              isAdmin={isAdmin}
              onOpenTab={handleTabChange}
            />
          ) : null}
          {activeTab === "milestones" ? (
            <ProjectMilestonesTab
              project={project}
              isAdmin={isAdmin}
              notesViewer={notesViewer}
              onOpenChecklist={handleOpenChecklist}
            />
          ) : null}
          {activeTab === "checklists" ? (
            <ProjectChecklistsTab project={project} isAdmin={isAdmin} />
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
