import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";
import { getProjectById } from "@/lib/data/projects";
import ProjectDetailLoading from "./loading";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const project = await getProjectById(projectId);

  if (project) {
    return {
      title: `${project.name}, ${project.location}`,
      description: `Details for project #${project.name}, ${project.location}.`,
    };
  } else {
    return {
      title: `Project Not Found`,
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
  const project = await getProjectById(projectId);

  if (!project) {
    notFound();
  }

  return <ProjectDetailScreen project={project} />;
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
