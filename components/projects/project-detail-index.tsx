import { ProjectCard } from "@/components/project/project-card";
import { SectionCard } from "@/components/common/section-card";
import { getProjects } from "@/lib/data/projects";

export async function ProjectDetailIndex() {
  const projects = await getProjects();

  return (
    <SectionCard
      title="Project Detail Index"
      description="Open a live project record to inspect milestones, updates, variations, and schedules."
    >
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {projects.items.slice(0, 6).map((project) => (
          <ProjectCard
            key={project.id}
            id={project.id}
            name={project.name}
            location={project.location}
            status={project.status}
            progressPercent={project.progressPercent}
            spent={Number(project.spent)}
            totalBudget={Number(project.totalBudget)}
            estimatedEndDate={project.estimatedEndDate}
            customerName={project.customer.name}
          />
        ))}
      </div>
    </SectionCard>
  );
}
