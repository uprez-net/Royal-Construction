import { notFound } from "next/navigation";
import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";
import { getProjectById } from "@/lib/data/projects";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectById(id);

  if (!project) {
    notFound();
  }

  return (
      <ProjectDetailScreen project={project} />
  );
}
