import { notFound } from "next/navigation";

import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/common/app-shell";
import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";
import { getProjectById } from "@/lib/data/projects";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { isAuthenticated } = await auth();
  const project = await getProjectById(id);

  if (!project) {
    notFound();
  }

  return (
    <AppShell
      activeSlug="project-detail"
      title={project.name}
      description={project.location}
      breadcrumbs={["Home", "Projects", project.name]}
      isSignedIn={isAuthenticated}
    >
      <ProjectDetailScreen project={project} />
    </AppShell>
  );
}
