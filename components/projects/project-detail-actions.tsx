"use client";

import { FilePlus2, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

export function ProjectDetailActions({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: { id: string; name: string }[];
}) {
  const dispatch = useAppDispatch();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="lg"
        onClick={() =>
          dispatch(
            openModal({ type: "addUpdate", payload: { projectId, milestones } }),
          )
        }
      >
        <MessageSquarePlus aria-hidden="true" />
        Post site update
      </Button>

      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() =>
          dispatch(openModal({ type: "createVariation", payload: { projectId } }))
        }
      >
        <FilePlus2 aria-hidden="true" />
        Create variation
      </Button>
    </div>
  );
}
