import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";
import { getProjectForPage } from "@/lib/data/projects";
import ProjectDetailLoading from "./loading";
import type { Metadata } from "next";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { auth } from "@clerk/nextjs/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const project = await getProjectForPage(projectId);

  if (project) {
    return {
      title: `${project.name}, ${project.location}`,
      description: `Project details for ${project.name}, ${project.location}.`,
    };
  } else {
    return {
      title: `Project not found`,
      description: `The requested project could not be found.`,
    };
  }
}

async function ProjectDetailContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, user] = await Promise.all([
    getProjectForPage(projectId),
    auth().then(({ userId }) =>
      userId ? getUserByClerkIdCached(userId) : null,
    ),
  ]);

  if (!project) {
    notFound();
  }

  return <ProjectDetailScreen project={project} role={user!.role} />;
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<ProjectDetailLoading />}>
      <ProjectDetailContent params={params} />
    </Suspense>
  );
}
