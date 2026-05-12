"use client";

import { useRouter } from "next/navigation";

import { AddUpdateModal } from "@/components/projects/add-update-modal";
import { CreateVariationModal } from "@/components/projects/create-variation-modal";

export function ProjectDetailActions({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: { id: string; name: string }[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      <AddUpdateModal projectId={projectId} milestones={milestones} onSuccess={() => router.refresh()} />
      <CreateVariationModal projectId={projectId} onSuccess={() => router.refresh()} />
    </div>
  );
}
