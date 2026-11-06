"use client";

import type { MilestoneNoteItem } from "@/types/project";
import { fetchJson } from "@/utils/fetch";

const notesUrl = (projectId: string, milestoneId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/notes`;

/** Saves a note; resolves to the note as stored, or throws with the reason. */
export async function postMilestoneNote(
  projectId: string,
  milestoneId: string,
  body: string,
): Promise<MilestoneNoteItem> {
  const response = await fetchJson<MilestoneNoteItem>(
    notesUrl(projectId, milestoneId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
    "Could not save the note. Try again.",
  );
  if (!response.success) throw new Error("Could not save the note. Try again.");
  return response.data;
}

export async function deleteMilestoneNote(
  projectId: string,
  milestoneId: string,
  noteId: string,
): Promise<void> {
  await fetchJson<{ id: string }>(
    `${notesUrl(projectId, milestoneId)}/${encodeURIComponent(noteId)}`,
    { method: "DELETE" },
    "Could not delete the note. Try again.",
  );
}
