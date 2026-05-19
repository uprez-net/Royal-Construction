import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ProjectDetailScreen } from "@/components/projects/project-detail-screen"
import { getProjectById } from "@/lib/data/projects"
import ProjectDetailLoading from "./loading"

async function ProjectDetailContent({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const project = await getProjectById(projectId)

  if (!project) {
    notFound()
  }

  return <ProjectDetailScreen project={project} />
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  return (
    <Suspense fallback={<ProjectDetailLoading />}>
      <ProjectDetailContent params={params} />
    </Suspense>
  )
}