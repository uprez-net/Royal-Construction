import { notFound } from "next/navigation";
import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";
import { getProjectById } from "@/lib/data/projects";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);

  if (!project) {
    notFound();
  }

  return (
      <ProjectDetailScreen project={project} />
  );
}
