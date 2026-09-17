"use client";

import { useState } from "react";
import type { LeadEmails } from "@prisma/client";
import type { ProjectDetail } from "@/types/project";
import { LeadEmailSection } from "@/components/leads/modal-ui/email-section";

interface ProjectCommunicationTabsProps {
  project: ProjectDetail;
}

export function ProjectCommunicationTabs({
  project,
}: ProjectCommunicationTabsProps) {
  const [emails, setEmails] = useState<LeadEmails[]>(project.lead.emails);

  const appendEmailToLead = (_leadId: number, email: LeadEmails) => {
    setEmails((prev) => [email, ...prev]);
  };

  return (
    <LeadEmailSection
      emails={emails}
      leadId={project.lead.id}
      leadEmail={project.lead.email}
      projectType={project.lead.type}
      location={project.lead.location}
      isFullScreen
      appendEmailToLead={appendEmailToLead}
    />
  );
}
