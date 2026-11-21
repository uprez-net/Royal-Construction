"use client";

import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";

import type { ProjectDetail } from "@/types/project";

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

import { ProjectNotAssignedNotice } from "./project-not-assigned-notice";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the only record of the open tab. It used to be copied into the
  // store, and the two drifted: the server rendered Overview for a link to
  // `?activeTab=tradies` and the client swapped tabs after hydrating, and a
  // reset of the store copy (every router.refresh(), e.g. after a schedule
  // status change) dropped the page back to Overview while the URL still
  // named Tradies. Read from the URL, the server renders the linked tab and
  // nothing else can move it. An unknown or hidden key (see
  // VISIBLE_PROJECT_DETAIL_TABS) falls back rather than rendering nothing.
  const urlTab = searchParams.get("activeTab");
  const activeTab: VisibleProjectDetailTabKey =
    urlTab && isVisibleProjectDetailTab(urlTab, project) ? urlTab : "overview";

  // replaceState rather than router.replace: every tab renders from data
  // already on the page, and router.replace re-renders the whole server page
  // on each click. Next keeps useSearchParams in step with it, which is what
  // switches the panel.
  const openTab = useCallback(
    (tab: VisibleProjectDetailTabKey, extra?: Record<string, string>) => {
      const params = new URLSearchParams(window.location.search);
      params.set("activeTab", tab);
      for (const [key, value] of Object.entries(extra ?? {})) {
        params.set(key, value);
      }
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname],
  );

  const handleTabChange = useCallback(
    (tab: VisibleProjectDetailTabKey) => openTab(tab),
    [openTab],
  );

  // "Verify checklist" on a stage opens that stage's checklist here, on the
  // same record the Checklists tab lists.
  const handleOpenChecklist = useCallback(
    (number: number) => openTab("checklists", { checklist: String(number) }),
    [openTab],
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
          {/* Both tabs fetch and act through rules this caller may fail on
              a project they are not assigned to (#568): say so rather than
              draw a panel whose every button is refused. */}
          {activeTab === "communications" ? (
            project.viewerAccess.record ? (
              <ProjectCommunicationTabs project={project} isAdmin={isAdmin} />
            ) : (
              <ProjectNotAssignedNotice what="use its WhatsApp group" />
            )
          ) : null}
          {activeTab === "compliance" ? (
            <ProjectComplianceTab project={project} isAdmin={isAdmin} />
          ) : null}
        </UploadHintScope>
      </div>
    </section>
  );
}
