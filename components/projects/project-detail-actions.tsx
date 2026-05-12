"use client";

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
      <button
        type="button"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        onClick={() => dispatch(openModal({ type: "addUpdate", payload: { projectId, milestones } }))}
      >
        Post Site Update
      </button>
      <button
        type="button"
        className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
        onClick={() => dispatch(openModal({ type: "createVariation", payload: { projectId } }))}
      >
        Create Variation
      </button>
    </div>
  );
}
